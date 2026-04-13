import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '../../src/lib/prisma.js';
import { buildApp, loginAs } from '../helpers/app.js';

let app;
let token;
let workspaceId;

const OWNER_EMAIL = `test_billing_${Date.now()}@example.com`;
const OWNER_PASSWORD = 'testpass123';

async function resetWorkspaceBillingState() {
  if (!workspaceId) return;

  await prisma.addOn.deleteMany({ where: { workspaceId } });
  await prisma.transaction.deleteMany({ where: { workspaceId } });
  await prisma.quotaUsage.deleteMany({ where: { workspaceId } });
  await prisma.subscription.deleteMany({ where: { workspaceId } });
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { subTier: 'FREE', subStatus: 'ACTIVE' },
  });
}

beforeAll(async () => {
  process.env.XENDIT_SECRET_KEY = process.env.XENDIT_SECRET_KEY || 'test_xendit_key';

  app = await buildApp();

  await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Billing Test Owner',
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      workspaceName: 'Billing Test Workspace',
    },
  });

  token = await loginAs(app, OWNER_EMAIL, OWNER_PASSWORD);

  const meRes = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${token}` },
  });
  workspaceId = meRes.json().workspace?.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.owner.deleteMany({ where: { email: { startsWith: 'test_billing_' } } });
  await app.close();
});

describe('Billing payment reconciliation', () => {
  it('POST /api/billing/reconcile — mengaktifkan upgrade subscription dari invoice yang sudah dibayar', async () => {
    if (!workspaceId) return;

    await resetWorkspaceBillingState();

    const now = Date.now();
    const invoiceId = `invoice_paid_${now}`;

    await prisma.subscription.upsert({
      where: { workspaceId },
      update: {
        tier: 'FREE',
        status: 'ACTIVE',
        quotaLimit: 100,
      },
      create: {
        workspaceId,
        tier: 'FREE',
        status: 'ACTIVE',
        quotaLimit: 100,
        startDate: new Date(),
        expireDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });

    const tx = await prisma.transaction.create({
      data: {
        workspaceId,
        type: 'SUBSCRIPTION',
        amount: 129000,
        status: 'PENDING',
        xenditInvoiceId: invoiceId,
      },
    });

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        id: invoiceId,
        external_id: `myagentclaw-subscription-${workspaceId}-STARTER-${now}`,
        status: 'PAID',
        paid_amount: 129000,
      }),
      text: async () => '',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/reconcile',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().paid).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [updatedWorkspace, updatedSubscription, updatedTransaction] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId } }),
      prisma.subscription.findUnique({ where: { workspaceId } }),
      prisma.transaction.findUnique({ where: { id: tx.id } }),
    ]);

    expect(updatedWorkspace.subTier).toBe('STARTER');
    expect(updatedWorkspace.subStatus).toBe('ACTIVE');
    expect(updatedSubscription.tier).toBe('STARTER');
    expect(updatedSubscription.quotaLimit).toBe(1500);
    expect(updatedTransaction.status).toBe('PAID');
    expect(updatedTransaction.xenditPaymentId).toBe(invoiceId);

    fetchSpy.mockRestore();
  });

  it('POST /api/billing/topup — menerima paket 500 pesan dengan harga baru', async () => {
    if (!workspaceId) return;

    await resetWorkspaceBillingState();

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        id: `invoice_topup_${Date.now()}`,
        invoice_url: 'https://checkout.example/topup',
        expiry_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      }),
      text: async () => '',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/topup',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId, messages: 500 },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().topupMessages).toBe(500);
    expect(Number(res.json().transaction.amount)).toBe(35000);

    const requestPayload = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(requestPayload.amount).toBe(35000);
    expect(requestPayload.description).toContain('Top-up 500 pesan');

    fetchSpy.mockRestore();
  });

  it('POST /api/billing/reconcile — tidak menurunkan paket ketika checkout lama ikut PAID', async () => {
    if (!workspaceId) return;

    await resetWorkspaceBillingState();

    const olderTimestamp = Date.now() - 60_000;
    const newerTimestamp = Date.now();

    await prisma.transaction.createMany({
      data: [
        {
          workspaceId,
          type: 'SUBSCRIPTION',
          amount: 129000,
          status: 'PENDING',
          xenditInvoiceId: `invoice_starter_${olderTimestamp}`,
          createdAt: new Date(olderTimestamp),
        },
        {
          workspaceId,
          type: 'SUBSCRIPTION',
          amount: 349000,
          status: 'PENDING',
          xenditInvoiceId: `invoice_growth_${newerTimestamp}`,
          createdAt: new Date(newerTimestamp),
        },
      ],
    });

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const invoiceId = String(url).split('/').pop();
      if (invoiceId === `invoice_growth_${newerTimestamp}`) {
        return {
          ok: true,
          json: async () => ({
            id: invoiceId,
            external_id: `myagentclaw-subscription-${workspaceId}-GROWTH-${newerTimestamp}`,
            status: 'PAID',
            paid_amount: 349000,
          }),
          text: async () => '',
        };
      }

      if (invoiceId === `invoice_starter_${olderTimestamp}`) {
        return {
          ok: true,
          json: async () => ({
            id: invoiceId,
            external_id: `myagentclaw-subscription-${workspaceId}-STARTER-${olderTimestamp}`,
            status: 'PAID',
            paid_amount: 129000,
          }),
          text: async () => '',
        };
      }

      throw new Error(`Unexpected invoice lookup: ${url}`);
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/reconcile',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().paid).toBe(2);

    const [updatedWorkspace, updatedSubscription, allTransactions] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId } }),
      prisma.subscription.findUnique({ where: { workspaceId } }),
      prisma.transaction.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }),
    ]);

    expect(updatedWorkspace.subTier).toBe('GROWTH');
    expect(updatedWorkspace.subStatus).toBe('ACTIVE');
    expect(updatedSubscription.tier).toBe('GROWTH');
    expect(allTransactions.every((tx) => tx.status === 'PAID')).toBe(true);

    fetchSpy.mockRestore();
  });

  it('POST /api/billing/reconcile — tetap menghitung top-up walau top-up lebih baru dari subscription', async () => {
    if (!workspaceId) return;

    await resetWorkspaceBillingState();

    const subscriptionTimestamp = Date.now() - 60_000;
    const topupTimestamp = Date.now();

    await prisma.transaction.createMany({
      data: [
        {
          workspaceId,
          type: 'SUBSCRIPTION',
          amount: 349000,
          status: 'PENDING',
          xenditInvoiceId: `invoice_growth_${subscriptionTimestamp}`,
          createdAt: new Date(subscriptionTimestamp),
        },
        {
          workspaceId,
          type: 'TOPUP',
          amount: 59000,
          status: 'PENDING',
          xenditInvoiceId: `invoice_topup_${topupTimestamp}`,
          createdAt: new Date(topupTimestamp),
        },
      ],
    });

    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const invoiceId = String(url).split('/').pop();
      if (invoiceId === `invoice_topup_${topupTimestamp}`) {
        return {
          ok: true,
          json: async () => ({
            id: invoiceId,
            external_id: `myagentclaw-topup-${workspaceId}-1000-${topupTimestamp}`,
            status: 'PAID',
            paid_amount: 59000,
          }),
          text: async () => '',
        };
      }

      if (invoiceId === `invoice_growth_${subscriptionTimestamp}`) {
        return {
          ok: true,
          json: async () => ({
            id: invoiceId,
            external_id: `myagentclaw-subscription-${workspaceId}-GROWTH-${subscriptionTimestamp}`,
            status: 'PAID',
            paid_amount: 349000,
          }),
          text: async () => '',
        };
      }

      throw new Error(`Unexpected invoice lookup: ${url}`);
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/reconcile',
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().paid).toBe(2);

    const monthYear = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const [updatedWorkspace, updatedSubscription, quotaUsage, addOns] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: workspaceId } }),
      prisma.subscription.findUnique({ where: { workspaceId } }),
      prisma.quotaUsage.findUnique({ where: { workspaceId_monthYear: { workspaceId, monthYear } } }),
      prisma.addOn.findMany({ where: { workspaceId } }),
    ]);

    expect(updatedWorkspace.subTier).toBe('GROWTH');
    expect(updatedSubscription.tier).toBe('GROWTH');
    expect(quotaUsage.limitMessages).toBe(6000);
    expect(addOns).toHaveLength(1);
    expect(addOns[0].value).toBe(1000);

    fetchSpy.mockRestore();
  });
});
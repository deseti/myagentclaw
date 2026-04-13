import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import prisma from '../../src/lib/prisma.js';
import { buildApp, loginAs } from '../helpers/app.js';

let app;
let token;
let workspaceId;
let agentId;
let channelId;

const OWNER_EMAIL = `test_quota_${Date.now()}@example.com`;
const OWNER_PASSWORD = 'testpass123';

beforeAll(async () => {
  app = await buildApp();

  await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Quota Test Owner',
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      workspaceName: 'Quota Test Workspace',
    },
  });

  token = await loginAs(app, OWNER_EMAIL, OWNER_PASSWORD);

  const meRes = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${token}` },
  });
  workspaceId = meRes.json().workspace?.id;

  if (!workspaceId) return;

  const agent = await prisma.agent.create({
    data: {
      workspaceId,
      name: 'Quota Guard Test Agent',
      persona: 'Asisten test quota',
      tone: 'FRIENDLY',
      goal: 'Menggunakan fixture quota test',
      status: 'ACTIVE',
    },
  });
  agentId = agent.id;

  const channel = await prisma.channel.create({
    data: {
      workspaceId,
      agentId,
      type: 'TELEGRAM',
      status: 'CONNECTED',
      phoneNumber: 'quota_guard_test_bot',
    },
  });
  channelId = channel.id;
});

afterAll(async () => {
  await prisma.owner.deleteMany({ where: { email: { startsWith: 'test_quota_' } } });
  await app.close();
});

describe('Quota internal endpoint', () => {
  it('GET /internal/quota/:workspace_id — returns quota info', async () => {
    if (!workspaceId) return;

    const res = await app.inject({
      method: 'GET',
      url: `/internal/quota/${workspaceId}`,
      headers: { 'x-internal-key': process.env.INTERNAL_SECRET_KEY },
    });

    // Jika subscription belum ada, mungkin 404 — kedua skenario valid
    expect([200, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body).toHaveProperty('quota_limit');
      expect(body).toHaveProperty('quota_used');
      expect(body).toHaveProperty('quota_remaining');
    }
  });

  it('POST /internal/quota/increment — increment usage counter', async () => {
    if (!workspaceId) return;

    // Pastikan subscription ada dulu
    const sub = await prisma.subscription.findUnique({ where: { workspaceId } });
    if (!sub) return; // Skip jika tidak ada subscription

    const res = await app.inject({
      method: 'POST',
      url: '/internal/quota/increment',
      headers: { 'x-internal-key': process.env.INTERNAL_SECRET_KEY },
      payload: { workspace_id: workspaceId, count: 1 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.used).toBeGreaterThanOrEqual(1);
    expect(body.remaining).toBeGreaterThanOrEqual(0);
  });

  it('POST /internal/quota/increment — quota_exceeded saat habis', async () => {
    if (!workspaceId) return;

    // Set quota hampir habis untuk simulasi
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const sub = await prisma.subscription.findUnique({ where: { workspaceId } });
    if (!sub) return;

    // Langsung inject angka mendekati limit ke DB
    await prisma.quotaUsage.upsert({
      where: { workspaceId_monthYear: { workspaceId, monthYear } },
      update: { usedMessages: sub.quotaLimit - 1 },
      create: {
        workspaceId,
        monthYear,
        usedMessages: sub.quotaLimit - 1,
        limitMessages: sub.quotaLimit,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/internal/quota/increment',
      headers: { 'x-internal-key': process.env.INTERNAL_SECRET_KEY },
      payload: { workspace_id: workspaceId, count: 2 }, // Melebihi limit
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().quota_exceeded).toBe(true);
    expect(res.json().remaining).toBe(0);
  });

  it('Internal endpoint tolak request tanpa x-internal-key (403)', async () => {
    if (!workspaceId) return;

    const res = await app.inject({
      method: 'GET',
      url: `/internal/quota/${workspaceId}`,
    });

    expect(res.statusCode).toBe(403);
  });

  it('GET /internal/quota/channel/:channelId — memakai limit efektif workspace', async () => {
    if (!workspaceId || !channelId) return;

    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    await prisma.subscription.upsert({
      where: { workspaceId },
      update: {
        tier: 'STARTER',
        status: 'ACTIVE',
        quotaLimit: 1500,
      },
      create: {
        workspaceId,
        tier: 'STARTER',
        status: 'ACTIVE',
        quotaLimit: 1500,
        startDate: new Date(),
        expireDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });

    await prisma.quotaUsage.upsert({
      where: { workspaceId_monthYear: { workspaceId, monthYear } },
      update: { usedMessages: 321, limitMessages: 2000 },
      create: {
        workspaceId,
        monthYear,
        usedMessages: 321,
        limitMessages: 2000,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/internal/quota/channel/${channelId}`,
      headers: { 'x-internal-key': process.env.INTERNAL_SECRET_KEY },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().workspace_id).toBe(workspaceId);
    expect(res.json().channel_id).toBe(channelId);
    expect(res.json().quota_limit).toBe(2000);
    expect(res.json().quota_used).toBe(321);
    expect(res.json().quota_remaining).toBe(1679);
  });

  it('POST /internal/message/save — AI sync pakai limit paket dan berhenti menagih saat quota habis', async () => {
    if (!workspaceId || !channelId) return;

    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const customerPhone = `tg:quota-sync-${Date.now()}`;

    await prisma.subscription.upsert({
      where: { workspaceId },
      update: {
        tier: 'STARTER',
        status: 'ACTIVE',
        quotaLimit: 1500,
      },
      create: {
        workspaceId,
        tier: 'STARTER',
        status: 'ACTIVE',
        quotaLimit: 1500,
        startDate: new Date(),
        expireDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    });

    await prisma.quotaUsage.deleteMany({
      where: { workspaceId, monthYear },
    });

    const firstSave = await app.inject({
      method: 'POST',
      url: '/internal/message/save',
      headers: { 'x-internal-key': process.env.INTERNAL_SECRET_KEY },
      payload: {
        channel_id: channelId,
        customer_phone: customerPhone,
        role: 'AI',
        content: 'Balasan AI pertama',
      },
    });

    expect(firstSave.statusCode).toBe(200);

    let quotaUsage = await prisma.quotaUsage.findUnique({
      where: { workspaceId_monthYear: { workspaceId, monthYear } },
    });
    expect(quotaUsage.limitMessages).toBe(1500);
    expect(quotaUsage.usedMessages).toBe(1);

    await prisma.quotaUsage.update({
      where: { workspaceId_monthYear: { workspaceId, monthYear } },
      data: { usedMessages: 1500, limitMessages: 1500 },
    });

    const blockedSave = await app.inject({
      method: 'POST',
      url: '/internal/message/save',
      headers: { 'x-internal-key': process.env.INTERNAL_SECRET_KEY },
      payload: {
        channel_id: channelId,
        customer_phone: customerPhone,
        role: 'AI',
        content: 'Pesan quota habis',
      },
    });

    expect(blockedSave.statusCode).toBe(200);

    quotaUsage = await prisma.quotaUsage.findUnique({
      where: { workspaceId_monthYear: { workspaceId, monthYear } },
    });
    expect(quotaUsage.limitMessages).toBe(1500);
    expect(quotaUsage.usedMessages).toBe(1500);
    expect(blockedSave.json().quota_remaining).toBe(0);
  });
});

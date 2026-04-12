import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  TIER_PRICING,
  TOPUP_PRICING,
  createXenditInvoice,
  syncPendingTransactionsForWorkspace,
} from '../lib/billing.js';

async function getOwnerEmail(ownerId) {
  const owner = await prisma.owner.findUnique({
    where: { id: ownerId },
    select: { email: true },
  });
  return owner?.email || null;
}

export default async function billingRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  async function emitBillingPaymentSuccess({ workspaceId, payload }) {
    try {
      const { io } = await import('../index.js');
      io.to(`workspace:${workspaceId}`).emit('billing:payment_success', payload);
    } catch {
      // Non-critical
    }
  }

  async function buildBillingSnapshot(ownerId, workspaceId) {
    const ws = await prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId },
      include: { subscriptions: { take: 1, orderBy: { createdAt: 'desc' } } },
    });

    if (!ws) {
      return null;
    }

    const subscription = ws.subscriptions[0] || null;
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const quotaUsage = await prisma.quotaUsage.findUnique({
      where: { workspaceId_monthYear: { workspaceId, monthYear } },
      select: { usedMessages: true, limitMessages: true },
    });

    return {
      subscription,
      quota: {
        used: quotaUsage?.usedMessages || 0,
        limit: quotaUsage?.limitMessages || subscription?.quotaLimit || 0,
        monthYear,
      },
      availableTiers: Object.entries(TIER_PRICING).map(([key, val]) => ({
        tier: key,
        ...val,
        isCurrent: ws.subTier === key,
      })),
    };
  }

  // Helper: pastikan workspace milik owner
  async function assertOwnsWorkspace(ownerId, workspaceId, reply) {
    const ws = await prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId },
      include: { subscriptions: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    if (!ws) {
      reply.code(404).send({ error: 'Not Found', message: 'Workspace tidak ditemukan' });
      return null;
    }
    return ws;
  }

  // GET /api/billing/subscription?workspaceId=xxx — info langganan aktif
  fastify.get('/subscription', async (request, reply) => {
    const { ownerId } = request.user;
    const { workspaceId } = request.query;

    if (!workspaceId) {
      return reply.code(400).send({ error: 'Bad Request', message: 'workspaceId diperlukan' });
    }

    const ws = await assertOwnsWorkspace(ownerId, workspaceId, reply);
    if (!ws) return;

    const snapshot = await buildBillingSnapshot(ownerId, workspaceId);
    return reply.send(snapshot);
  });

  // POST /api/billing/reconcile — sinkronkan transaksi pending ke Xendit
  fastify.post('/reconcile', async (request, reply) => {
    const { ownerId } = request.user;

    const parsed = z.object({
      workspaceId: z.string().min(1),
    }).safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspaceId } = parsed.data;
    const ws = await assertOwnsWorkspace(ownerId, workspaceId, reply);
    if (!ws) return;

    const xenditKey = process.env.XENDIT_SECRET_KEY;
    if (!xenditKey) {
      return reply.code(503).send({ error: 'Service Unavailable', message: 'Payment gateway belum dikonfigurasi' });
    }

    const syncResult = await syncPendingTransactionsForWorkspace({
      workspaceId,
      xenditKey,
      logger: fastify.log,
      emitPaymentSuccess: emitBillingPaymentSuccess,
    });

    const snapshot = await buildBillingSnapshot(ownerId, workspaceId);

    let message = 'Tidak ada pembayaran baru yang perlu disinkronkan.';
    if (syncResult.paid > 0) {
      message = 'Pembayaran berhasil diverifikasi dan paket sudah diperbarui.';
    } else if (syncResult.updated > 0) {
      message = 'Status pembayaran berhasil diperbarui.';
    } else if (syncResult.checked > 0) {
      message = 'Pembayaran masih menunggu konfirmasi dari gateway pembayaran.';
    }

    return reply.send({
      message,
      checked: syncResult.checked,
      updated: syncResult.updated,
      paid: syncResult.paid,
      results: syncResult.results,
      billing: snapshot,
    });
  });

  // POST /api/billing/upgrade — buat invoice Xendit untuk upgrade tier
  fastify.post('/upgrade', async (request, reply) => {
    const { ownerId } = request.user;

    const parsed = z.object({
      workspaceId: z.string().min(1),
      tier: z.enum(['STARTER', 'GROWTH']),
    }).safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspaceId, tier } = parsed.data;
    const ws = await assertOwnsWorkspace(ownerId, workspaceId, reply);
    if (!ws) return;

    if (ws.subTier === tier) {
      return reply.code(409).send({ error: 'Conflict', message: `Workspace sudah menggunakan paket ${tier}` });
    }

    const pricing = TIER_PRICING[tier];
    const xenditKey = process.env.XENDIT_SECRET_KEY;

    if (!xenditKey) {
      return reply.code(503).send({ error: 'Service Unavailable', message: 'Payment gateway belum dikonfigurasi' });
    }

    const payerEmail = await getOwnerEmail(ownerId);
    if (!payerEmail) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Email owner tidak ditemukan' });
    }

    const externalId = `myagentclaw-subscription-${workspaceId}-${tier}-${Date.now()}`;

    let xenditInvoice;
    try {
      xenditInvoice = await createXenditInvoice({
        xenditKey,
        externalId,
        amount: pricing.price,
        payerEmail,
        description: `myagentclaw ${pricing.label} - ${ws.name}`,
      });
    } catch (error) {
      fastify.log.error({ errBody: error.message, workspaceId, tier }, 'Xendit invoice creation failed');
      return reply.code(502).send({ error: 'Payment Gateway Error', message: 'Gagal membuat invoice pembayaran' });
    }

    // Simpan transaksi pending ke database
    const transaction = await prisma.transaction.create({
      data: {
        workspaceId,
        type: 'SUBSCRIPTION',
        amount: pricing.price,
        status: 'PENDING',
        xenditInvoiceId: xenditInvoice.id,
      },
    });

    return reply.code(201).send({
      message: 'Invoice berhasil dibuat',
      invoiceUrl: xenditInvoice.invoice_url,
      checkoutUrl: xenditInvoice.invoice_url,
      expiresAt: xenditInvoice.expiry_date,
      transaction: { id: transaction.id, amount: transaction.amount, status: transaction.status },
    });
  });

  // POST /api/billing/topup — buat invoice Xendit untuk top-up pesan
  fastify.post('/topup', async (request, reply) => {
    const { ownerId } = request.user;

    const parsed = z.object({
      workspaceId: z.string().min(1),
      messages: z.number().int().refine((value) => Object.hasOwn(TOPUP_PRICING, value), {
        message: 'Paket top-up tidak valid',
      }),
    }).safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspaceId, messages } = parsed.data;
    const ws = await assertOwnsWorkspace(ownerId, workspaceId, reply);
    if (!ws) return;

    const xenditKey = process.env.XENDIT_SECRET_KEY;
    if (!xenditKey) {
      return reply.code(503).send({ error: 'Service Unavailable', message: 'Payment gateway belum dikonfigurasi' });
    }

    const payerEmail = await getOwnerEmail(ownerId);
    if (!payerEmail) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Email owner tidak ditemukan' });
    }

    const pricing = TOPUP_PRICING[messages];
    const externalId = `myagentclaw-topup-${workspaceId}-${messages}-${Date.now()}`;

    let xenditInvoice;
    try {
      xenditInvoice = await createXenditInvoice({
        xenditKey,
        externalId,
        amount: pricing.price,
        payerEmail,
        description: `${pricing.label} - ${ws.name}`,
      });
    } catch (error) {
      fastify.log.error({ errBody: error.message, workspaceId, messages }, 'Xendit top-up invoice creation failed');
      return reply.code(502).send({ error: 'Payment Gateway Error', message: 'Gagal membuat invoice top-up' });
    }

    const transaction = await prisma.transaction.create({
      data: {
        workspaceId,
        type: 'TOPUP',
        amount: pricing.price,
        status: 'PENDING',
        xenditInvoiceId: xenditInvoice.id,
      },
    });

    return reply.code(201).send({
      message: 'Invoice top-up berhasil dibuat',
      invoiceUrl: xenditInvoice.invoice_url,
      checkoutUrl: xenditInvoice.invoice_url,
      expiresAt: xenditInvoice.expiry_date,
      topupMessages: pricing.messages,
      transaction: { id: transaction.id, amount: transaction.amount, status: transaction.status },
    });
  });

  // GET /api/billing/transactions?workspaceId=xxx — riwayat transaksi
  fastify.get('/transactions', async (request, reply) => {
    const { ownerId } = request.user;
    const { workspaceId, page = '1', limit = '20' } = request.query;

    if (!workspaceId) {
      return reply.code(400).send({ error: 'Bad Request', message: 'workspaceId diperlukan' });
    }

    const ws = await assertOwnsWorkspace(ownerId, workspaceId, reply);
    if (!ws) return;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { workspaceId },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transaction.count({ where: { workspaceId } }),
    ]);

    return reply.send({
      transactions,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  });
}


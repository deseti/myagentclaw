import { z } from 'zod';
import prisma from '../../lib/prisma.js';

const DEFAULT_FREE_QUOTA_LIMIT = 100;

function getCurrentMonthYear(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const incrementSchema = z.object({
  workspace_id: z.string().min(1),
  count: z.number().int().min(1).max(100).default(1),
});

/**
 * Internal endpoint: POST /internal/quota/increment
 * Dipanggil oleh openclaw Gateway setelah setiap pesan AI berhasil diproses.
 * Increment usage counter dan cek apakah kuota hampir/sudah habis.
 */
export default async function internalQuotaIncrementRoute(fastify) {
  // Sudah di-protect oleh authenticateInternal preHandler di index.js

  // POST /internal/quota/increment
  fastify.post('/increment', async (request, reply) => {
    const parsed = incrementSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspace_id, count } = parsed.data;

    const now = new Date();
    const monthYear = getCurrentMonthYear(now);

    const [subscription, existingQuotaUsage] = await Promise.all([
      prisma.subscription.findUnique({
        where: { workspaceId: workspace_id },
        select: { quotaLimit: true, status: true },
      }),
      prisma.quotaUsage.findUnique({
        where: { workspaceId_monthYear: { workspaceId: workspace_id, monthYear } },
        select: { limitMessages: true },
      }),
    ]);

    if (!subscription) {
      return reply.code(404).send({ error: 'Subscription tidak ditemukan' });
    }

    const effectiveLimit = Math.max(
      existingQuotaUsage?.limitMessages ?? 0,
      subscription.quotaLimit ?? DEFAULT_FREE_QUOTA_LIMIT,
    );

    // Upsert quota usage — buat row baru jika bulan pertama, increment jika sudah ada
    const quotaUsage = await prisma.quotaUsage.upsert({
      where: { workspaceId_monthYear: { workspaceId: workspace_id, monthYear } },
      update: {
        usedMessages: { increment: count },
        ...(existingQuotaUsage?.limitMessages !== effectiveLimit ? { limitMessages: effectiveLimit } : {}),
      },
      create: {
        workspaceId: workspace_id,
        monthYear,
        usedMessages: count,
        limitMessages: effectiveLimit,
      },
    });

    const used = quotaUsage.usedMessages;
    const limit = quotaUsage.limitMessages;
    const remaining = Math.max(0, limit - used);
    const percentageUsed = limit > 0 ? (used / limit) * 100 : 0;

    // Tandai quota_exceeded jika habis — suspend workspace messaging
    const isExceeded = remaining <= 0;

    return reply.send({
      ok: true,
      used,
      limit,
      remaining,
      percentage_used: parseFloat(percentageUsed.toFixed(1)),
      quota_exceeded: isExceeded,
    });
  });

  // GET /internal/quota/:workspaceId — sudah di quota.internal.js, route ini extend dengan reset
  // POST /internal/quota/reset — reset quota di awal bulan baru (dipanggil cron worker)
  fastify.post('/reset', async (request, reply) => {
    const parsed = z.object({ workspace_id: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspace_id } = parsed.data;

    const now = new Date();
    const monthYear = getCurrentMonthYear(now);

    const subscription = await prisma.subscription.findUnique({
      where: { workspaceId: workspace_id },
      select: { quotaLimit: true },
    });

    if (!subscription) {
      return reply.code(404).send({ error: 'Subscription tidak ditemukan' });
    }

    // Buat/reset row bulan baru
    await prisma.quotaUsage.upsert({
      where: { workspaceId_monthYear: { workspaceId: workspace_id, monthYear } },
      update: { usedMessages: 0, limitMessages: subscription.quotaLimit },
      create: {
        workspaceId: workspace_id,
        monthYear,
        usedMessages: 0,
        limitMessages: subscription.quotaLimit,
      },
    });

    return reply.send({ ok: true, message: `Quota reset untuk ${monthYear}` });
  });
}

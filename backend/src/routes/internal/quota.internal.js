import prisma from '../../lib/prisma.js';

function getCurrentMonthYear(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function buildQuotaPayload({ workspaceId, channelId, subscription, quotaUsage, now, monthYear }) {
  const limit = Math.max(quotaUsage?.limitMessages ?? 0, subscription?.quotaLimit ?? 0);
  const used = quotaUsage?.usedMessages ?? 0;
  const remaining = Math.max(0, limit - used);
  const percentageUsed = limit > 0 ? parseFloat(((used / limit) * 100).toFixed(1)) : 0;
  const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return {
    workspace_id: workspaceId,
    ...(channelId ? { channel_id: channelId } : {}),
    tier: subscription.tier,
    subscription_status: subscription.status,
    quota_limit: limit,
    quota_used: used,
    quota_remaining: remaining,
    quota_exhausted: remaining <= 0,
    percentage_used: percentageUsed,
    month_year: monthYear,
    reset_date: resetDate.toISOString().split('T')[0],
  };
}

async function getWorkspaceQuotaState(workspaceId, channelId) {
  const now = new Date();
  const monthYear = getCurrentMonthYear(now);

  const [subscription, quotaUsage] = await Promise.all([
    prisma.subscription.findUnique({
      where: { workspaceId },
      select: { tier: true, quotaLimit: true, status: true },
    }),
    prisma.quotaUsage.findUnique({
      where: { workspaceId_monthYear: { workspaceId, monthYear } },
      select: { usedMessages: true, limitMessages: true },
    }),
  ]);

  if (!subscription) return null;

  return buildQuotaPayload({ workspaceId, channelId, subscription, quotaUsage, now, monthYear });
}

/**
 * Internal endpoint: GET /internal/quota/:workspace_id
 * Dipanggil oleh openclaw skill "check-quota"
 */
export default async function internalQuotaRoute(fastify) {
  fastify.get('/channel/:channelId', async (request, reply) => {
    const { channelId } = request.params;

    const channel = await prisma.channel.findFirst({
      where: { id: channelId },
      select: { id: true, workspaceId: true },
    });

    if (!channel?.workspaceId) {
      return reply.code(404).send({ error: 'Channel tidak ditemukan' });
    }

    const quotaState = await getWorkspaceQuotaState(channel.workspaceId, channel.id);
    if (!quotaState) {
      return reply.code(404).send({ error: 'Workspace atau subscription tidak ditemukan' });
    }

    return reply.send(quotaState);
  });

  fastify.get('/:workspaceId', async (request, reply) => {
    const { workspaceId } = request.params;

    const quotaState = await getWorkspaceQuotaState(workspaceId);
    if (!quotaState) {
      return reply.code(404).send({ error: 'Workspace atau subscription tidak ditemukan' });
    }

    return reply.send(quotaState);
  });
}

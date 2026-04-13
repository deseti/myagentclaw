import prisma from '../lib/prisma.js';

export default async function dashboardRoute(app) {
  // GET /api/dashboard/stats — ringkasan statistik untuk dashboard overview
  app.get('/stats', { onRequest: [app.authenticate] }, async (req, reply) => {
    const ownerId = req.user.ownerId;

    const workspace = await prisma.workspace.findFirst({
      where: { ownerId },
      select: {
        id: true,
        subscriptions: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { quotaLimit: true },
        },
      },
    });

    if (!workspace) {
      return reply.status(404).send({ error: 'Workspace tidak ditemukan' });
    }

    const workspaceId = workspace.id;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const [chatToday, activeLeads, needsAdmin, quotaUsage] = await Promise.all([
      // Chat hari ini = messages yang masuk hari ini dari customer
      prisma.message.count({
        where: {
          role: 'CUSTOMER',
          createdAt: { gte: startOfDay },
          conversation: { agent: { workspaceId } },
        },
      }),
      // Lead aktif = WARM atau HOT
      prisma.lead.count({
        where: {
          workspaceId,
          status: { in: ['WARM', 'HOT'] },
        },
      }),
      // Conversation perlu admin
      prisma.conversation.count({
        where: {
          agent: { workspaceId },
          status: 'NEEDS_ADMIN',
        },
      }),
      // Quota usage bulan ini
      prisma.quotaUsage.findFirst({
        where: { workspaceId, monthYear },
        select: { usedMessages: true, limitMessages: true },
      }),
    ]);

    return reply.send({
      chatToday,
      activeLeads,
      needsAdmin,
      quotaUsed: quotaUsage?.usedMessages ?? 0,
      quotaLimit: quotaUsage?.limitMessages ?? workspace.subscriptions[0]?.quotaLimit ?? 100,
    });
  });
}

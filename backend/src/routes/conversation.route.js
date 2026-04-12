import prisma from '../lib/prisma.js';
import { handleOutbound } from '../channels/gateway.js';
import { mapCustomerLifecycleStatus } from '../lib/agent-access.js';
import {
  approveAgentCustomerAccess,
  resolveAgentCustomerAccessStatus,
} from '../lib/agent-customer-access.js';
import { syncApprovedCustomerToChannel } from '../lib/channel-access-sync.js';

function serializeConversation(conversation) {
  const agentAccess = conversation.customer?.agentAccesses?.find((entry) => entry.agentId === conversation.agentId) || null;
  const accessStatus = resolveAgentCustomerAccessStatus(conversation.agent, agentAccess);

  return {
    ...conversation,
    customer: conversation.customer
      ? {
        ...conversation.customer,
        phone: conversation.customer.phoneNumber,
        accessStatus,
        lifecycleStatus: mapCustomerLifecycleStatus(
          conversation.customer,
          agentAccess ? { ...agentAccess, agent: conversation.agent } : null,
        ),
      }
      : null,
  };
}

export default async function conversationRoute(app) {
  // GET /api/conversations?workspaceId=xxx&status=ACTIVE&agentId=xxx&page=1&limit=20
  app.get('/', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { workspaceId, agentId, status, page = 1, limit = 20 } = req.query;

    if (!workspaceId) {
      return reply.status(400).send({ error: 'workspaceId required' });
    }

    // Verify ownership
    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId: req.user.ownerId },
    });
    if (!workspace) return reply.status(403).send({ error: 'Forbidden' });

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    const where = {
      agent: { workspaceId },
    };
    if (agentId) where.agentId = agentId;
    if (status) where.status = status;

    const [total, conversations] = await Promise.all([
      prisma.conversation.count({ where }),
      prisma.conversation.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phoneNumber: true,
              isArchived: true,
              archivedAt: true,
              isBlocked: true,
              blockedAt: true,
              agentAccesses: {
                select: {
                  agentId: true,
                  status: true,
                  updatedAt: true,
                },
              },
            },
          },
          agent: {
            select: { id: true, name: true, accessMode: true },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { content: true, role: true, createdAt: true },
          },
          _count: { select: { messages: true } },
        },
      }),
    ]);

    return {
      conversations: conversations.map(serializeConversation),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  });

  // GET /api/conversations/:id — detail + paginated messages
  app.get('/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        agent: {
          select: { id: true, name: true, workspaceId: true, accessMode: true },
        },
        customer: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            isArchived: true,
            archivedAt: true,
            isBlocked: true,
            blockedAt: true,
            agentAccesses: {
              select: {
                agentId: true,
                status: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    // Verify ownership via workspace
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: conversation.agent.workspaceId,
        ownerId: req.user.ownerId,
      },
    });
    if (!workspace) return reply.status(403).send({ error: 'Forbidden' });

    const [totalMessages, messages] = await Promise.all([
      prisma.message.count({ where: { conversationId: id } }),
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: 'asc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    return {
      ...serializeConversation(conversation),
      messages,
      messagesMeta: {
        total: totalMessages,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalMessages / limitNum),
      },
    };
  });

  // PATCH /api/conversations/:id/close
  app.patch('/:id/close', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { agent: { select: { workspaceId: true } } },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    const workspace = await prisma.workspace.findFirst({
      where: { id: conversation.agent.workspaceId, ownerId: req.user.ownerId },
    });
    if (!workspace) return reply.status(403).send({ error: 'Forbidden' });

    if (conversation.status === 'CLOSED') {
      return reply.status(400).send({ error: 'Conversation already closed' });
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { status: 'CLOSED', endedAt: new Date() },
    });

    // Notify via Socket.io
    req.server.io.to(`workspace:${conversation.agent.workspaceId}`).emit('conversation:closed', {
      conversationId: id,
    });

    return updated;
  });

  // PATCH /api/conversations/:id/escalate
  app.patch('/:id/escalate', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const { notes } = req.body ?? {};

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        agent: { select: { workspaceId: true } },
        customer: { select: { id: true, name: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    const workspace = await prisma.workspace.findFirst({
      where: { id: conversation.agent.workspaceId, ownerId: req.user.ownerId },
    });
    if (!workspace) return reply.status(403).send({ error: 'Forbidden' });

    if (conversation.status === 'CLOSED') {
      return reply.status(400).send({ error: 'Cannot escalate a closed conversation' });
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { status: 'NEEDS_ADMIN' },
    });

    // Notify via Socket.io
    req.server.io.to(`workspace:${conversation.agent.workspaceId}`).emit('conversation:escalated', {
      conversationId: id,
      customer: conversation.customer,
      notes,
    });

    return updated;
  });

  // PATCH /api/conversations/:id/reopen
  app.patch('/:id/reopen', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { agent: { select: { workspaceId: true } } },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    const workspace = await prisma.workspace.findFirst({
      where: { id: conversation.agent.workspaceId, ownerId: req.user.ownerId },
    });
    if (!workspace) return reply.status(403).send({ error: 'Forbidden' });

    if (conversation.status === 'ACTIVE') {
      return reply.status(400).send({ error: 'Conversation already active' });
    }

    const updated = await prisma.conversation.update({
      where: { id },
      data: { status: 'ACTIVE', endedAt: null },
    });

    return updated;
  });

  app.patch('/:id/approve', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        agent: { select: { id: true, workspaceId: true, accessMode: true, name: true } },
        customer: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            isArchived: true,
            archivedAt: true,
            isBlocked: true,
            blockedAt: true,
            agentAccesses: {
              select: {
                agentId: true,
                status: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    const workspace = await prisma.workspace.findFirst({
      where: { id: conversation.agent.workspaceId, ownerId: req.user.ownerId },
    });
    if (!workspace) return reply.status(403).send({ error: 'Forbidden' });

    await approveAgentCustomerAccess(prisma, {
      workspaceId: conversation.agent.workspaceId,
      agentId: conversation.agent.id,
      customerId: conversation.customer.id,
      approvedAt: new Date(),
    });

    await syncApprovedCustomerToChannel({
      channelId: conversation.channelId,
      channelType: conversation.channelType,
      phoneNumber: conversation.customer.phoneNumber,
    }).catch(() => null);

    const refreshed = await prisma.conversation.findUnique({
      where: { id },
      include: {
        agent: { select: { id: true, name: true, workspaceId: true, accessMode: true } },
        customer: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            isArchived: true,
            archivedAt: true,
            isBlocked: true,
            blockedAt: true,
            agentAccesses: {
              select: {
                agentId: true,
                status: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    req.server.io.to(`workspace:${conversation.agent.workspaceId}`).emit('customer:approval_updated', {
      conversationId: conversation.id,
      customerId: conversation.customer.id,
      agentId: conversation.agent.id,
      status: 'ACTIVE',
    });

    return reply.send({
      ok: true,
      conversation: serializeConversation(refreshed),
    });
  });

  // POST /api/conversations/:id/reply — admin mengirim pesan manual ke customer
  app.post('/:id/reply', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params;
    const { text } = req.body ?? {};

    if (!text?.trim()) {
      return reply.status(400).send({ error: 'text tidak boleh kosong' });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        agent: { select: { workspaceId: true } },
        customer: { select: { phoneNumber: true } },
      },
    });
    if (!conversation) return reply.status(404).send({ error: 'Not found' });

    const workspace = await prisma.workspace.findFirst({
      where: { id: conversation.agent.workspaceId, ownerId: req.user.ownerId },
    });
    if (!workspace) return reply.status(403).send({ error: 'Forbidden' });

    if (conversation.status === 'CLOSED') {
      return reply.status(400).send({ error: 'Tidak bisa reply ke percakapan yang sudah ditutup' });
    }

    const result = await handleOutbound({
      workspaceId: conversation.agent.workspaceId,
      phoneNumber: conversation.customer.phoneNumber,
      text: text.trim(),
      conversationId: id,
      allowArchived: true,
      reactivateArchived: true,
      fastifyInstance: app,
    });

    if (result.error) {
      return reply.status(result.statusCode || 502).send({ error: result.error, message: result.error });
    }

    return reply.send({ ok: true, message: result.message || null });
  });
}

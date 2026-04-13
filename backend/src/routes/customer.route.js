import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { mapCustomerLifecycleStatus, summarizeCustomerAccesses } from '../lib/agent-access.js';
import { approveAgentCustomerAccess } from '../lib/agent-customer-access.js';
import { syncApprovedCustomerForAgent } from '../lib/channel-access-sync.js';

const listCustomersQuerySchema = z.object({
  workspaceId: z.string().min(1),
  search: z.string().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'ARCHIVED', 'BLOCKED', 'ALL']).optional().default('ACTIVE'),
  page: z.string().optional().default('1'),
  limit: z.string().optional().default('20'),
});

const updateCustomerSchema = z.object({
  name: z.string().min(1).max(100),
});

const lifecycleSchema = z.object({
  action: z.enum(['ARCHIVE', 'UNARCHIVE', 'BLOCK', 'UNBLOCK', 'APPROVE']),
  agentId: z.string().min(1).optional(),
});

function buildCustomerStatusWhere(status) {
  switch (status) {
    case 'PENDING':
      return {
        isArchived: false,
        isBlocked: false,
        agentAccesses: { some: { status: 'PENDING' } },
      };
    case 'ARCHIVED':
      return { isArchived: true, isBlocked: false };
    case 'BLOCKED':
      return { isBlocked: true };
    case 'ALL':
      return {};
    case 'ACTIVE':
    default:
      return {
        isArchived: false,
        isBlocked: false,
        agentAccesses: { some: { status: 'ACTIVE' } },
      };
  }
}

function mapLifecycleStatus(customer) {
  return mapCustomerLifecycleStatus(customer);
}

function serializeCustomer(customer) {
  const accessSummary = summarizeCustomerAccesses(customer.agentAccesses);

  return {
    ...customer,
    lifecycleStatus: mapLifecycleStatus(customer),
    accessSummary,
    agentStatuses: (customer.agentAccesses || []).map((entry) => ({
      id: entry.id,
      agentId: entry.agentId,
      agentName: entry.agent?.name || 'Agent',
      status: entry.status,
      updatedAt: entry.updatedAt,
    })),
  };
}

export default async function customerRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  // Helper: pastikan workspace milik owner
  async function assertOwnsWorkspace(ownerId, workspaceId, reply) {
    const ws = await prisma.workspace.findFirst({ where: { id: workspaceId, ownerId } });
    if (!ws) {
      reply.code(404).send({ error: 'Not Found', message: 'Workspace tidak ditemukan' });
      return null;
    }
    return ws;
  }

  // GET /api/customers?workspaceId=xxx&search=xxx&page=1&limit=20
  fastify.get('/', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = listCustomersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspaceId, search, status, page, limit } = parsed.data;

    const ws = await assertOwnsWorkspace(ownerId, workspaceId, reply);
    if (!ws) return;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      workspaceId,
      ...buildCustomerStatusWhere(status),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { phoneNumber: { contains: search } },
            ],
          }
        : {}),
    };

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { lastSeen: 'desc' },
        include: {
          lead: { select: { status: true } },
          agentAccesses: {
            include: {
              agent: { select: { id: true, name: true } },
            },
            orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
          },
          _count: { select: { conversations: true } },
        },
      }),
      prisma.customer.count({ where }),
    ]);

    return reply.send({
      customers: customers.map(serializeCustomer),
      total,
      status,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  });

  // GET /api/customers/:id — detail customer + lead + conversations terbaru
  fastify.get('/:id', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const customer = await prisma.customer.findFirst({
      where: { id, workspace: { ownerId } },
      include: {
        lead: true,
        agentAccesses: {
          include: {
            agent: { select: { id: true, name: true } },
          },
          orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        },
        conversations: {
          orderBy: { startedAt: 'desc' },
          take: 10,
          include: {
            agent: { select: { id: true, name: true } },
            _count: { select: { messages: true } },
          },
        },
        followUps: {
          where: { status: 'PENDING' },
          orderBy: { scheduledAt: 'asc' },
          take: 5,
        },
      },
    });

    if (!customer) {
      return reply.code(404).send({ error: 'Not Found', message: 'Customer tidak ditemukan' });
    }

    return reply.send({ customer: serializeCustomer(customer) });
  });

  // GET /api/customers/:id/messages?conversationId=xxx — riwayat chat
  fastify.get('/:id/messages', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;
    const { conversationId, page = '1', limit = '50' } = request.query;

    // Pastikan customer milik workspace owner
    const customer = await prisma.customer.findFirst({
      where: { id, workspace: { ownerId } },
      select: { id: true },
    });
    if (!customer) {
      return reply.code(404).send({ error: 'Not Found', message: 'Customer tidak ditemukan' });
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      conversation: { customerId: id },
      ...(conversationId ? { conversationId } : {}),
    };

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { sentAt: 'desc' },
      }),
      prisma.message.count({ where }),
    ]);

    return reply.send({
      messages: messages.reverse(), // kembalikan urutan kronologis
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  });

  // PATCH /api/customers/:id — update nama customer
  fastify.patch('/:id', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const parsed = updateCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const existing = await prisma.customer.findFirst({
      where: { id, workspace: { ownerId } },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Customer tidak ditemukan' });
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: { name: parsed.data.name },
    });

    return reply.send({ message: 'Customer berhasil diupdate', customer: serializeCustomer(customer) });
  });

  fastify.patch('/:id/lifecycle', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const parsed = lifecycleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const existing = await prisma.customer.findFirst({
      where: { id, workspace: { ownerId } },
    });

    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Customer tidak ditemukan' });
    }

    const now = new Date();
    let data;
    let message;

    switch (parsed.data.action) {
      case 'APPROVE': {
        if (!parsed.data.agentId) {
          return reply.code(400).send({ error: 'Bad Request', message: 'agentId diperlukan untuk approve customer' });
        }

        const agent = await prisma.agent.findFirst({
          where: {
            id: parsed.data.agentId,
            workspaceId: existing.workspaceId,
          },
          select: { id: true, workspaceId: true },
        });

        if (!agent) {
          return reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
        }

        await approveAgentCustomerAccess(prisma, {
          workspaceId: existing.workspaceId,
          agentId: agent.id,
          customerId: id,
          approvedAt: now,
        });

        await syncApprovedCustomerForAgent({
          agentId: agent.id,
          phoneNumber: existing.phoneNumber,
        }).catch(() => null);

        const customer = await prisma.customer.findUnique({
          where: { id },
          include: {
            lead: { select: { status: true } },
            agentAccesses: {
              include: {
                agent: { select: { id: true, name: true } },
              },
              orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
            },
            _count: { select: { conversations: true } },
          },
        });

        try {
          const { io } = await import('../index.js');
          io.to(`workspace:${existing.workspaceId}`).emit('customer:approval_updated', {
            customerId: id,
            agentId: agent.id,
            status: 'ACTIVE',
          });
        } catch {
          // Non-critical
        }

        return reply.send({
          message: 'Customer berhasil diapprove untuk agent ini',
          customer: serializeCustomer(customer),
        });
      }
      case 'ARCHIVE':
        data = {
          isArchived: true,
          archivedAt: now,
          isBlocked: false,
          blockedAt: null,
        };
        message = 'Customer berhasil diarsipkan';
        break;
      case 'UNARCHIVE':
        data = {
          isArchived: false,
          archivedAt: null,
        };
        message = 'Customer berhasil diaktifkan kembali';
        break;
      case 'BLOCK':
        data = {
          isBlocked: true,
          blockedAt: now,
          isArchived: false,
          archivedAt: null,
        };
        message = 'Customer berhasil diblokir';
        break;
      case 'UNBLOCK':
        data = {
          isBlocked: false,
          blockedAt: null,
        };
        message = 'Blokir customer berhasil dibuka';
        break;
      default:
        return reply.code(400).send({ error: 'Bad Request', message: 'Aksi tidak didukung' });
    }

    const customer = await prisma.customer.update({
      where: { id },
      data,
      include: {
        lead: { select: { status: true } },
        agentAccesses: {
          include: {
            agent: { select: { id: true, name: true } },
          },
          orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        },
        _count: { select: { conversations: true } },
      },
    });

    if (parsed.data.action === 'ARCHIVE' || parsed.data.action === 'BLOCK') {
      await Promise.all([
        prisma.followUp.updateMany({
          where: {
            customerId: id,
            status: 'PENDING',
          },
          data: { status: 'CANCELLED' },
        }),
        prisma.paymentReminder.updateMany({
          where: {
            customerId: id,
            status: { in: ['PENDING', 'SCHEDULED'] },
          },
          data: {
            status: 'CANCELLED',
            lastError: parsed.data.action === 'BLOCK'
              ? 'Customer diblokir, reminder dibatalkan.'
              : 'Customer diarsipkan, reminder dibatalkan.',
            failedAt: null,
          },
        }),
      ]);
    }

    return reply.send({ message, customer: serializeCustomer(customer) });
  });
}


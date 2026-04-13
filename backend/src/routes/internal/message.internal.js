import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { normalizeCustomerPhone } from '../../lib/channel-utils.js';
import {
  APPROVAL_SUCCESS_REPLY,
  looksLikeApprovalCode,
  mapCustomerLifecycleStatus,
  normalizeApprovalCodeInput,
  sendPendingReply,
  validateApprovalCode,
} from '../../lib/agent-access.js';
import {
  approveCustomer,
  resolveInboundConversationStatus,
  shouldBlockPendingCustomer,
  upsertAgentCustomerAccess,
} from '../../lib/agent-customer-access.js';
import { syncApprovedCustomerToChannel } from '../../lib/channel-access-sync.js';

const DEFAULT_FREE_QUOTA_LIMIT = 100;

const saveMessageSchema = z.object({
  workspace_id: z.string().min(1).optional(),
  agent_id: z.string().min(1).optional(),
  channel_id: z.string().min(1).optional(),
  customer_phone: z.string().min(3).max(50),
  customer_name: z.string().max(100).optional(),
  channel_type: z.enum(['TELEGRAM', 'WHATSAPP']).optional(),
  role: z.enum(['CUSTOMER', 'AI', 'ADMIN']),
  content: z.string().min(1).max(4000),
  session_key: z.string().max(100).optional(),
});

const customerStatusQuerySchema = z.object({
  channel_id: z.string().min(1),
  customer_phone: z.string().min(1).max(50),
});

const customerAccessSchema = z.object({
  channel_id: z.string().min(1),
  customer_phone: z.string().min(1).max(50),
  content: z.string().max(4000).optional(),
  customer_name: z.string().max(100).optional(),
});

function serializeCustomerAccessState({ customer, agent, agentAccess }) {
  const lifecycleStatus = mapCustomerLifecycleStatus(
    customer
      ? {
          ...customer,
          agentAccesses: agentAccess ? [{ ...agentAccess, agent }] : [],
        }
      : null,
    agentAccess ? { ...agentAccess, agent } : null,
  );

  return {
    lifecycleStatus,
    accessStatus: agentAccess?.status || (agent?.accessMode === 'APPROVAL_REQUIRED' ? 'PENDING' : 'ACTIVE'),
    approvedAt: agentAccess?.approvedAt || null,
    approvalCodeMatchedAt: agentAccess?.approvalCodeMatchedAt || null,
    lastPendingAt: agentAccess?.lastPendingAt || null,
  };
}

async function upsertCustomerForAccess({ workspaceId, phoneNumber, customerName, now }) {
  return prisma.customer.upsert({
    where: {
      workspaceId_phoneNumber: {
        workspaceId,
        phoneNumber,
      },
    },
    update: {
      lastSeen: now,
      ...(customerName ? { name: customerName } : {}),
    },
    create: {
      workspaceId,
      phoneNumber,
      name: customerName || null,
      lastSeen: now,
    },
  });
}

/**
 * Internal endpoint: POST /internal/message/save
 * Dipanggil oleh openclaw skill "save-message" setelah setiap turn percakapan.
 *
 * Alur:
 * 1. Upsert customer (berdasarkan phoneNumber + workspaceId)
 * 2. Cari atau buat conversation aktif untuk customer + agent
 * 3. Simpan message ke conversation
 * 4. Increment quota usage
 * 5. Update customer.lastSeen dan totalInteractions
 * 6. Emit Socket.io ke dashboard owner (real-time update)
 */
export default async function internalMessageRoute(fastify) {
  fastify.get('/status', async (request, reply) => {
    const parsed = customerStatusQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const channelRecord = await prisma.channel.findFirst({
      where: { id: parsed.data.channel_id },
      select: { id: true, workspaceId: true, type: true, agentId: true },
    });

    if (!channelRecord?.workspaceId) {
      return reply.code(404).send({ error: 'Not Found', message: 'Channel tidak ditemukan' });
    }

    const customer_phone = normalizeCustomerPhone(channelRecord.type, parsed.data.customer_phone);

    const customer = await prisma.customer.findUnique({
      where: {
        workspaceId_phoneNumber: {
          workspaceId: channelRecord.workspaceId,
          phoneNumber: customer_phone,
        },
      },
      select: {
        id: true,
        isBlocked: true,
        isArchived: true,
        blockedAt: true,
        archivedAt: true,
        agentAccesses: {
          where: { agentId: channelRecord.agentId },
          select: {
            id: true,
            status: true,
            approvedAt: true,
            approvalCodeMatchedAt: true,
            lastPendingAt: true,
          },
          take: 1,
        },
      },
    });

    const agent = await prisma.agent.findUnique({
      where: { id: channelRecord.agentId },
      select: { id: true, accessMode: true },
    });

    const agentAccess = customer?.agentAccesses?.[0] || null;
    const accessState = serializeCustomerAccessState({ customer, agent, agentAccess });

    return reply.send({
      ok: true,
      customer: customer
        ? {
          id: customer.id,
          isBlocked: customer.isBlocked,
          isArchived: customer.isArchived,
          blockedAt: customer.blockedAt,
          archivedAt: customer.archivedAt,
          accessStatus: accessState.accessStatus,
          lifecycleStatus: accessState.lifecycleStatus,
        }
        : null,
    });
  });

  fastify.post('/access', async (request, reply) => {
    const parsed = customerAccessSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const channelRecord = await prisma.channel.findFirst({
      where: { id: parsed.data.channel_id },
      select: {
        id: true,
        workspaceId: true,
        type: true,
        agentId: true,
        agent: {
          select: {
            id: true,
            workspaceId: true,
            accessMode: true,
            approvalCode: true,
            status: true,
          },
        },
      },
    });

    if (!channelRecord?.workspaceId || !channelRecord?.agent) {
      return reply.code(404).send({ error: 'Not Found', message: 'Channel tidak ditemukan' });
    }

    const now = new Date();
    const normalizedPhone = normalizeCustomerPhone(channelRecord.type, parsed.data.customer_phone);
    const existingCustomer = await prisma.customer.findUnique({
      where: {
        workspaceId_phoneNumber: {
          workspaceId: channelRecord.workspaceId,
          phoneNumber: normalizedPhone,
        },
      },
      include: {
        agentAccesses: {
          where: { agentId: channelRecord.agentId },
          take: 1,
        },
      },
    });

    const existingAgentAccess = existingCustomer?.agentAccesses?.[0] || null;
    const normalizedContent = normalizeApprovalCodeInput(parsed.data.content);
    const normalizedApprovalCode = normalizeApprovalCodeInput(channelRecord.agent.approvalCode);

    if (existingCustomer?.isBlocked) {
      return reply.send({
        ok: true,
        decision: 'BLOCK',
        customer: existingCustomer
          ? serializeCustomerAccessState({ customer: existingCustomer, agent: channelRecord.agent, agentAccess: existingAgentAccess })
          : null,
      });
    }

    if (channelRecord.agent.status !== 'ACTIVE') {
      return reply.send({
        ok: true,
        decision: 'BLOCK',
        customer: existingCustomer
          ? serializeCustomerAccessState({ customer: existingCustomer, agent: channelRecord.agent, agentAccess: existingAgentAccess })
          : null,
      });
    }

    if (!shouldBlockPendingCustomer(channelRecord.agent, existingAgentAccess)) {
      return reply.send({
        ok: true,
        decision: 'ALLOW',
        customer: existingCustomer
          ? serializeCustomerAccessState({ customer: existingCustomer, agent: channelRecord.agent, agentAccess: existingAgentAccess })
          : null,
      });
    }

    const approvalCodeMatches = validateApprovalCode(channelRecord.agent, parsed.data.content);

    if (approvalCodeMatches) {
      let approvedCustomer = existingCustomer;

      if (!approvedCustomer) {
        approvedCustomer = await upsertCustomerForAccess({
          workspaceId: channelRecord.workspaceId,
          phoneNumber: normalizedPhone,
          customerName: parsed.data.customer_name,
          now,
        });
      }

      const approvedAccess = await approveCustomer(prisma, {
        workspaceId: channelRecord.workspaceId,
        agentId: channelRecord.agentId,
        customerId: approvedCustomer.id,
        approvedAt: now,
        approvalCodeMatchedAt: now,
      });

      await syncApprovedCustomerToChannel({
        channelId: channelRecord.id,
        channelType: channelRecord.type,
        phoneNumber: approvedCustomer.phoneNumber,
      }).catch(() => null);

      try {
        const { io } = await import('../../index.js');
        io.to(`workspace:${channelRecord.workspaceId}`).emit('customer:approval_updated', {
          customerId: approvedCustomer.id,
          agentId: channelRecord.agentId,
          status: 'ACTIVE',
        });
      } catch {
        // Non-critical
      }

      return reply.send({
        ok: true,
        decision: 'APPROVED',
        replyText: APPROVAL_SUCCESS_REPLY,
        customer: serializeCustomerAccessState({
          customer: approvedCustomer,
          agent: channelRecord.agent,
          agentAccess: approvedAccess,
        }),
      });
    }

    const customer = existingCustomer || await upsertCustomerForAccess({
      workspaceId: channelRecord.workspaceId,
      phoneNumber: normalizedPhone,
      customerName: parsed.data.customer_name,
      now,
    });
    const agentAccess = await upsertAgentCustomerAccess(prisma, {
      workspaceId: channelRecord.workspaceId,
      agent: channelRecord.agent,
      customerId: customer.id,
      role: 'CUSTOMER',
      now,
    });
    const invalidCode = Boolean(normalizedContent)
      && looksLikeApprovalCode(parsed.data.content, normalizedApprovalCode.length || 8);
    const replyText = sendPendingReply({
      agent: channelRecord.agent,
      hasExistingPending: Boolean(existingCustomer?.id || existingAgentAccess?.id),
      invalidCode,
    });

    return reply.send({
      ok: true,
      decision: invalidCode ? 'INVALID_CODE' : 'PENDING',
      replyText,
      customer: serializeCustomerAccessState({ customer, agent: channelRecord.agent, agentAccess }),
    });
  });

  fastify.post('/save', async (request, reply) => {
    const parsed = saveMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    let {
      workspace_id,
      agent_id,
      channel_id,
      customer_phone,
      customer_name,
      channel_type,
      role,
      content,
      session_key,
    } = parsed.data;

    if ((!workspace_id || !agent_id) && !channel_id) {
      return reply.code(400).send({
        error: 'Validation error',
        message: 'workspace_id + agent_id atau channel_id wajib diisi',
      });
    }

    if (channel_id && (!workspace_id || !agent_id || !channel_type)) {
      const channelRecord = await prisma.channel.findFirst({
        where: { id: channel_id },
        select: { id: true, workspaceId: true, agentId: true, type: true },
      });

      if (!channelRecord?.agentId) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Channel tidak ditemukan atau belum terhubung ke agent',
        });
      }

      workspace_id = workspace_id || channelRecord.workspaceId;
      agent_id = agent_id || channelRecord.agentId;
      channel_type = channel_type || channelRecord.type;
    }

    if (!workspace_id || !agent_id || !channel_type) {
      return reply.code(400).send({
        error: 'Validation error',
        message: 'Data routing pesan tidak lengkap',
      });
    }

    // Normalisasi ID customer Telegram agar konsisten antar jalur ingestion.
    customer_phone = normalizeCustomerPhone(channel_type, customer_phone);

    // Cari agent + channel
    const agent = await prisma.agent.findFirst({
      where: { id: agent_id, workspaceId: workspace_id },
      include: { channels: { where: { type: channel_type, status: 'CONNECTED' }, take: 1 } },
    });

    if (!agent) {
      return reply.code(404).send({ error: 'Agent tidak ditemukan atau tidak aktif' });
    }

    if (agent.status !== 'ACTIVE' && role !== 'ADMIN') {
      return reply.code(409).send({
        error: 'Conflict',
        code: 'AGENT_INACTIVE',
        message: 'Agent sedang nonaktif dan tidak menerima chat customer',
      });
    }

    const channel = agent.channels[0];

    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const quotaKey = { workspaceId_monthYear: { workspaceId: workspace_id, monthYear } };

    const existingCustomer = await prisma.customer.findUnique({
      where: { workspaceId_phoneNumber: { workspaceId: workspace_id, phoneNumber: customer_phone } },
      select: { id: true, isArchived: true, isBlocked: true },
    });

    if (existingCustomer?.isBlocked && role !== 'ADMIN') {
      return reply.code(403).send({
        error: 'Forbidden',
        code: 'CUSTOMER_BLOCKED',
        message: 'Customer diblokir dan tidak boleh diproses',
      });
    }

    // Jalankan semua operasi DB dalam satu transaksi
    const result = await prisma.$transaction(async (tx) => {
      // 1. Upsert customer
      const customer = await tx.customer.upsert({
        where: { workspaceId_phoneNumber: { workspaceId: workspace_id, phoneNumber: customer_phone } },
        update: {
          lastSeen: now,
          ...(role === 'CUSTOMER' ? { isArchived: false, archivedAt: null } : {}),
          ...(customer_name ? { name: customer_name } : {}),
          ...(role === 'CUSTOMER' ? { totalInteractions: { increment: 1 } } : {}),
        },
        create: {
          workspaceId: workspace_id,
          phoneNumber: customer_phone,
          name: customer_name || null,
          isArchived: false,
          isBlocked: false,
          lastSeen: now,
          totalInteractions: role === 'CUSTOMER' ? 1 : 0,
        },
      });

      const agentAccess = await upsertAgentCustomerAccess(tx, {
        workspaceId: workspace_id,
        agent,
        customerId: customer.id,
        role,
        now,
      });

      const desiredConversationStatus = resolveInboundConversationStatus(agent, agentAccess);

      // 2. Buka/temukan conversation aktif
      let conversation = await tx.conversation.findFirst({
        where: { customerId: customer.id, agentId: agent_id, status: { in: ['ACTIVE', 'NEEDS_ADMIN'] } },
        orderBy: { startedAt: 'desc' },
      });

      let needsAdminTriggered = false;

      if (!conversation) {
        conversation = await tx.conversation.create({
          data: {
            customerId: customer.id,
            agentId: agent_id,
            channelId: channel?.id || null,
            channelType: channel_type,
            status: desiredConversationStatus,
          },
        });
        needsAdminTriggered = desiredConversationStatus === 'NEEDS_ADMIN';

        // Upsert lead dengan status NEW untuk customer baru
        await tx.lead.upsert({
          where: { customerId: customer.id },
          update: {},
          create: {
            workspaceId: workspace_id,
            customerId: customer.id,
            status: 'NEW',
          },
        });
      } else if (conversation.status !== desiredConversationStatus) {
        conversation = await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            status: desiredConversationStatus,
            ...(desiredConversationStatus === 'ACTIVE' ? { endedAt: null } : {}),
          },
        });
        needsAdminTriggered = desiredConversationStatus === 'NEEDS_ADMIN';
      }

      // 3. Simpan message
      const message = await tx.message.create({
        data: {
          conversationId: conversation.id,
          role,
          content,
          type: 'text',
          sentAt: now,
        },
      });

      // 4. Increment quota (hanya untuk pesan AI)
      let quotaUsage = null;
      if (role === 'AI') {
        const [subscription, existingQuotaUsage] = await Promise.all([
          tx.subscription.findUnique({
            where: { workspaceId: workspace_id },
            select: { quotaLimit: true },
          }),
          tx.quotaUsage.findUnique({
            where: quotaKey,
            select: { usedMessages: true, limitMessages: true },
          }),
        ]);

        const effectiveLimit = Math.max(
          existingQuotaUsage?.limitMessages ?? 0,
          subscription?.quotaLimit ?? DEFAULT_FREE_QUOTA_LIMIT,
        );

        await tx.quotaUsage.upsert({
          where: quotaKey,
          update: existingQuotaUsage?.limitMessages === effectiveLimit ? {} : { limitMessages: effectiveLimit },
          create: {
            workspaceId: workspace_id,
            monthYear,
            usedMessages: 0,
            limitMessages: effectiveLimit,
          },
        });

        await tx.quotaUsage.updateMany({
          where: {
            workspaceId: workspace_id,
            monthYear,
            usedMessages: { lt: effectiveLimit },
          },
          data: {
            usedMessages: { increment: 1 },
          },
        });

        quotaUsage = await tx.quotaUsage.findUnique({
          where: quotaKey,
          select: { usedMessages: true, limitMessages: true },
        });
      }

      return { customer, agentAccess, conversation, message, quotaUsage, needsAdminTriggered };
    });

    // 5. Emit Socket.io ke dashboard owner (non-blocking)
    try {
      const { io } = await import('../../index.js');
      io.to(`workspace:${workspace_id}`).emit('chat:new_message', {
        conversationId: result.conversation.id,
        customerId: result.customer.id,
        customerPhone: customer_phone,
        customerName: customer_name || null,
        role,
        content,
        sentAt: now.toISOString(),
        customerLifecycleStatus: mapCustomerLifecycleStatus(
          { ...result.customer, agentAccesses: [{ ...result.agentAccess, agent }] },
          { ...result.agentAccess, agent },
        ),
      });

      if (role === 'CUSTOMER' && result.needsAdminTriggered) {
        io.to(`workspace:${workspace_id}`).emit('chat:handoff_needed', {
          conversationId: result.conversation.id,
          customerId: result.customer.id,
          customerName: result.customer.name || customer_name || null,
          reason: 'APPROVAL_PENDING',
        });
      }
    } catch {
      // Non-critical
    }

    const quotaRemaining = result.quotaUsage
      ? Math.max(0, result.quotaUsage.limitMessages - result.quotaUsage.usedMessages)
      : null;

    return reply.send({
      ok: true,
      conversation_id: result.conversation.id,
      message_id: result.message.id,
      customer_id: result.customer.id,
      quota_remaining: quotaRemaining,
    });
  });
}

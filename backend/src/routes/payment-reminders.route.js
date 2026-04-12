import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { ocListInstalledSkills } from '../lib/openclaw-client.js';
import { ensureWorkspaceRuntime } from '../lib/runtime-manager.js';
import {
  agentHasAssignedSkill,
  matchesSkillKey,
} from '../lib/skill-activation.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../lib/internal-skills.js';
import {
  buildPaymentReminderRealtimePayload,
  buildPaymentReminderMessage,
  DEFAULT_PAYMENT_REMINDER_TEMPLATES,
  getPaymentReminderEventName,
  PAYMENT_REMINDER_SKILL_KEY,
  PAYMENT_REMINDER_STATUSES,
  PAYMENT_REMINDER_TYPES,
  serializePaymentReminder,
} from '../lib/payment-reminders.js';
import { enqueuePaymentReminderDispatch } from '../queues/reminder.worker.js';

const PAYMENT_REMINDER_SKILL_DEFINITION = getInternalSkillDefinition(PAYMENT_REMINDER_SKILL_KEY);

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

const reminderStatusEnum = z.enum(PAYMENT_REMINDER_STATUSES);
const reminderTypeEnum = z.enum(PAYMENT_REMINDER_TYPES);
const optionalTextSchema = z.preprocess(normalizeOptionalText, z.string().max(2000).optional());

const listQuerySchema = z.object({
  workspaceId: z.string().min(1),
  status: reminderStatusEnum.optional(),
  type: reminderTypeEnum.optional(),
  agentId: z.string().min(1).optional(),
});

const reminderParamsSchema = z.object({
  id: z.string().min(1),
});

const createReminderSchema = z.object({
  workspaceId: z.string().min(1),
  customerId: z.string().min(1),
  agentId: z.string().min(1),
  conversationId: z.string().min(1).optional().nullable(),
  type: reminderTypeEnum,
  title: optionalTextSchema,
  description: optionalTextSchema,
  amount: z.coerce.number().nonnegative().optional().nullable(),
  currency: z.string().trim().min(3).max(10).optional(),
  dueDate: z.coerce.date(),
  scheduledAt: z.coerce.date().optional(),
  templateType: reminderTypeEnum.optional().nullable(),
  messageContent: optionalTextSchema,
});

const updateReminderSchema = z.object({
  workspaceId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional().nullable(),
  type: reminderTypeEnum.optional(),
  title: optionalTextSchema,
  description: optionalTextSchema,
  amount: z.coerce.number().nonnegative().optional().nullable(),
  currency: z.string().trim().min(3).max(10).optional(),
  dueDate: z.coerce.date().optional(),
  scheduledAt: z.coerce.date().optional(),
  templateType: reminderTypeEnum.optional().nullable(),
  messageContent: optionalTextSchema,
});

const workspaceBodySchema = z.object({
  workspaceId: z.string().min(1),
});

const rescheduleReminderSchema = workspaceBodySchema.extend({
  scheduledAt: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
});

const REMINDER_TYPES_REQUIRING_AMOUNT = new Set(['INVOICE', 'DP', 'INSTALLMENT']);

function reminderTypeRequiresAmount(type) {
  return REMINDER_TYPES_REQUIRING_AMOUNT.has(String(type || '').trim().toUpperCase());
}

function ensureReminderAmountPresent(type, amount, reply) {
  if (!reminderTypeRequiresAmount(type)) {
    return true;
  }

  if (amount === undefined || amount === null || Number.isNaN(Number(amount))) {
    reply.code(400).send({
      error: 'Validation error',
      message: `Nominal wajib diisi untuk reminder ${String(type || '').toUpperCase()}.`,
      details: { amount: ['Nominal wajib diisi untuk tipe reminder ini.'] },
    });
    return false;
  }

  return true;
}

function ensureScheduledAtNotInPast(scheduledAt, reply) {
  if (!scheduledAt) {
    return true;
  }

  if (new Date(scheduledAt).getTime() < Date.now() - 60_000) {
    reply.code(400).send({
      error: 'Validation error',
      message: 'scheduledAt tidak boleh di masa lalu.',
      details: { scheduledAt: ['scheduledAt harus sekarang atau di masa depan.'] },
    });
    return false;
  }

  return true;
}

async function loadWorkspaceSkillAccess(ownerId, workspaceId, reply) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId },
    select: { id: true, ownerId: true, name: true, subTier: true, subStatus: true },
  });

  if (!workspace) {
    reply.code(404).send({ error: 'Not Found', message: 'Workspace tidak ditemukan' });
    return null;
  }

  if (!workspaceMeetsMinimumTier(workspace.subTier, PAYMENT_REMINDER_SKILL_DEFINITION?.minimumTier || 'STARTER')) {
    reply.code(403).send({
      error: 'Forbidden',
      message: `Payment Reminder memerlukan minimum paket ${formatInternalSkillTierLabel(PAYMENT_REMINDER_SKILL_DEFINITION?.minimumTier)}.`,
    });
    return null;
  }

  try {
    const runtime = await ensureWorkspaceRuntime({ ...workspace, ownerId });
    const installedPayload = await ocListInstalledSkills(runtime);
    const installedSkills = Array.isArray(installedPayload?.skills) ? installedPayload.skills : [];
    const skillInstalled = installedSkills.some((skill) => matchesSkillKey(skill, PAYMENT_REMINDER_SKILL_KEY));

    if (!skillInstalled) {
      reply.code(403).send({
        error: 'Forbidden',
        message: 'Skill built-in Payment Reminder belum diinstall untuk workspace ini.',
        requiredSkill: PAYMENT_REMINDER_SKILL_KEY,
      });
      return null;
    }

    const assignedAgents = await prisma.agent.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true, openclawSkill: true, configJson: true },
      orderBy: { name: 'asc' },
    });
    const activeAssignedAgents = assignedAgents.filter((agent) => agentHasAssignedSkill(agent, PAYMENT_REMINDER_SKILL_KEY));

    return {
      workspace,
      runtime,
      isInstalled: true,
      isActive: activeAssignedAgents.length > 0,
      assignedAgents: activeAssignedAgents.map(({ id, name }) => ({ id, name })),
      assignedCount: activeAssignedAgents.length,
    };
  } catch {
    reply.code(502).send({
      error: 'Bad Gateway',
      message: 'Gagal memverifikasi skill Payment Reminder di runtime workspace.',
    });
    return null;
  }
}

async function loadReminderOrReply(id, workspaceId, ownerId, reply) {
  const reminder = await prisma.paymentReminder.findFirst({
    where: {
      id,
      workspaceId,
      workspace: { ownerId },
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          isBlocked: true,
          isArchived: true,
        },
      },
      agent: {
        select: {
          id: true,
          name: true,
          status: true,
          openclawSkill: true,
          configJson: true,
        },
      },
      conversation: {
        select: {
          id: true,
          status: true,
          channelType: true,
        },
      },
    },
  });

  if (!reminder) {
    reply.code(404).send({ error: 'Not Found', message: 'Payment reminder tidak ditemukan' });
    return null;
  }

  return reminder;
}

async function loadReminderStats(workspaceId) {
  const [total, pending, scheduled, sent, failed] = await Promise.all([
    prisma.paymentReminder.count({ where: { workspaceId } }),
    prisma.paymentReminder.count({ where: { workspaceId, status: 'PENDING' } }),
    prisma.paymentReminder.count({ where: { workspaceId, status: 'SCHEDULED' } }),
    prisma.paymentReminder.count({ where: { workspaceId, status: 'SENT' } }),
    prisma.paymentReminder.count({ where: { workspaceId, status: 'FAILED' } }),
  ]);

  return {
    total,
    pending,
    scheduled,
    sent,
    failed,
  };
}

function buildSkillStatus(access) {
  return {
    key: PAYMENT_REMINDER_SKILL_KEY,
    installed: Boolean(access?.isInstalled),
    active: Boolean(access?.isActive),
    assignedCount: Number(access?.assignedCount || 0),
    usedBy: Array.isArray(access?.assignedAgents) ? access.assignedAgents : [],
    unlocksRole: 'Billing Assistant',
    opensSidebar: 'Payment Reminder',
    worker: 'reminder-queue',
  };
}

async function loadReminderActivity(reminder) {
  const baseDelivery = {
    conversationId: reminder?.conversationId || null,
    messageId: null,
    lastAttemptAt: reminder?.sentAt || reminder?.failedAt || reminder?.updatedAt || null,
    sentAt: reminder?.sentAt || null,
    failedAt: reminder?.failedAt || null,
    lastError: reminder?.lastError || null,
    latestMessageAt: null,
  };

  if (!reminder?.conversationId) {
    return { history: [], delivery: baseDelivery };
  }

  const history = await prisma.message.findMany({
    where: {
      conversationId: reminder.conversationId,
      type: 'payment_reminder',
    },
    orderBy: { sentAt: 'desc' },
    take: 10,
  });

  const reminderSentAt = reminder?.sentAt ? new Date(reminder.sentAt).getTime() : null;
  const referenceMessage = history.find((message) => {
    if (message.content === reminder?.messageContent) {
      return true;
    }

    if (!reminderSentAt) {
      return false;
    }

    return Math.abs(new Date(message.sentAt).getTime() - reminderSentAt) <= 5 * 60_000;
  }) || history[0] || null;

  return {
    history: history.map((message) => ({
      id: message.id,
      role: message.role,
      type: message.type,
      content: message.content,
      sentAt: message.sentAt,
      createdAt: message.createdAt,
    })),
    delivery: {
      ...baseDelivery,
      messageId: referenceMessage?.id || null,
      latestMessageAt: referenceMessage?.sentAt || referenceMessage?.createdAt || null,
    },
  };
}

function shouldDispatchNow(reminder) {
  const now = Date.now();
  if (reminder.status === 'SCHEDULED') {
    return new Date(reminder.scheduledAt).getTime() <= now;
  }
  return new Date(reminder.dueDate).getTime() <= now;
}

async function maybeDispatchReminder(reminder, access) {
  if (!access?.isActive) return;
  if (!shouldDispatchNow(reminder)) return;
  await enqueuePaymentReminderDispatch({ reminderId: reminder.id }).catch(() => {
    // ignore duplicate enqueue attempts
  });
}

async function resolveReminderRelations({
  ownerId,
  workspaceId,
  customerId,
  agentId,
  conversationId,
  reply,
}) {
  const [customer, agent, conversation] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, workspaceId, workspace: { ownerId } },
      select: { id: true, name: true, phoneNumber: true, isBlocked: true, isArchived: true },
    }),
    prisma.agent.findFirst({
      where: { id: agentId, workspaceId, workspace: { ownerId } },
      select: { id: true, name: true, status: true, openclawSkill: true, configJson: true },
    }),
    conversationId
      ? prisma.conversation.findFirst({
        where: { id: conversationId, agent: { workspaceId } },
        select: { id: true, customerId: true, agentId: true, status: true },
      })
      : Promise.resolve(null),
  ]);

  if (!customer) {
    reply.code(404).send({ error: 'Not Found', message: 'Customer tidak ditemukan' });
    return null;
  }

  if (!agent) {
    reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
    return null;
  }

  if (agent.status !== 'ACTIVE') {
    reply.code(409).send({ error: 'Conflict', message: 'Agent payment reminder harus aktif.' });
    return null;
  }

  if (!agentHasAssignedSkill(agent, PAYMENT_REMINDER_SKILL_KEY)) {
    reply.code(403).send({
      error: 'Forbidden',
      message: 'Agent yang dipilih belum memakai skill Payment Reminder.',
      requiredSkill: PAYMENT_REMINDER_SKILL_KEY,
    });
    return null;
  }

  if (conversationId) {
    if (!conversation) {
      reply.code(404).send({ error: 'Not Found', message: 'Conversation tidak ditemukan' });
      return null;
    }

    if (conversation.customerId !== customer.id || conversation.agentId !== agent.id) {
      reply.code(400).send({
        error: 'Bad Request',
        message: 'Conversation harus cocok dengan customer dan agent yang dipilih.',
      });
      return null;
    }
  }

  return { customer, agent, conversation };
}

function buildMessageContent(payload, customer) {
  return payload.messageContent || buildPaymentReminderMessage({
    type: payload.type,
    templateType: payload.templateType || payload.type,
    customerName: customer?.name,
    amount: payload.amount,
    currency: payload.currency || 'IDR',
    dueDate: payload.dueDate,
  });
}

function emitReminderUpdate(request, workspaceId, action, reminder, extra = {}) {
  const payload = buildPaymentReminderRealtimePayload(action, reminder, extra);
  const eventName = getPaymentReminderEventName(action);

  request.server.io.to(`workspace:${workspaceId}`).emit(eventName, payload);
  request.server.io.to(`workspace:${workspaceId}`).emit('payment-reminder:updated', payload);
}

export default async function paymentReminderRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const access = await loadWorkspaceSkillAccess(request.user.ownerId, parsed.data.workspaceId, reply);
    if (!access) return;

    const where = {
      workspaceId: access.workspace.id,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.type ? { type: parsed.data.type } : {}),
      ...(parsed.data.agentId ? { agentId: parsed.data.agentId } : {}),
    };

    const [reminders, stats] = await Promise.all([
      prisma.paymentReminder.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phoneNumber: true,
              isBlocked: true,
              isArchived: true,
            },
          },
          agent: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
          conversation: {
            select: {
              id: true,
              status: true,
              channelType: true,
            },
          },
        },
        orderBy: [
          { scheduledAt: 'asc' },
          { createdAt: 'desc' },
        ],
      }),
      loadReminderStats(access.workspace.id),
    ]);

    return reply.send({
      workspaceId: access.workspace.id,
      tier: access.workspace.subTier,
      skillStatus: buildSkillStatus(access),
      stats,
      reminders: reminders.map(serializePaymentReminder),
      templates: DEFAULT_PAYMENT_REMINDER_TEMPLATES,
    });
  });

  fastify.get('/:id', async (request, reply) => {
    const paramsParsed = reminderParamsSchema.safeParse(request.params);
    const queryParsed = workspaceBodySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const access = await loadWorkspaceSkillAccess(request.user.ownerId, queryParsed.data.workspaceId, reply);
    if (!access) return;

    const reminder = await loadReminderOrReply(paramsParsed.data.id, access.workspace.id, request.user.ownerId, reply);
    if (!reminder) return;
    const activity = await loadReminderActivity(reminder);

    return reply.send({
      workspaceId: access.workspace.id,
      tier: access.workspace.subTier,
      skillStatus: buildSkillStatus(access),
      reminder: serializePaymentReminder(reminder),
      history: activity.history,
      delivery: activity.delivery,
      templates: DEFAULT_PAYMENT_REMINDER_TEMPLATES,
    });
  });

  fastify.post('/', async (request, reply) => {
    const parsed = createReminderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const access = await loadWorkspaceSkillAccess(request.user.ownerId, parsed.data.workspaceId, reply);
    if (!access) return;

    if (!ensureReminderAmountPresent(parsed.data.type, parsed.data.amount, reply)) return;
    if (!ensureScheduledAtNotInPast(parsed.data.scheduledAt, reply)) return;

    const relations = await resolveReminderRelations({
      ownerId: request.user.ownerId,
      workspaceId: access.workspace.id,
      customerId: parsed.data.customerId,
      agentId: parsed.data.agentId,
      conversationId: parsed.data.conversationId || null,
      reply,
    });
    if (!relations) return;

    const reminder = await prisma.paymentReminder.create({
      data: {
        workspaceId: access.workspace.id,
        customerId: relations.customer.id,
        agentId: relations.agent.id,
        conversationId: relations.conversation?.id || null,
        type: parsed.data.type,
        title: parsed.data.title || `${parsed.data.type} Reminder`,
        description: parsed.data.description || null,
        amount: parsed.data.amount ?? null,
        currency: parsed.data.currency || 'IDR',
        dueDate: parsed.data.dueDate,
        scheduledAt: parsed.data.scheduledAt || parsed.data.dueDate,
        status: parsed.data.scheduledAt ? 'SCHEDULED' : 'PENDING',
        templateType: parsed.data.templateType || parsed.data.type,
        messageContent: buildMessageContent(parsed.data, relations.customer),
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            isBlocked: true,
            isArchived: true,
          },
        },
        agent: {
          select: {
            id: true,
            name: true,
            status: true,
            openclawSkill: true,
            configJson: true,
          },
        },
        conversation: {
          select: {
            id: true,
            status: true,
            channelType: true,
          },
        },
      },
    });

    await maybeDispatchReminder(reminder, access);
    emitReminderUpdate(request, access.workspace.id, 'created', reminder);

    return reply.code(201).send({
      message: 'Payment reminder berhasil dibuat',
      reminder: serializePaymentReminder(reminder),
    });
  });

  fastify.put('/:id', async (request, reply) => {
    const paramsParsed = reminderParamsSchema.safeParse(request.params);
    const bodyParsed = updateReminderSchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: bodyParsed.error?.flatten().fieldErrors || {} });
    }

    const access = await loadWorkspaceSkillAccess(request.user.ownerId, bodyParsed.data.workspaceId, reply);
    if (!access) return;

    const existing = await loadReminderOrReply(paramsParsed.data.id, access.workspace.id, request.user.ownerId, reply);
    if (!existing) return;

    if (['SENT', 'CANCELLED'].includes(existing.status)) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Payment reminder yang sudah sent atau cancelled tidak bisa diedit langsung.',
      });
    }

    const nextType = bodyParsed.data.type || existing.type;
    const nextAmount = bodyParsed.data.amount !== undefined ? bodyParsed.data.amount : (existing.amount === null ? null : Number(existing.amount));

    if (!ensureReminderAmountPresent(nextType, nextAmount, reply)) return;
    if (!ensureScheduledAtNotInPast(bodyParsed.data.scheduledAt, reply)) return;

    const nextCustomerId = bodyParsed.data.customerId || existing.customerId;
    const nextAgentId = bodyParsed.data.agentId || existing.agentId;
    const nextConversationId = bodyParsed.data.conversationId === null
      ? null
      : bodyParsed.data.conversationId || existing.conversationId;

    const relations = await resolveReminderRelations({
      ownerId: request.user.ownerId,
      workspaceId: access.workspace.id,
      customerId: nextCustomerId,
      agentId: nextAgentId,
      conversationId: nextConversationId,
      reply,
    });
    if (!relations) return;

    const nextCurrency = bodyParsed.data.currency || existing.currency || 'IDR';
    const nextDueDate = bodyParsed.data.dueDate || existing.dueDate;
    const nextScheduledAt = bodyParsed.data.scheduledAt || existing.scheduledAt;
    const nextTemplateType = bodyParsed.data.templateType === null
      ? null
      : bodyParsed.data.templateType || existing.templateType || nextType;
    const nextMessageContent = bodyParsed.data.messageContent || buildPaymentReminderMessage({
      type: nextType,
      templateType: nextTemplateType || nextType,
      customerName: relations.customer.name,
      amount: nextAmount,
      currency: nextCurrency,
      dueDate: nextDueDate,
    });

    const reminder = await prisma.paymentReminder.update({
      where: { id: existing.id },
      data: {
        customerId: relations.customer.id,
        agentId: relations.agent.id,
        conversationId: relations.conversation?.id || null,
        type: nextType,
        title: bodyParsed.data.title || existing.title,
        description: bodyParsed.data.description !== undefined ? (bodyParsed.data.description || null) : existing.description,
        amount: nextAmount,
        currency: nextCurrency,
        dueDate: nextDueDate,
        scheduledAt: nextScheduledAt,
        status: bodyParsed.data.scheduledAt ? 'SCHEDULED' : (existing.status === 'FAILED' ? 'PENDING' : existing.status),
        templateType: nextTemplateType,
        messageContent: nextMessageContent,
        sentAt: null,
        failedAt: null,
        lastError: null,
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            isBlocked: true,
            isArchived: true,
          },
        },
        agent: {
          select: {
            id: true,
            name: true,
            status: true,
            openclawSkill: true,
            configJson: true,
          },
        },
        conversation: {
          select: {
            id: true,
            status: true,
            channelType: true,
          },
        },
      },
    });

    await maybeDispatchReminder(reminder, access);
    emitReminderUpdate(request, access.workspace.id, 'updated', reminder);

    return reply.send({
      message: 'Payment reminder berhasil diupdate',
      reminder: serializePaymentReminder(reminder),
    });
  });

  fastify.delete('/:id', async (request, reply) => {
    const paramsParsed = reminderParamsSchema.safeParse(request.params);
    const queryParsed = workspaceBodySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const access = await loadWorkspaceSkillAccess(request.user.ownerId, queryParsed.data.workspaceId, reply);
    if (!access) return;

    const reminder = await loadReminderOrReply(paramsParsed.data.id, access.workspace.id, request.user.ownerId, reply);
    if (!reminder) return;

    await prisma.paymentReminder.delete({ where: { id: reminder.id } });
    emitReminderUpdate(request, access.workspace.id, 'deleted', reminder);

    return reply.send({
      message: 'Payment reminder berhasil dihapus',
      reminder: serializePaymentReminder(reminder),
    });
  });

  fastify.post('/:id/cancel', async (request, reply) => {
    const paramsParsed = reminderParamsSchema.safeParse(request.params);
    const bodyParsed = workspaceBodySchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const access = await loadWorkspaceSkillAccess(request.user.ownerId, bodyParsed.data.workspaceId, reply);
    if (!access) return;

    const existing = await loadReminderOrReply(paramsParsed.data.id, access.workspace.id, request.user.ownerId, reply);
    if (!existing) return;

    if (existing.status === 'SENT') {
      return reply.code(409).send({ error: 'Conflict', message: 'Payment reminder yang sudah terkirim tidak bisa dicancel.' });
    }

    const reminder = await prisma.paymentReminder.update({
      where: { id: existing.id },
      data: {
        status: 'CANCELLED',
        lastError: null,
        failedAt: null,
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            isBlocked: true,
            isArchived: true,
          },
        },
        agent: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        conversation: {
          select: {
            id: true,
            status: true,
            channelType: true,
          },
        },
      },
    });

    emitReminderUpdate(request, access.workspace.id, 'cancelled', reminder);
    return reply.send({ message: 'Payment reminder berhasil dicancel', reminder: serializePaymentReminder(reminder) });
  });

  fastify.post('/:id/reschedule', async (request, reply) => {
    const paramsParsed = reminderParamsSchema.safeParse(request.params);
    const bodyParsed = rescheduleReminderSchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: bodyParsed.error?.flatten().fieldErrors || {} });
    }

    const access = await loadWorkspaceSkillAccess(request.user.ownerId, bodyParsed.data.workspaceId, reply);
    if (!access) return;

    const existing = await loadReminderOrReply(paramsParsed.data.id, access.workspace.id, request.user.ownerId, reply);
    if (!existing) return;

    if (!ensureScheduledAtNotInPast(bodyParsed.data.scheduledAt, reply)) return;

    if (existing.status === 'SENT') {
      return reply.code(409).send({ error: 'Conflict', message: 'Payment reminder yang sudah terkirim tidak bisa dijadwalkan ulang.' });
    }

    const reminder = await prisma.paymentReminder.update({
      where: { id: existing.id },
      data: {
        scheduledAt: bodyParsed.data.scheduledAt,
        dueDate: bodyParsed.data.dueDate || existing.dueDate,
        status: 'SCHEDULED',
        sentAt: null,
        failedAt: null,
        lastError: null,
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            isBlocked: true,
            isArchived: true,
          },
        },
        agent: {
          select: {
            id: true,
            name: true,
            status: true,
            openclawSkill: true,
            configJson: true,
          },
        },
        conversation: {
          select: {
            id: true,
            status: true,
            channelType: true,
          },
        },
      },
    });

    await maybeDispatchReminder(reminder, access);
    emitReminderUpdate(request, access.workspace.id, 'rescheduled', reminder);

    return reply.send({
      message: 'Payment reminder berhasil dijadwalkan ulang',
      reminder: serializePaymentReminder(reminder),
    });
  });
}
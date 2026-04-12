import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { agentHasAssignedSkill } from '../../lib/skill-activation.js';
import {
  buildPaymentReminderMessage,
  PAYMENT_REMINDER_SKILL_KEY,
  PAYMENT_REMINDER_TYPES,
} from '../../lib/payment-reminders.js';
import { enqueuePaymentReminderDispatch } from '../../queues/reminder.worker.js';

const queueReminderSchema = z.object({
  customer_id: z.string().min(1),
  workspace_id: z.string().min(1),
  agent_id: z.string().min(1),
  conversation_id: z.string().min(1).optional(),
  type: z.enum(PAYMENT_REMINDER_TYPES).optional().default('INVOICE'),
  amount: z.number().positive().optional(),
  order_info: z.string().max(200).optional(),
  delay_hours: z.number().positive().optional().default(24),
});

/**
 * Internal endpoint: POST /internal/payment-reminder/queue
 * Dipanggil oleh openclaw skill "trigger-reminder" untuk mengantrikan payment reminder
 */
export default async function internalReminderRoute(fastify) {
  fastify.post('/queue', async (request, reply) => {
    const parsed = queueReminderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const {
      customer_id,
      workspace_id,
      agent_id,
      conversation_id,
      type,
      amount,
      order_info,
      delay_hours,
    } = parsed.data;

    const [customer, agent] = await Promise.all([
      prisma.customer.findFirst({
        where: { id: customer_id, workspaceId: workspace_id },
        select: { id: true, name: true },
      }),
      prisma.agent.findFirst({
        where: { id: agent_id, workspaceId: workspace_id },
        select: { id: true, status: true, openclawSkill: true, configJson: true },
      }),
    ]);

    if (!customer) {
      return reply.code(404).send({ error: 'Not Found', message: 'Customer tidak ditemukan' });
    }

    if (!agent) {
      return reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
    }

    if (!agentHasAssignedSkill(agent, PAYMENT_REMINDER_SKILL_KEY)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Agent belum memakai skill Payment Reminder.',
      });
    }

    const existingPending = await prisma.paymentReminder.findFirst({
      where: {
        customerId: customer_id,
        workspaceId: workspace_id,
        agentId: agent_id,
        type,
        status: { in: ['PENDING', 'SCHEDULED'] },
      },
    });

    if (existingPending) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Sudah ada payment reminder aktif untuk customer ini',
        existing_reminder_id: existingPending.id,
      });
    }

    const conversation = conversation_id
      ? await prisma.conversation.findFirst({
        where: {
          id: conversation_id,
          customerId: customer_id,
          agentId: agent_id,
        },
        select: { id: true },
      })
      : null;

    if (conversation_id && !conversation) {
      return reply.code(404).send({ error: 'Not Found', message: 'Conversation tidak ditemukan' });
    }

    const delayMs = delay_hours * 3600 * 1000;
    const scheduledAt = new Date(Date.now() + delayMs);

    const reminder = await prisma.paymentReminder.create({
      data: {
        workspaceId: workspace_id,
        customerId: customer_id,
        agentId: agent_id,
        conversationId: conversation?.id || null,
        type,
        title: order_info ? `${type} Reminder - ${order_info}` : `${type} Reminder`,
        description: order_info || null,
        amount: amount ?? null,
        currency: 'IDR',
        dueDate: scheduledAt,
        scheduledAt,
        status: 'SCHEDULED',
        templateType: type,
        messageContent: buildPaymentReminderMessage({
          type,
          templateType: type,
          customerName: customer.name,
          amount,
          currency: 'IDR',
          dueDate: scheduledAt,
        }),
      },
    });

    if (scheduledAt.getTime() <= Date.now()) {
      await enqueuePaymentReminderDispatch({ reminderId: reminder.id }).catch(() => {
        // ignore duplicate enqueue attempts
      });
    }

    return reply.code(201).send({
      ok: true,
      reminder_id: reminder.id,
      scheduled_at: scheduledAt.toISOString(),
    });
  });
}

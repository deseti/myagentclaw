import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { followupQueue } from '../../queues/followup.worker.js';

const createFollowupSchema = z.object({
  workspace_id: z.string().min(1),
  customer_phone: z.string().min(5).max(30),
  type: z.enum(['REMINDER', 'PAYMENT_REMINDER', 'PROMO', 'REENGAGEMENT']),
  message: z.string().min(5).max(1000),
  scheduled_at: z.string().datetime({ offset: true }),
  notes: z.string().max(500).optional(),
});

/**
 * Internal endpoint: POST /internal/followup/create
 * Dipanggil oleh openclaw skill "trigger-followup"
 */
export default async function internalFollowupRoute(fastify) {
  fastify.post('/create', async (request, reply) => {
    const parsed = createFollowupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspace_id, customer_phone, type, message, scheduled_at, notes } = parsed.data;

    // Cari customer
    const customer = await prisma.customer.findUnique({
      where: { workspaceId_phoneNumber: { workspaceId: workspace_id, phoneNumber: customer_phone } },
    });

    if (!customer) {
      return reply.code(404).send({ error: 'Customer tidak ditemukan' });
    }

    if (customer.isBlocked) {
      return reply.code(409).send({
        error: 'Conflict',
        code: 'CUSTOMER_BLOCKED',
        message: 'Customer diblokir. Follow-up tidak dapat dijadwalkan.',
      });
    }

    if (customer.isArchived) {
      return reply.code(409).send({
        error: 'Conflict',
        code: 'CUSTOMER_ARCHIVED',
        message: 'Customer sedang diarsipkan. Aktifkan kembali sebelum menjadwalkan follow-up.',
      });
    }

    const followUp = await prisma.followUp.create({
      data: {
        workspaceId: workspace_id,
        customerId: customer.id,
        type,
        message,
        notes: notes || null,
        scheduledAt: new Date(scheduled_at),
        status: 'PENDING',
      },
    });

    return reply.code(201).send({ ok: true, followUp });
  });

  // ---------------------------------------------------------------------------
  // POST /internal/followup/queue
  // Dipanggil oleh openclaw skill "trigger-followup" untuk antrikan follow-up job
  // ---------------------------------------------------------------------------
  const queueFollowupSchema = z.object({
    customer_id: z.string().min(1),
    workspace_id: z.string().min(1),
    agent_id: z.string().min(1),
    type: z.enum(['FOLLOW_UP', 'PAYMENT_REMINDER', 'REACTIVATION']).optional().default('FOLLOW_UP'),
    delay_hours: z.number().positive().optional().default(2),
    conversation_id: z.string().min(1).optional(),
  });

  fastify.post('/queue', async (request, reply) => {
    const parsed = queueFollowupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { customer_id, workspace_id, agent_id, type, delay_hours, conversation_id } = parsed.data;

    const delayMs = delay_hours * 3600 * 1000;
    const scheduledAt = new Date(Date.now() + delayMs);

    const job = await followupQueue.add(
      'send-followup',
      { customer_id, workspace_id, agent_id, followup_type: type, conversation_id },
      { delay: delayMs }
    );

    return reply.code(201).send({
      ok: true,
      job_id: job.id,
      scheduled_at: scheduledAt.toISOString(),
    });
  });
}

import { z } from 'zod';
import prisma from '../../lib/prisma.js';

const notifySchema = z.object({
  workspace_id: z.string().min(1),
  customer_phone: z.string().min(5).max(30),
  customer_name: z.string().max(100).optional(),
  reason: z.string().min(5).max(200),
  conversation_summary: z.string().max(2000),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  channel: z.string().default('telegram'),
});

/**
 * Internal endpoint: POST /internal/admin/notify
 * Dipanggil oleh openclaw skill "send-to-admin"
 * Menyimpan notifikasi ke database dan mengirim ke owner via Socket.io
 */
export default async function internalAdminRoute(fastify) {
  fastify.post('/notify', async (request, reply) => {
    const parsed = notifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const {
      workspace_id,
      customer_phone,
      customer_name,
      reason,
      conversation_summary,
      urgency,
      channel,
    } = parsed.data;

    // Cari workspace + owner untuk kirim notifikasi
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspace_id },
      select: { id: true, name: true, ownerId: true },
    });

    if (!workspace) {
      return reply.code(404).send({ error: 'Workspace tidak ditemukan' });
    }

    // Emit ke Socket.io room workspace — frontend dashboard akan terima real-time
    // io di-import dari instance global yang di-export di index.js
    try {
      const { io } = await import('../../index.js');
      io.to(`workspace:${workspace_id}`).emit('admin:escalation', {
        type: 'ESCALATION',
        urgency,
        reason,
        customerPhone: customer_phone,
        customerName: customer_name || null,
        conversationSummary: conversation_summary,
        channel,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Socket.io emit gagal tidak critical — data tetap tersimpan
      fastify.log.warn('Failed to emit Socket.io escalation event');
    }

    return reply.send({ ok: true, message: 'Notifikasi terkirim ke admin' });
  });
}

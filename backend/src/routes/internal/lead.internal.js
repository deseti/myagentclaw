import { z } from 'zod';
import prisma from '../../lib/prisma.js';

const upsertLeadSchema = z.object({
  workspace_id: z.string().min(1),
  customer_phone: z.string().min(5).max(30),
  customer_name: z.string().max(100).optional(),
  status: z.enum(['NEW', 'CONTACTED', 'INTERESTED', 'QUALIFIED', 'CONVERTED', 'LOST']),
  notes: z.string().max(500).optional(),
  interested_product: z.string().max(200).optional(),
});

/**
 * Internal endpoint: POST /internal/lead/upsert
 * Dipanggil oleh openclaw skill "save-lead"
 */
export default async function internalLeadRoute(fastify) {
  fastify.post('/upsert', async (request, reply) => {
    const parsed = upsertLeadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspace_id, customer_phone, customer_name, status, notes, interested_product } = parsed.data;

    // Upsert customer
    const customer = await prisma.customer.upsert({
      where: { workspaceId_phoneNumber: { workspaceId: workspace_id, phoneNumber: customer_phone } },
      update: { name: customer_name || undefined },
      create: {
        workspaceId: workspace_id,
        phoneNumber: customer_phone,
        name: customer_name || null,
      },
    });

    // Upsert lead — customerId adalah @unique di schema
    const lead = await prisma.lead.upsert({
      where: { customerId: customer.id },
      update: {
        status,
        notes: notes || undefined,
      },
      create: {
        workspaceId: workspace_id,
        customerId: customer.id,
        status,
        notes: notes || null,
      },
    });

    return reply.send({ ok: true, lead });
  });
}

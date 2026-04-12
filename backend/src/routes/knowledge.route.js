import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';

const KNOWLEDGE_CONTENT_MAX = 50000;
const KNOWLEDGE_REFERENCE_URL_MAX = 1000;

const optionalReferenceUrlSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().url().max(KNOWLEDGE_REFERENCE_URL_MAX).optional(),
);

const createKnowledgeSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(2).max(200),
  content: z.string().min(5).max(KNOWLEDGE_CONTENT_MAX),
  type: z.enum(['FAQ', 'PRODUCT', 'INFO', 'PAYMENT', 'SCHEDULE']),
  referenceUrl: optionalReferenceUrlSchema,
});

const updateKnowledgeSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  content: z.string().min(5).max(KNOWLEDGE_CONTENT_MAX).optional(),
  type: z.enum(['FAQ', 'PRODUCT', 'INFO', 'PAYMENT', 'SCHEDULE']).optional(),
  referenceUrl: optionalReferenceUrlSchema,
  isActive: z.boolean().optional(),
});

export default async function knowledgeRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  // Helper: pastikan workspace milik owner yang login
  async function assertOwnsWorkspace(ownerId, workspaceId, reply) {
    const ws = await prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId },
    });
    if (!ws) {
      reply.code(404).send({ error: 'Not Found', message: 'Workspace tidak ditemukan' });
      return null;
    }
    return ws;
  }

  // GET /api/knowledge?workspaceId=xxx — list knowledge base workspace
  fastify.get('/', async (request, reply) => {
    const { ownerId } = request.user;
    const { workspaceId } = request.query;

    if (!workspaceId) {
      return reply.code(400).send({ error: 'Bad Request', message: 'workspaceId diperlukan' });
    }

    const ws = await assertOwnsWorkspace(ownerId, workspaceId, reply);
    if (!ws) return;

    const items = await prisma.knowledgeBase.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ items, total: items.length });
  });

  // GET /api/knowledge/:id — detail satu item
  fastify.get('/:id', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const item = await prisma.knowledgeBase.findFirst({
      where: { id, workspace: { ownerId } },
    });

    if (!item) {
      return reply.code(404).send({ error: 'Not Found', message: 'Knowledge item tidak ditemukan' });
    }

    return reply.send({ item });
  });

  // POST /api/knowledge — tambah knowledge item
  fastify.post('/', async (request, reply) => {
    const { ownerId } = request.user;

    const parsed = createKnowledgeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspaceId, title, content, type, referenceUrl } = parsed.data;

    const ws = await assertOwnsWorkspace(ownerId, workspaceId, reply);
    if (!ws) return;

    const item = await prisma.knowledgeBase.create({
      data: { workspaceId, title, content, type, referenceUrl },
    });

    return reply.code(201).send({ message: 'Knowledge item berhasil ditambahkan', item });
  });

  // PATCH /api/knowledge/:id — update knowledge item
  fastify.patch('/:id', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const parsed = updateKnowledgeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const existing = await prisma.knowledgeBase.findFirst({
      where: { id, workspace: { ownerId } },
      include: { workspace: { select: { subTier: true } } },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Knowledge item tidak ditemukan' });
    }

    const item = await prisma.knowledgeBase.update({
      where: { id },
      data: parsed.data,
    });

    return reply.send({ message: 'Knowledge item berhasil diupdate', item });
  });

  // DELETE /api/knowledge/:id — hapus knowledge item
  fastify.delete('/:id', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const existing = await prisma.knowledgeBase.findFirst({
      where: { id, workspace: { ownerId } },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Knowledge item tidak ditemukan' });
    }

    await prisma.knowledgeBase.delete({ where: { id } });

    return reply.send({ message: 'Knowledge item berhasil dihapus' });
  });
}

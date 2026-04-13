import prisma from '../../lib/prisma.js';

/**
 * Internal endpoint: GET /internal/knowledge/:agent_id
 * Dipanggil oleh openclaw skill "get-knowledge" SKILL.md
 * Sudah dilindungi x-internal-key di index.js (preHandler: authenticateInternal)
 */
export default async function internalKnowledgeRoute(fastify) {
  // Cari workspace melalui agent_id, lalu ambil knowledge base milik workspace tersebut
  fastify.get('/:agentId', async (request, reply) => {
    const { agentId } = request.params;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, status: true, workspaceId: true },
    });

    if (!agent) {
      return reply.code(404).send({ error: 'Agent tidak ditemukan' });
    }

    if (agent.status !== 'ACTIVE') {
      return reply.code(403).send({ error: 'Agent tidak aktif' });
    }

    const items = await prisma.knowledgeBase.findMany({
      where: { workspaceId: agent.workspaceId, isActive: true },
      select: { id: true, title: true, content: true, type: true, referenceUrl: true },
      orderBy: { type: 'asc' },
    });

    return reply.send(items);
  });
}

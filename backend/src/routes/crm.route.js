import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { listCrmActivities } from '../services/crm-activity.service.js';
import {
  archiveCrmEntry,
  assignCrmEntryAgent,
  createCrmEntry,
  createCrmEntryNote,
  deleteCrmEntry,
  deleteCrmEntryNote,
  getCrmEntryDetail,
  listArchivedCrmEntries,
  listCrmEntries,
  listCrmEntryNotes,
  moveCrmEntryStage,
  permanentDeleteCrmEntry,
  restoreCrmEntry,
  updateCrmEntry,
} from '../services/crm-entry.service.js';
import {
  createCrmPipeline,
  CrmServiceError,
  getCrmDashboardSummary,
  listCrmPipelines,
  updateCrmPipeline,
  deleteCrmPipeline,
} from '../services/crm-pipeline.service.js';
import {
  createCrmStage,
  deleteCrmStage,
  listCrmStages,
  reorderCrmStages,
  updateCrmStage,
} from '../services/crm-stage.service.js';

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function normalizeOptionalNullableText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeBooleanInput(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function normalizeOptionalDate(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

function sendCrmError(reply, error, fallbackMessage = 'Gagal memproses CRM Pipeline') {
  if (error instanceof CrmServiceError) {
    return reply.code(error.statusCode).send({
      error: 'CRM Pipeline Error',
      message: error.message,
      details: error.details,
    });
  }

  return reply.code(500).send({
    error: 'Internal Server Error',
    message: fallbackMessage,
  });
}

const workspaceQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

const pipelineParamsSchema = z.object({
  id: z.string().min(1),
});

const pipelineBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.preprocess(normalizeOptionalNullableText, z.string().max(2000).nullable().optional()),
  color: z.preprocess(normalizeOptionalNullableText, z.string().max(50).nullable().optional()),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const updatePipelineBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.preprocess(normalizeOptionalNullableText, z.string().max(2000).nullable().optional()),
  color: z.preprocess(normalizeOptionalNullableText, z.string().max(50).nullable().optional()),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const stageQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

const stageParamsSchema = z.object({
  pipelineId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
});

const stageBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.preprocess(normalizeOptionalNullableText, z.string().max(2000).nullable().optional()),
  color: z.preprocess(normalizeOptionalNullableText, z.string().max(50).nullable().optional()),
  position: z.coerce.number().int().min(1).optional(),
  probabilityPercent: z.coerce.number().int().min(0).max(100).optional(),
  isDefault: z.boolean().optional(),
  isClosedWon: z.boolean().optional(),
  isClosedLost: z.boolean().optional(),
});

const updateStageBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.preprocess(normalizeOptionalNullableText, z.string().max(2000).nullable().optional()),
  color: z.preprocess(normalizeOptionalNullableText, z.string().max(50).nullable().optional()),
  position: z.coerce.number().int().min(1).optional(),
  probabilityPercent: z.coerce.number().int().min(0).max(100).optional(),
  isDefault: z.boolean().optional(),
  isClosedWon: z.boolean().optional(),
  isClosedLost: z.boolean().optional(),
});

const reorderStagesBodySchema = z.object({
  workspaceId: z.string().min(1),
  pipelineId: z.string().min(1),
  stageIds: z.array(z.string().min(1)).min(1),
});

const entryListQuerySchema = z.object({
  workspaceId: z.string().min(1),
  pipelineId: z.string().min(1).optional(),
  stageId: z.string().min(1).optional(),
  assignedAgentId: z.string().min(1).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  source: z.preprocess(normalizeOptionalText, z.string().max(120).optional()),
  search: z.preprocess(normalizeOptionalText, z.string().max(200).optional()),
  includeArchived: z.preprocess(normalizeBooleanInput, z.boolean().optional()),
  dateFrom: z.preprocess(normalizeOptionalDate, z.coerce.date().optional()),
  dateTo: z.preprocess(normalizeOptionalDate, z.coerce.date().optional()),
});

const entryParamsSchema = z.object({
  id: z.string().min(1),
});

const entryBodySchema = z.object({
  workspaceId: z.string().min(1),
  customerId: z.string().min(1),
  pipelineId: z.string().min(1).optional(),
  stageId: z.string().min(1).optional(),
  assignedAgentId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(160),
  valueAmount: z.coerce.number().nonnegative().nullable().optional(),
  currency: z.string().trim().min(3).max(10).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  expectedCloseDate: z.preprocess(normalizeOptionalDate, z.coerce.date().optional()),
  source: z.preprocess(normalizeOptionalNullableText, z.string().max(120).nullable().optional()),
  lostReason: z.preprocess(normalizeOptionalNullableText, z.string().max(2000).nullable().optional()),
  notes: z.preprocess(normalizeOptionalNullableText, z.string().max(4000).nullable().optional()),
});

const updateEntryBodySchema = z.object({
  workspaceId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  pipelineId: z.string().min(1).optional(),
  stageId: z.string().min(1).optional(),
  assignedAgentId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  valueAmount: z.coerce.number().nonnegative().nullable().optional(),
  currency: z.string().trim().min(3).max(10).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  expectedCloseDate: z.preprocess(normalizeOptionalDate, z.coerce.date().optional()),
  source: z.preprocess(normalizeOptionalNullableText, z.string().max(120).nullable().optional()),
  lostReason: z.preprocess(normalizeOptionalNullableText, z.string().max(2000).nullable().optional()),
  notes: z.preprocess(normalizeOptionalNullableText, z.string().max(4000).nullable().optional()),
  moveStageNote: z.preprocess(normalizeOptionalNullableText, z.string().max(2000).nullable().optional()),
});

const moveStageBodySchema = z.object({
  workspaceId: z.string().min(1),
  stageId: z.string().min(1),
  note: z.preprocess(normalizeOptionalNullableText, z.string().max(2000).nullable().optional()),
  lostReason: z.preprocess(normalizeOptionalNullableText, z.string().max(2000).nullable().optional()),
});

const assignAgentBodySchema = z.object({
  workspaceId: z.string().min(1),
  assignedAgentId: z.string().min(1).nullable().optional(),
});

const archiveBodySchema = z.object({
  workspaceId: z.string().min(1),
  isArchived: z.preprocess(normalizeBooleanInput, z.boolean().optional()),
});

const noteBodySchema = z.object({
  workspaceId: z.string().min(1),
  content: z.string().trim().min(1).max(4000),
});

const noteDeleteQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

export default async function crmRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/pipelines', async (request, reply) => {
    const parsed = workspaceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await listCrmPipelines({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
      });
      return reply.send(result);
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal memuat pipeline CRM');
    }
  });

  fastify.post('/pipelines', async (request, reply) => {
    const parsed = pipelineBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await createCrmPipeline({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        name: parsed.data.name,
        description: parsed.data.description || null,
        color: parsed.data.color || null,
        isDefault: parsed.data.isDefault,
        isActive: parsed.data.isActive,
      });
      return reply.code(201).send({ message: 'Pipeline CRM berhasil dibuat', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal membuat pipeline CRM');
    }
  });

  fastify.put('/pipelines/:id', async (request, reply) => {
    const paramsParsed = pipelineParamsSchema.safeParse(request.params);
    const bodyParsed = updatePipelineBodySchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(bodyParsed.success ? {} : bodyParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await updateCrmPipeline({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        pipelineId: paramsParsed.data.id,
        payload: bodyParsed.data,
      });
      return reply.send({ message: 'Pipeline CRM berhasil diupdate', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal mengupdate pipeline CRM');
    }
  });

  fastify.delete('/pipelines/:id', async (request, reply) => {
    const paramsParsed = pipelineParamsSchema.safeParse(request.params);
    const queryParsed = workspaceQuerySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(queryParsed.success ? {} : queryParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await deleteCrmPipeline({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        pipelineId: paramsParsed.data.id,
      });
      return reply.send({ message: 'Pipeline CRM berhasil dihapus', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal menghapus pipeline CRM');
    }
  });

  fastify.get('/pipelines/:pipelineId/stages', async (request, reply) => {
    const paramsParsed = stageParamsSchema.safeParse(request.params);
    const queryParsed = stageQuerySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success || !paramsParsed.data.pipelineId) {
      return reply.code(400).send({ error: 'Validation error', details: { pipelineId: ['pipelineId diperlukan'] } });
    }

    try {
      const result = await listCrmStages({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        pipelineId: paramsParsed.data.pipelineId,
      });
      return reply.send(result);
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal memuat stage CRM');
    }
  });

  fastify.post('/pipelines/:pipelineId/stages', async (request, reply) => {
    const paramsParsed = stageParamsSchema.safeParse(request.params);
    const bodyParsed = stageBodySchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success || !paramsParsed.data.pipelineId) {
      return reply.code(400).send({ error: 'Validation error', details: { pipelineId: ['pipelineId diperlukan'] } });
    }

    try {
      const result = await createCrmStage({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        pipelineId: paramsParsed.data.pipelineId,
        payload: bodyParsed.data,
      });
      return reply.code(201).send({ message: 'Stage CRM berhasil dibuat', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal membuat stage CRM');
    }
  });

  fastify.put('/stages/:id', async (request, reply) => {
    const paramsParsed = pipelineParamsSchema.safeParse(request.params);
    const bodyParsed = updateStageBodySchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(bodyParsed.success ? {} : bodyParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await updateCrmStage({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        stageId: paramsParsed.data.id,
        payload: bodyParsed.data,
      });
      return reply.send({ message: 'Stage CRM berhasil diupdate', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal mengupdate stage CRM');
    }
  });

  fastify.delete('/stages/:id', async (request, reply) => {
    const paramsParsed = pipelineParamsSchema.safeParse(request.params);
    const queryParsed = workspaceQuerySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(queryParsed.success ? {} : queryParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await deleteCrmStage({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        stageId: paramsParsed.data.id,
      });
      return reply.send({ message: 'Stage CRM berhasil dihapus', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal menghapus stage CRM');
    }
  });

  fastify.post('/stages/reorder', async (request, reply) => {
    const parsed = reorderStagesBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await reorderCrmStages({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        pipelineId: parsed.data.pipelineId,
        stageIds: parsed.data.stageIds,
      });
      return reply.send({ message: 'Urutan stage CRM berhasil diupdate', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal mengurutkan stage CRM');
    }
  });

  fastify.get('/entries', async (request, reply) => {
    const parsed = entryListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await listCrmEntries({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: parsed.data,
      });
      return reply.send(result);
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal memuat entry CRM');
    }
  });

  fastify.get('/entries/archived', async (request, reply) => {
    const parsed = z.object({
      workspaceId: z.string().min(1),
      pipelineId: z.string().min(1).optional(),
      search: z.preprocess(normalizeOptionalText, z.string().max(200).optional()),
    }).safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await listArchivedCrmEntries({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: parsed.data,
      });
      return reply.send(result);
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal memuat arsip lead CRM');
    }
  });

  fastify.get('/entries/:id', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const queryParsed = workspaceQuerySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(queryParsed.success ? {} : queryParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await getCrmEntryDetail({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        entryId: paramsParsed.data.id,
      });
      return reply.send(result);
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal memuat detail entry CRM');
    }
  });

  fastify.post('/entries', async (request, reply) => {
    const parsed = entryBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await createCrmEntry({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        createdByUserId: request.user.ownerId,
        payload: parsed.data,
      });
      return reply.code(201).send({ message: 'Lead CRM berhasil dibuat', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal membuat lead CRM');
    }
  });

  fastify.put('/entries/:id', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const bodyParsed = updateEntryBodySchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(bodyParsed.success ? {} : bodyParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await updateCrmEntry({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        entryId: paramsParsed.data.id,
        createdByUserId: request.user.ownerId,
        payload: bodyParsed.data,
      });
      return reply.send({ message: 'Lead CRM berhasil diupdate', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal mengupdate lead CRM');
    }
  });

  fastify.delete('/entries/:id', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const queryParsed = workspaceQuerySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(queryParsed.success ? {} : queryParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await deleteCrmEntry({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        entryId: paramsParsed.data.id,
      });
      return reply.send({ message: 'Lead CRM berhasil dihapus', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal menghapus lead CRM');
    }
  });

  fastify.post('/entries/:id/move-stage', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const bodyParsed = moveStageBodySchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(bodyParsed.success ? {} : bodyParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await moveCrmEntryStage({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        entryId: paramsParsed.data.id,
        createdByUserId: request.user.ownerId,
        stageId: bodyParsed.data.stageId,
        note: bodyParsed.data.note || null,
        lostReason: bodyParsed.data.lostReason || null,
      });
      return reply.send({ message: 'Stage lead CRM berhasil dipindahkan', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal memindahkan stage lead CRM');
    }
  });

  fastify.post('/entries/:id/assign-agent', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const bodyParsed = assignAgentBodySchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(bodyParsed.success ? {} : bodyParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await assignCrmEntryAgent({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        entryId: paramsParsed.data.id,
        createdByUserId: request.user.ownerId,
        assignedAgentId: bodyParsed.data.assignedAgentId || null,
      });
      return reply.send({ message: 'Agent lead CRM berhasil diupdate', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal mengganti agent lead CRM');
    }
  });

  fastify.post('/entries/:id/archive', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const bodyParsed = archiveBodySchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(bodyParsed.success ? {} : bodyParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await archiveCrmEntry({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        entryId: paramsParsed.data.id,
        createdByUserId: request.user.ownerId,
      });
      return reply.send({ message: 'Lead CRM berhasil diarsipkan', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal mengarsipkan lead CRM');
    }
  });

  fastify.post('/entries/:id/restore', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const bodyParsed = workspaceQuerySchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(bodyParsed.success ? {} : bodyParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await restoreCrmEntry({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        entryId: paramsParsed.data.id,
        createdByUserId: request.user.ownerId,
      });
      return reply.send({ message: 'Lead CRM berhasil dikembalikan dari arsip', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal mengembalikan lead CRM dari arsip');
    }
  });

  fastify.delete('/entries/:id/permanent', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const queryParsed = workspaceQuerySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(queryParsed.success ? {} : queryParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await permanentDeleteCrmEntry({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        entryId: paramsParsed.data.id,
        createdByUserId: request.user.ownerId,
      });
      return reply.send({ message: 'Lead CRM berhasil dihapus permanen', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal menghapus permanen lead CRM');
    }
  });

  fastify.get('/entries/:id/notes', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const queryParsed = workspaceQuerySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(queryParsed.success ? {} : queryParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await listCrmEntryNotes({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        entryId: paramsParsed.data.id,
      });
      return reply.send(result);
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal memuat note CRM');
    }
  });

  fastify.post('/entries/:id/notes', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const bodyParsed = noteBodySchema.safeParse(request.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(bodyParsed.success ? {} : bodyParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await createCrmEntryNote({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        entryId: paramsParsed.data.id,
        createdByUserId: request.user.ownerId,
        content: bodyParsed.data.content,
      });
      return reply.code(201).send({ message: 'Note CRM berhasil ditambahkan', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal menambahkan note CRM');
    }
  });

  fastify.delete('/notes/:id', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const queryParsed = noteDeleteQuerySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(queryParsed.success ? {} : queryParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await deleteCrmEntryNote({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        noteId: paramsParsed.data.id,
      });
      return reply.send({ message: 'Note CRM berhasil dihapus', ...result });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal menghapus note CRM');
    }
  });

  fastify.get('/entries/:id/activities', async (request, reply) => {
    const paramsParsed = entryParamsSchema.safeParse(request.params);
    const queryParsed = workspaceQuerySchema.safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: {
          ...(paramsParsed.success ? {} : paramsParsed.error.flatten().fieldErrors),
          ...(queryParsed.success ? {} : queryParsed.error.flatten().fieldErrors),
        },
      });
    }

    try {
      const result = await listCrmActivities({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        customerPipelineEntryId: paramsParsed.data.id,
      });
      return reply.send(result);
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal memuat activity CRM');
    }
  });

  fastify.get('/dashboard-summary', async (request, reply) => {
    const parsed = entryListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const summary = await getCrmDashboardSummary({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: parsed.data,
      });
      return reply.send({ summary });
    } catch (error) {
      return sendCrmError(reply, error, 'Gagal memuat dashboard summary CRM');
    }
  });
}
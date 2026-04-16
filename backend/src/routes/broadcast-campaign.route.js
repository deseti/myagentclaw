import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  broadcastCampaignService,
  BroadcastCampaignServiceError,
} from '../services/broadcast-campaign.service.js';

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

function normalizeOptionalDate(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

function sendBroadcastError(reply, error, fallbackMessage = 'Gagal memproses Broadcast Campaign') {
  if (error instanceof BroadcastCampaignServiceError) {
    return reply.code(error.statusCode).send({
      error: 'Broadcast Campaign Error',
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

const campaignParamsSchema = z.object({
  id: z.string().min(1),
});

const audienceFilterSchema = z.object({
  filterType: z.string().min(1),
  includeMode: z.string().optional(),
  operator: z.preprocess(normalizeOptionalNullableText, z.string().max(80).nullable().optional()),
  position: z.coerce.number().int().min(0).optional(),
  valueJson: z.any().optional(),
});

const previewAudienceSchema = z.object({
  workspaceId: z.string().min(1),
  assignedAgentId: z.string().min(1),
  channelType: z.enum(['TELEGRAM', 'WHATSAPP']),
  audienceFilters: z.array(audienceFilterSchema).max(50).optional().default([]),
});

const listCampaignsQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

const createCampaignSchema = z.object({
  workspaceId: z.string().min(1),
  assignedAgentId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  description: z.preprocess(normalizeOptionalNullableText, z.string().max(4000).nullable().optional()),
  messageTemplate: z.string().trim().min(1).max(20000),
  channelType: z.enum(['TELEGRAM', 'WHATSAPP']),
  status: z.enum(['DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  scheduledAt: z.preprocess(normalizeOptionalDate, z.coerce.date().optional()),
  audienceFilters: z.array(audienceFilterSchema).max(50).optional().default([]),
});

const updateCampaignSchema = z.object({
  workspaceId: z.string().min(1),
  assignedAgentId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.preprocess(normalizeOptionalNullableText, z.string().max(4000).nullable().optional()),
  messageTemplate: z.string().trim().min(1).max(20000).optional(),
  channelType: z.enum(['TELEGRAM', 'WHATSAPP']).optional(),
  status: z.enum(['DRAFT', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  scheduledAt: z.preprocess(normalizeOptionalDate, z.coerce.date().optional()),
  audienceFilters: z.array(audienceFilterSchema).max(50).optional(),
});

const recipientQuerySchema = z.object({
  workspaceId: z.string().min(1),
  recipientStatus: z.enum(['PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED']).optional(),
});

export default async function broadcastCampaignRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/', async (request, reply) => {
    const parsed = listCampaignsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await broadcastCampaignService.listBroadcastCampaigns({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
      });
      return reply.send(result);
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal memuat daftar broadcast campaign');
    }
  });

  fastify.get('/analytics/summary', async (request, reply) => {
    const parsed = workspaceQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await broadcastCampaignService.getBroadcastAnalyticsSummary({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
      });
      return reply.send(result);
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal memuat analytics broadcast campaign');
    }
  });

  fastify.post('/audience-preview', async (request, reply) => {
    const parsed = previewAudienceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await broadcastCampaignService.previewBroadcastAudience({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        assignedAgentId: parsed.data.assignedAgentId,
        channelType: parsed.data.channelType,
        audienceFilters: parsed.data.audienceFilters,
      });
      return reply.send(result);
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal mempreview audience broadcast campaign');
    }
  });

  fastify.post('/', async (request, reply) => {
    const parsed = createCampaignSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await broadcastCampaignService.createBroadcastCampaign({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        createdById: request.user.ownerId,
        payload: parsed.data,
      });
      return reply.code(201).send({ message: 'Broadcast campaign berhasil dibuat', ...result });
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal membuat broadcast campaign');
    }
  });

  fastify.get('/:id', async (request, reply) => {
    const paramsParsed = campaignParamsSchema.safeParse(request.params);
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
      const result = await broadcastCampaignService.getBroadcastCampaignDetail({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        campaignId: paramsParsed.data.id,
      });
      return reply.send(result);
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal memuat detail broadcast campaign');
    }
  });

  fastify.put('/:id', async (request, reply) => {
    const paramsParsed = campaignParamsSchema.safeParse(request.params);
    const bodyParsed = updateCampaignSchema.safeParse(request.body);
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
      const result = await broadcastCampaignService.updateBroadcastCampaign({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        campaignId: paramsParsed.data.id,
        payload: bodyParsed.data,
      });
      return reply.send({ message: 'Broadcast campaign berhasil diupdate', ...result });
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal mengupdate broadcast campaign');
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    const paramsParsed = campaignParamsSchema.safeParse(request.params);
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
      const result = await broadcastCampaignService.deleteBroadcastCampaign({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        campaignId: paramsParsed.data.id,
      });
      return reply.send({ message: 'Broadcast campaign berhasil dihapus', ...result });
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal menghapus broadcast campaign');
    }
  });

  fastify.post('/:id/duplicate', async (request, reply) => {
    const paramsParsed = campaignParamsSchema.safeParse(request.params);
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
      const result = await broadcastCampaignService.duplicateBroadcastCampaign({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        campaignId: paramsParsed.data.id,
        createdById: request.user.ownerId,
      });
      return reply.code(201).send({ message: 'Broadcast campaign berhasil diduplikasi', ...result });
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal menduplikasi broadcast campaign');
    }
  });

  fastify.post('/:id/cancel', async (request, reply) => {
    const paramsParsed = campaignParamsSchema.safeParse(request.params);
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
      const result = await broadcastCampaignService.cancelBroadcastCampaign({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        campaignId: paramsParsed.data.id,
      });
      return reply.send({ message: 'Broadcast campaign berhasil dibatalkan', ...result });
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal membatalkan broadcast campaign');
    }
  });

  fastify.get('/:id/recipients', async (request, reply) => {
    const paramsParsed = campaignParamsSchema.safeParse(request.params);
    const queryParsed = recipientQuerySchema.safeParse(request.query);
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
      const result = await broadcastCampaignService.listBroadcastRecipients({
        ownerId: request.user.ownerId,
        workspaceId: queryParsed.data.workspaceId,
        campaignId: paramsParsed.data.id,
        recipientStatus: queryParsed.data.recipientStatus,
      });
      return reply.send(result);
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal memuat delivery log broadcast campaign');
    }
  });

  fastify.post('/:id/retry-failed', async (request, reply) => {
    const paramsParsed = campaignParamsSchema.safeParse(request.params);
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
      const result = await broadcastCampaignService.retryFailedBroadcastRecipients({
        ownerId: request.user.ownerId,
        workspaceId: bodyParsed.data.workspaceId,
        campaignId: paramsParsed.data.id,
      });
      return reply.send({ message: 'Recipient gagal berhasil dijadwalkan ulang', ...result });
    } catch (error) {
      return sendBroadcastError(reply, error, 'Gagal menjadwalkan ulang recipient broadcast campaign');
    }
  });
}
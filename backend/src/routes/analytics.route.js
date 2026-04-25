import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  AnalyticsDashboardServiceError,
  getAnalyticsDashboardBundle,
  getAnalyticsStatus,
} from '../services/analytics-dashboard.service.js';

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function sendAnalyticsError(reply, error, fallbackMessage = 'Gagal memuat Analytics Dashboard') {
  if (error instanceof AnalyticsDashboardServiceError) {
    return reply.code(error.statusCode).send({
      error: 'Analytics Dashboard Error',
      message: error.message,
      details: error.details,
    });
  }

  return reply.code(500).send({
    error: 'Internal Server Error',
    message: fallbackMessage,
  });
}

const analyticsQuerySchema = z.object({
  workspaceId: z.string().min(1),
  preset: z.enum(['today', '7d', '30d', 'custom']).optional(),
  startDate: z.preprocess(normalizeOptionalText, z.string().optional()),
  endDate: z.preprocess(normalizeOptionalText, z.string().optional()),
  agentId: z.preprocess(normalizeOptionalText, z.string().optional()),
  skillType: z.preprocess(normalizeOptionalText, z.string().optional()),
  activityType: z.preprocess(normalizeOptionalText, z.string().optional()),
});

function buildFilters(query) {
  return {
    preset: query.preset,
    startDate: query.startDate,
    endDate: query.endDate,
    agentId: query.agentId,
    skillType: query.skillType,
    activityType: query.activityType,
  };
}

export default async function analyticsRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/status', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await getAnalyticsStatus({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send(result);
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat status Analytics Dashboard');
    }
  });

  fastify.get('/dashboard-data', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const result = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send(result);
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat data Analytics Dashboard');
    }
  });

  fastify.get('/summary', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        skillStatus: bundle.skillStatus,
        tierAccess: bundle.tierAccess,
        capabilityCoverage: bundle.capabilityCoverage,
        workspaceSummary: bundle.workspaceSummary,
        summary: bundle.summary,
        emptyState: bundle.emptyState,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat KPI summary analytics');
    }
  });

  fastify.get('/charts', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        charts: bundle.charts,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat chart analytics');
    }
  });

  fastify.get('/recent-activity', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        recentActivity: bundle.recentActivity,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat recent activity analytics');
    }
  });

  fastify.get('/top-agents', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        topAgents: bundle.topAgents,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat analytics performa agent');
    }
  });

  fastify.get('/top-skills', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        topSkills: bundle.topSkills,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat skill usage analytics');
    }
  });

  fastify.get('/top-crm-stages', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        topCrmStages: bundle.topCrmStages,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat top CRM stages analytics');
    }
  });

  fastify.get('/revenue-estimate', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        revenueEstimate: bundle.revenueEstimate,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat revenue estimate analytics');
    }
  });

  fastify.get('/lead-conversion', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        leadConversion: bundle.leadConversion,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat lead conversion analytics');
    }
  });

  fastify.get('/broadcast-performance', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        broadcastPerformance: bundle.broadcastPerformance,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat broadcast performance analytics');
    }
  });

  fastify.get('/appointment-performance', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        appointmentPerformance: bundle.appointmentPerformance,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat appointment performance analytics');
    }
  });

  fastify.get('/payment-performance', async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const bundle = await getAnalyticsDashboardBundle({
        ownerId: request.user.ownerId,
        workspaceId: parsed.data.workspaceId,
        filters: buildFilters(parsed.data),
      });

      return reply.send({
        filters: bundle.filters,
        meta: bundle.meta,
        paymentPerformance: bundle.paymentPerformance,
      });
    } catch (error) {
      return sendAnalyticsError(reply, error, 'Gagal memuat payment reminder analytics');
    }
  });
}
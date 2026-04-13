import prisma from '../../lib/prisma.js';
import { ocListInstalledSkills } from '../../lib/openclaw-client.js';
import { enqueuePolymarketAutopilotRun } from '../../queues/polymarket-autopilot.worker.js';
import { ensureWorkspaceRuntime } from '../../lib/runtime-manager.js';
import { agentHasAssignedSkill, matchesSkillKey, workspaceHasAssignedSkill } from '../../lib/skill-activation.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../../lib/internal-skills.js';
import { getPolymarketAutopilotMonitoringSnapshot } from '../../lib/polymarket-autopilot-monitoring.js';
import { reconcilePolymarketAutopilotWorkspace } from '../../lib/polymarket-autopilot-reconciliation.js';
import {
  AUTOPILOT_LIVE_EXECUTION_ENABLED,
  POLYMARKET_AUTOPILOT_SKILL_KEY,
  autopilotPauseBodySchema,
  autopilotListQuerySchema,
  autopilotWorkspaceBodySchema,
  buildStoredAutopilotPayload,
  serializeAutopilotConfig,
  serializeAutopilotDecision,
  serializeAutopilotRun,
  validateAutopilotConfigPayload,
} from '../../lib/polymarket-autopilot.js';

const POLYMARKET_SKILL_KEY = POLYMARKET_AUTOPILOT_SKILL_KEY;
const POLYMARKET_AUTOPILOT_SKILL_DEFINITION = getInternalSkillDefinition(POLYMARKET_SKILL_KEY);

const agentParamsSchema = autopilotWorkspaceBodySchema.extend({
  agentId: autopilotWorkspaceBodySchema.shape.workspaceId,
}).pick({ agentId: true });

function resolveAgentRunMode(config) {
  if (!config || config.status !== 'ACTIVE') return 'UNAVAILABLE';
  return AUTOPILOT_LIVE_EXECUTION_ENABLED && config.executionConfigJson?.dryRun === false
    ? 'LIVE_EXECUTION'
    : 'DRY_RUN';
}

async function resolveAgentAutopilotContext(agentId, reply) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      status: true,
      openclawSkill: true,
      configJson: true,
      workspace: {
        select: {
          id: true,
          ownerId: true,
          subTier: true,
          subStatus: true,
        },
      },
    },
  });

  if (!agent) {
    reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
    return null;
  }

  if (agent.status !== 'ACTIVE') {
    reply.code(403).send({ error: 'Forbidden', message: 'Agent tidak aktif' });
    return null;
  }

  if (!agentHasAssignedSkill(agent, POLYMARKET_SKILL_KEY)) {
    reply.code(403).send({
      error: 'Forbidden',
      message: 'Skill autopilot belum aktif pada agent ini.',
      requiredSkill: POLYMARKET_SKILL_KEY,
    });
    return null;
  }

  const workspace = await assertInternalGrowthWorkspaceAccess(agent.workspace?.id, reply);
  if (!workspace) return null;

  return { agent, workspace };
}

async function assertInternalGrowthWorkspaceAccess(workspaceId, reply) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, ownerId: true, subTier: true, subStatus: true },
  });

  if (!workspace) {
    reply.code(404).send({ error: 'Not Found', message: 'Workspace tidak ditemukan' });
    return null;
  }

  if (!workspaceMeetsMinimumTier(workspace.subTier, POLYMARKET_AUTOPILOT_SKILL_DEFINITION?.minimumTier || 'GROWTH')) {
    reply.code(403).send({
      error: 'Forbidden',
      message: `Autopilot Polymarket memerlukan minimum paket ${formatInternalSkillTierLabel(POLYMARKET_AUTOPILOT_SKILL_DEFINITION?.minimumTier)}.`,
    });
    return null;
  }

  try {
    const runtime = await ensureWorkspaceRuntime(workspace);
    const installedPayload = await ocListInstalledSkills(runtime);
    const installedSkills = Array.isArray(installedPayload?.skills) ? installedPayload.skills : [];
    const skillInstalled = installedSkills.some((skill) => matchesSkillKey(skill, POLYMARKET_SKILL_KEY));

    if (!skillInstalled) {
      reply.code(403).send({
        error: 'Forbidden',
        message: 'Skill built-in autopilot Polymarket belum diinstall untuk workspace ini.',
        requiredSkill: POLYMARKET_SKILL_KEY,
      });
      return null;
    }

    const skillActive = await workspaceHasAssignedSkill(workspace.id, POLYMARKET_SKILL_KEY);
    if (!skillActive) {
      reply.code(403).send({
        error: 'Forbidden',
        message: 'Skill autopilot sudah terinstall, tetapi belum aktif di workspace ini.',
        requiredSkill: POLYMARKET_SKILL_KEY,
      });
      return null;
    }
  } catch {
    reply.code(502).send({
      error: 'Bad Gateway',
      message: 'Gagal memverifikasi skill Polymarket di runtime workspace.',
    });
    return null;
  }

  return workspace;
}

export default async function internalPolymarketAutopilotRoute(fastify) {
  fastify.post('/run-workspace', async (request, reply) => {
    const parsed = autopilotWorkspaceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertInternalGrowthWorkspaceAccess(parsed.data.workspaceId, reply);
    if (!workspace) return;

    const config = await prisma.polymarketAutopilotConfig.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!config) {
      return reply.code(404).send({ error: 'Not Found', message: 'Config autopilot Polymarket belum dibuat.' });
    }

    if (config.status !== 'ACTIVE') {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Autopilot harus ACTIVE sebelum run-workspace dipanggil.',
        config: serializeAutopilotConfig(config),
      });
    }

    const validation = validateAutopilotConfigPayload(buildStoredAutopilotPayload(config));
    if (!validation.success) {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Config autopilot tidak valid untuk dijalankan.',
        validationErrors: validation.validationErrors || validation.errors || [],
      });
    }

    const job = await enqueuePolymarketAutopilotRun({
      workspaceId: workspace.id,
      trigger: 'INTERNAL',
      requestedBy: 'internal-route',
      dedupeWindowMs: 15_000,
    });

    return reply.code(202).send({
      accepted: true,
      executed: false,
      workspaceId: workspace.id,
      jobId: job.id,
    });
  });

  fastify.get('/agents/:agentId/status', async (request, reply) => {
    const parsed = agentParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const context = await resolveAgentAutopilotContext(parsed.data.agentId, reply);
    if (!context) return;

    const [config, latestRun, latestDecisions, monitoring] = await Promise.all([
      prisma.polymarketAutopilotConfig.findUnique({ where: { workspaceId: context.workspace.id } }),
      prisma.polymarketAutopilotRun.findFirst({
        where: { workspaceId: context.workspace.id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.polymarketAutopilotDecision.findMany({
        where: { workspaceId: context.workspace.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      getPolymarketAutopilotMonitoringSnapshot({ workspaceId: context.workspace.id }),
    ]);

    return reply.send({
      agentId: context.agent.id,
      workspaceId: context.workspace.id,
      tier: context.workspace.subTier,
      config: serializeAutopilotConfig(config),
      latestRun: latestRun ? serializeAutopilotRun(latestRun) : null,
      latestDecisions: latestDecisions.map(serializeAutopilotDecision),
      monitoringSummary: monitoring.summary,
      executionMode: resolveAgentRunMode(config),
      canTriggerDryRun: config?.status === 'ACTIVE',
      canTriggerLiveExecution: config?.status === 'ACTIVE' && AUTOPILOT_LIVE_EXECUTION_ENABLED && config?.executionConfigJson?.dryRun === false,
    });
  });

  fastify.get('/agents/:agentId/runs', async (request, reply) => {
    const paramsParsed = agentParamsSchema.safeParse(request.params);
    const queryParsed = autopilotListQuerySchema.omit({ workspaceId: true }).safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const context = await resolveAgentAutopilotContext(paramsParsed.data.agentId, reply);
    if (!context) return;

    const runs = await prisma.polymarketAutopilotRun.findMany({
      where: { workspaceId: context.workspace.id },
      orderBy: { createdAt: 'desc' },
      take: queryParsed.data.limit || 10,
    });

    return reply.send({
      agentId: context.agent.id,
      workspaceId: context.workspace.id,
      tier: context.workspace.subTier,
      runs: runs.map(serializeAutopilotRun),
    });
  });

  fastify.get('/agents/:agentId/decisions', async (request, reply) => {
    const paramsParsed = agentParamsSchema.safeParse(request.params);
    const queryParsed = autopilotListQuerySchema.omit({ workspaceId: true }).safeParse(request.query);
    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const context = await resolveAgentAutopilotContext(paramsParsed.data.agentId, reply);
    if (!context) return;

    const decisions = await prisma.polymarketAutopilotDecision.findMany({
      where: {
        workspaceId: context.workspace.id,
        ...(queryParsed.data.runId ? { runId: queryParsed.data.runId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: queryParsed.data.limit || 10,
    });

    return reply.send({
      agentId: context.agent.id,
      workspaceId: context.workspace.id,
      tier: context.workspace.subTier,
      decisions: decisions.map(serializeAutopilotDecision),
    });
  });

  fastify.post('/agents/:agentId/run', async (request, reply) => {
    const paramsParsed = agentParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const context = await resolveAgentAutopilotContext(paramsParsed.data.agentId, reply);
    if (!context) return;

    const config = await prisma.polymarketAutopilotConfig.findUnique({
      where: { workspaceId: context.workspace.id },
    });

    if (!config) {
      return reply.code(404).send({ error: 'Not Found', message: 'Config autopilot Polymarket belum dibuat.' });
    }

    if (config.status !== 'ACTIVE') {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Autopilot harus ACTIVE sebelum agent dapat memicu run.',
        config: serializeAutopilotConfig(config),
      });
    }

    const executionMode = resolveAgentRunMode(config);

    const job = await enqueuePolymarketAutopilotRun({
      workspaceId: context.workspace.id,
      trigger: 'AGENT',
      requestedBy: `agent:${context.agent.id}`,
      dedupeWindowMs: 15_000,
    });

    return reply.code(202).send({
      accepted: true,
      executed: false,
      agentId: context.agent.id,
      workspaceId: context.workspace.id,
      jobId: job.id,
      executionMode,
      message: executionMode === 'LIVE_EXECUTION'
        ? 'Run autopilot live execution berhasil diantrikan oleh agent.'
        : 'Run autopilot dry-run berhasil diantrikan oleh agent.',
    });
  });

  fastify.post('/reconcile-workspace', async (request, reply) => {
    const parsed = autopilotWorkspaceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertInternalGrowthWorkspaceAccess(parsed.data.workspaceId, reply);
    if (!workspace) return;

    const result = await reconcilePolymarketAutopilotWorkspace({
      workspaceId: workspace.id,
      trigger: 'INTERNAL',
      autoStopOnCritical: true,
    });

    return reply.send(result);
  });

  fastify.post('/emergency-stop', async (request, reply) => {
    const parsed = autopilotPauseBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertInternalGrowthWorkspaceAccess(parsed.data.workspaceId, reply);
    if (!workspace) return;

    const config = await prisma.polymarketAutopilotConfig.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!config) {
      return reply.code(404).send({ error: 'Not Found', message: 'Config autopilot Polymarket belum dibuat.' });
    }

    const updated = await prisma.polymarketAutopilotConfig.update({
      where: { workspaceId: workspace.id },
      data: {
        status: 'EMERGENCY_STOP',
        pausedReason: parsed.data.reason || 'Emergency stop internal',
        emergencyStoppedAt: new Date(),
      },
    });

    return reply.send({
      message: 'Emergency stop autopilot Polymarket aktif melalui internal route.',
      workspaceId: workspace.id,
      config: serializeAutopilotConfig(updated),
    });
  });
}
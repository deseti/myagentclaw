import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { ocListInstalledSkills } from '../lib/openclaw-client.js';
import { enqueuePolymarketAutopilotRun } from '../queues/polymarket-autopilot.worker.js';
import { ensureWorkspaceRuntime } from '../lib/runtime-manager.js';
import { matchesSkillKey, workspaceHasAssignedSkill } from '../lib/skill-activation.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../lib/internal-skills.js';
import { getPolymarketAutopilotMonitoringSnapshot } from '../lib/polymarket-autopilot-monitoring.js';
import { reconcilePolymarketAutopilotWorkspace } from '../lib/polymarket-autopilot-reconciliation.js';
import {
  AUTOPILOT_LIVE_EXECUTION_ENABLED,
  AUTOPILOT_STRATEGY_TYPES,
  POLYMARKET_AUTOPILOT_SKILL_KEY,
  autopilotConfigBodySchema,
  autopilotListQuerySchema,
  autopilotPauseBodySchema,
  autopilotWorkspaceBodySchema,
  buildStoredAutopilotPayload,
  serializeAutopilotConfig,
  serializeAutopilotDecision,
  serializeAutopilotRun,
  validateAutopilotConfigPayload,
} from '../lib/polymarket-autopilot.js';

const POLYMARKET_SKILL_KEY = POLYMARKET_AUTOPILOT_SKILL_KEY;
const POLYMARKET_AUTOPILOT_SKILL_DEFINITION = getInternalSkillDefinition(POLYMARKET_SKILL_KEY);

function hasAutopilotCredentials(profile) {
  return Boolean(
    profile?.encryptedPrivateKey
    && profile?.encryptedApiKey
    && profile?.encryptedApiSecret
    && profile?.encryptedApiPassphrase
    && profile?.credentialsLastVerifiedAt
    && !profile?.credentialsLastError,
  );
}

async function assertGrowthAutopilotAccess(ownerId, workspaceId, reply) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId },
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
    const runtime = await ensureWorkspaceRuntime({ ...workspace, ownerId });
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
        message: 'Skill autopilot sudah terinstall, tetapi belum aktif. Assign skill ini ke minimal satu agent sebelum scheduler atau panel dipakai.',
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

export default async function polymarketAutopilotRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/config', async (request, reply) => {
    const parsed = autopilotWorkspaceBodySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const config = await prisma.polymarketAutopilotConfig.findUnique({
      where: { workspaceId: workspace.id },
    });

    return reply.send({
      workspaceId: workspace.id,
      tier: workspace.subTier,
      supportedStrategies: AUTOPILOT_STRATEGY_TYPES,
      contract: {
        liveExecutionEnabled: AUTOPILOT_LIVE_EXECUTION_ENABLED,
      },
      config: serializeAutopilotConfig(config),
    });
  });

  fastify.put('/config', async (request, reply) => {
    const parsed = autopilotConfigBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const existing = await prisma.polymarketAutopilotConfig.findUnique({
      where: { workspaceId: workspace.id },
    });

    const validation = validateAutopilotConfigPayload(parsed.data);
    if (!validation.normalized) {
      return reply.code(400).send({ error: 'Validation error', details: validation.errors || {} });
    }

    const nextStatus = existing?.status === 'EMERGENCY_STOP'
      ? 'EMERGENCY_STOP'
      : validation.nextStatus;

    const config = await prisma.polymarketAutopilotConfig.upsert({
      where: { workspaceId: workspace.id },
      update: {
        ownerId: request.user.ownerId,
        status: nextStatus,
        strategyType: validation.normalized.strategyType,
        strategyConfigJson: validation.normalized.strategyConfig,
        riskConfigJson: validation.normalized.riskConfig,
        marketScopeJson: validation.normalized.marketScope,
        executionConfigJson: validation.normalized.executionConfig,
        lastValidatedAt: new Date(),
        lastValidationError: validation.lastValidationError,
      },
      create: {
        workspaceId: workspace.id,
        ownerId: request.user.ownerId,
        status: nextStatus,
        strategyType: validation.normalized.strategyType,
        strategyConfigJson: validation.normalized.strategyConfig,
        riskConfigJson: validation.normalized.riskConfig,
        marketScopeJson: validation.normalized.marketScope,
        executionConfigJson: validation.normalized.executionConfig,
        lastValidatedAt: new Date(),
        lastValidationError: validation.lastValidationError,
      },
    });

    return reply.send({
      message: validation.success
        ? 'Config autopilot Polymarket tersimpan dan siap untuk tahap contract-only.'
        : 'Config autopilot Polymarket tersimpan sebagai draft karena masih ada validation error.',
      workspaceId: workspace.id,
      tier: workspace.subTier,
      valid: validation.success,
      validationErrors: validation.validationErrors || validation.errors || {},
      config: serializeAutopilotConfig(config),
    });
  });

  fastify.post('/validate', async (request, reply) => {
    const parsed = autopilotConfigBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const validation = validateAutopilotConfigPayload(parsed.data);
    if (!validation.normalized) {
      return reply.code(400).send({ error: 'Validation error', details: validation.errors || {} });
    }

    return reply.send({
      workspaceId: workspace.id,
      tier: workspace.subTier,
      valid: validation.success,
      nextStatus: validation.nextStatus,
      validationErrors: validation.validationErrors || [],
      normalizedConfig: validation.normalized,
      contract: validation.contract,
    });
  });

  fastify.post('/activate', async (request, reply) => {
    const parsed = autopilotWorkspaceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const config = await prisma.polymarketAutopilotConfig.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!config) {
      return reply.code(404).send({ error: 'Not Found', message: 'Config autopilot Polymarket belum dibuat.' });
    }

    const validation = validateAutopilotConfigPayload(buildStoredAutopilotPayload(config));
    if (!validation.success) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Config autopilot belum valid untuk diaktifkan.',
        validationErrors: validation.validationErrors || validation.errors || [],
      });
    }

    const profile = await prisma.polymarketProfile.findUnique({
      where: { workspaceId: workspace.id },
    });

    if (!hasAutopilotCredentials(profile)) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Credential trading Polymarket belum siap atau belum diverifikasi untuk autopilot Growth.',
      });
    }

    const updated = await prisma.polymarketAutopilotConfig.update({
      where: { workspaceId: workspace.id },
      data: {
        status: 'ACTIVE',
        pausedReason: null,
        emergencyStoppedAt: null,
        lastValidatedAt: new Date(),
        lastValidationError: null,
      },
    });

    const liveMode = AUTOPILOT_LIVE_EXECUTION_ENABLED && updated.executionConfigJson?.dryRun === false;

    return reply.send({
      message: liveMode
        ? 'Autopilot Polymarket aktif dalam mode live execution untuk workspace Growth ini.'
        : 'Autopilot Polymarket aktif dalam mode dry-run. Worker scheduler akan membuat proposal tanpa eksekusi live.',
      workspaceId: workspace.id,
      tier: workspace.subTier,
      config: serializeAutopilotConfig(updated),
    });
  });

  fastify.post('/run', async (request, reply) => {
    const parsed = autopilotWorkspaceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
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
        message: 'Autopilot harus ACTIVE sebelum dry-run bisa dijalankan.',
        config: serializeAutopilotConfig(config),
      });
    }

    const job = await enqueuePolymarketAutopilotRun({
      workspaceId: workspace.id,
      trigger: 'MANUAL',
      requestedBy: `owner:${request.user.ownerId}`,
      dedupeWindowMs: 15_000,
    });

    return reply.code(202).send({
      accepted: true,
      executed: false,
      workspaceId: workspace.id,
      jobId: job.id,
      message: 'Dry-run autopilot Polymarket berhasil diantrikan.',
    });
  });

  fastify.post('/pause', async (request, reply) => {
    const parsed = autopilotPauseBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
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
        status: 'PAUSED',
        pausedReason: parsed.data.reason || 'Paused manually',
      },
    });

    return reply.send({
      message: 'Autopilot Polymarket dipause.',
      workspaceId: workspace.id,
      tier: workspace.subTier,
      config: serializeAutopilotConfig(updated),
    });
  });

  fastify.post('/emergency-stop', async (request, reply) => {
    const parsed = autopilotPauseBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
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
        pausedReason: parsed.data.reason || 'Emergency stop manual',
        emergencyStoppedAt: new Date(),
      },
    });

    return reply.send({
      message: 'Emergency stop autopilot Polymarket aktif.',
      workspaceId: workspace.id,
      tier: workspace.subTier,
      config: serializeAutopilotConfig(updated),
    });
  });

  fastify.get('/runs', async (request, reply) => {
    const parsed = autopilotListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const runs = await prisma.polymarketAutopilotRun.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit || 20,
    });

    return reply.send({
      workspaceId: workspace.id,
      tier: workspace.subTier,
      runs: runs.map(serializeAutopilotRun),
    });
  });

  fastify.get('/decisions', async (request, reply) => {
    const parsed = autopilotListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const decisions = await prisma.polymarketAutopilotDecision.findMany({
      where: {
        workspaceId: workspace.id,
        ...(parsed.data.runId ? { runId: parsed.data.runId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit || 20,
    });

    return reply.send({
      workspaceId: workspace.id,
      tier: workspace.subTier,
      decisions: decisions.map(serializeAutopilotDecision),
    });
  });

  fastify.get('/monitoring', async (request, reply) => {
    const parsed = autopilotWorkspaceBodySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const snapshot = await getPolymarketAutopilotMonitoringSnapshot({ workspaceId: workspace.id });

    return reply.send({
      workspaceId: workspace.id,
      tier: workspace.subTier,
      ...snapshot,
    });
  });

  fastify.post('/reconcile', async (request, reply) => {
    const parsed = autopilotWorkspaceBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertGrowthAutopilotAccess(request.user.ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const result = await reconcilePolymarketAutopilotWorkspace({
      workspaceId: workspace.id,
      trigger: 'DASHBOARD',
      autoStopOnCritical: true,
    });

    return reply.send({
      workspaceId: workspace.id,
      tier: workspace.subTier,
      ...result,
    });
  });
}
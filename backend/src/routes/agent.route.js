import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  getPrimaryAgentSkill,
  mergeAgentConfig,
  normalizeAssignedSkills,
  normalizeSharedWorkspaceAccess,
} from '../lib/agent-config.js';
import {
  generateApprovalCode,
  normalizeAgentAccessMode,
} from '../lib/agent-access.js';
import { syncAgentToGateway } from '../lib/agent-provisioner.js';
import { ocListInstalledSkills } from '../lib/openclaw-client.js';
import { ensureWorkspaceRuntime } from '../lib/runtime-manager.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../lib/internal-skills.js';
import {
  getAppointmentSchedulerConfig,
  APPOINTMENT_SCHEDULER_SKILL_KEY,
} from '../lib/appointment-scheduler.js';
import {
  BROADCAST_CAMPAIGN_SKILL_KEY,
} from '../lib/broadcast-campaign.js';
import {
  ANALYTICS_DASHBOARD_SKILL_KEY,
} from '../lib/analytics-dashboard.js';
import {
  AI_PROVIDER_DB_VALUE,
  getAiProviderConfig,
} from '../lib/ai-provider-config.js';
import { matchesSkillKey } from '../lib/skill-activation.js';
import { syncAgentAppointmentAvailability } from '../services/appointment.service.js';

const DEFAULT_AI_PROVIDER = AI_PROVIDER_DB_VALUE;
const DEFAULT_AI_PROVIDER_MODEL = getAiProviderConfig().model;
const hourPattern = /^(\d{1,2})(?::(\d{2}))?$/;

// Limit jumlah agent per tier
const AGENT_LIMIT = {
  FREE: 1,
  STARTER: 2,
  GROWTH: 5,
  PRO: 5,
};

function workspaceCanUseSkills(workspace) {
  return workspace?.subTier && workspace.subTier !== 'FREE';
}

function workspaceCanUseSharedWorkspace(workspace) {
  return workspace?.subTier && workspace.subTier !== 'FREE';
}

function requestedSkills(payload) {
  if (Object.prototype.hasOwnProperty.call(payload, 'assignedSkills')) {
    return normalizeAssignedSkills(payload.assignedSkills);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'openclawSkill')) {
    return normalizeAssignedSkills(payload.openclawSkill);
  }
  return [];
}

async function assertRequestedSkillsReady({ ownerId, workspace, skillKeys, reply }) {
  const uniqueSkills = [...new Set((skillKeys || []).filter(Boolean))];
  if (uniqueSkills.length === 0) {
    return true;
  }

  try {
    const runtime = await ensureWorkspaceRuntime({ ...workspace, ownerId });
    const installedPayload = await ocListInstalledSkills(runtime);
    const installedSkills = Array.isArray(installedPayload?.skills) ? installedPayload.skills : [];

    for (const skillKey of uniqueSkills) {
      const internalSkill = getInternalSkillDefinition(skillKey);

      if (internalSkill?.isComingSoon) {
        reply.code(403).send({
          error: 'Forbidden',
          message: `Skill ${internalSkill.displayName || skillKey} masih Coming Soon dan belum bisa dipakai agent.`,
        });
        return false;
      }

      if (internalSkill && !workspaceMeetsMinimumTier(workspace.subTier, internalSkill.minimumTier)) {
        reply.code(403).send({
          error: 'Forbidden',
          message: `Skill ${internalSkill.displayName || skillKey} memerlukan minimum paket ${formatInternalSkillTierLabel(internalSkill.minimumTier)}.`,
        });
        return false;
      }

      const installed = installedSkills.some((skill) => matchesSkillKey(skill, skillKey));
      if (!installed) {
        reply.code(403).send({
          error: 'Forbidden',
          message: `Skill ${skillKey} belum diinstall di runtime workspace ini.`,
        });
        return false;
      }
    }

    return true;
  } catch {
    reply.code(502).send({
      error: 'Bad Gateway',
      message: 'Gagal memverifikasi skill agent di runtime workspace.',
    });
    return false;
  }
}

function assertSkillAccessModeRestrictions({ skillKeys, accessMode, reply }) {
  const uniqueSkills = [...new Set((skillKeys || []).filter(Boolean))];
  const normalizedAccessMode = normalizeAgentAccessMode(accessMode);

  if (
    uniqueSkills.includes(BROADCAST_CAMPAIGN_SKILL_KEY)
    && normalizedAccessMode !== 'APPROVAL_REQUIRED'
  ) {
    reply.code(403).send({
      error: 'Forbidden',
      message: 'Broadcast Campaign hanya boleh dipakai agent dengan access mode Approval Required.',
    });
    return false;
  }

  if (
    uniqueSkills.includes(ANALYTICS_DASHBOARD_SKILL_KEY)
    && normalizedAccessMode !== 'APPROVAL_REQUIRED'
  ) {
    reply.code(403).send({
      error: 'Forbidden',
      message: 'Analytics Dashboard hanya boleh dipakai agent dengan access mode Approval Required.',
    });
    return false;
  }

  return true;
}

const createAgentSchema = z.object({
  name: z.string().min(2).max(100),
  persona: z.string().min(10).max(2000),
  goal: z.string().min(5).max(2000).optional(),
  tone: z.string().max(100).optional(),
  role: z.string().max(100).optional(),
  systemPrompt: z.string().max(12000).optional(),
  openclawSkill: z.string().max(100).optional(),
  assignedSkills: z.array(z.string().min(1).max(100)).max(20).optional(),
  appointmentSchedulerConfig: z.object({
    enableBooking: z.boolean().optional(),
    enableReschedule: z.boolean().optional(),
    enableCancellation: z.boolean().optional(),
    enableReminder: z.boolean().optional(),
    enableAutoSuggestSlot: z.boolean().optional(),
    defaultMeetingDuration: z.coerce.number().int().min(15).max(480).optional(),
    workingHoursStart: z.string().regex(hourPattern).optional(),
    workingHoursEnd: z.string().regex(hourPattern).optional(),
    workingDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
    timezone: z.string().min(1).max(120).optional(),
  }).optional(),
  crmPipelineConfig: z.object({
    canManagePipeline: z.boolean().optional(),
    canMoveStage: z.boolean().optional(),
    canAssignLead: z.boolean().optional(),
    canViewAnalytics: z.boolean().optional(),
  }).optional(),
  broadcastCampaignConfig: z.object({
    canUseBroadcast: z.boolean().optional(),
    canCreateCampaign: z.boolean().optional(),
    canEditCampaign: z.boolean().optional(),
    canDeleteCampaign: z.boolean().optional(),
    canScheduleCampaign: z.boolean().optional(),
    canViewCampaignAnalytics: z.boolean().optional(),
  }).optional(),
  analyticsDashboardConfig: z.object({
    canViewAnalytics: z.boolean().optional(),
    canViewRevenueAnalytics: z.boolean().optional(),
    canViewAgentPerformance: z.boolean().optional(),
    canViewBroadcastAnalytics: z.boolean().optional(),
    canViewAppointmentAnalytics: z.boolean().optional(),
    canViewPaymentAnalytics: z.boolean().optional(),
  }).optional(),
  sharedWorkspaceAccess: z.enum(['none', 'ro', 'rw']).optional(),
  accessMode: z.enum(['OPEN_ACCESS', 'APPROVAL_REQUIRED']).optional(),
  workspaceId: z.string().min(1),
});

const updateAgentSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  persona: z.string().min(10).max(2000).optional(),
  goal: z.string().min(5).max(2000).optional(),
  tone: z.string().max(100).optional(),
  role: z.string().max(100).optional(),
  systemPrompt: z.string().max(12000).optional(),
  openclawSkill: z.string().max(100).optional(),
  assignedSkills: z.array(z.string().min(1).max(100)).max(20).optional(),
  appointmentSchedulerConfig: z.object({
    enableBooking: z.boolean().optional(),
    enableReschedule: z.boolean().optional(),
    enableCancellation: z.boolean().optional(),
    enableReminder: z.boolean().optional(),
    enableAutoSuggestSlot: z.boolean().optional(),
    defaultMeetingDuration: z.coerce.number().int().min(15).max(480).optional(),
    workingHoursStart: z.string().regex(hourPattern).optional(),
    workingHoursEnd: z.string().regex(hourPattern).optional(),
    workingDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).optional(),
    timezone: z.string().min(1).max(120).optional(),
  }).optional(),
  crmPipelineConfig: z.object({
    canManagePipeline: z.boolean().optional(),
    canMoveStage: z.boolean().optional(),
    canAssignLead: z.boolean().optional(),
    canViewAnalytics: z.boolean().optional(),
  }).optional(),
  broadcastCampaignConfig: z.object({
    canUseBroadcast: z.boolean().optional(),
    canCreateCampaign: z.boolean().optional(),
    canEditCampaign: z.boolean().optional(),
    canDeleteCampaign: z.boolean().optional(),
    canScheduleCampaign: z.boolean().optional(),
    canViewCampaignAnalytics: z.boolean().optional(),
  }).optional(),
  analyticsDashboardConfig: z.object({
    canViewAnalytics: z.boolean().optional(),
    canViewRevenueAnalytics: z.boolean().optional(),
    canViewAgentPerformance: z.boolean().optional(),
    canViewBroadcastAnalytics: z.boolean().optional(),
    canViewAppointmentAnalytics: z.boolean().optional(),
    canViewPaymentAnalytics: z.boolean().optional(),
  }).optional(),
  sharedWorkspaceAccess: z.enum(['none', 'ro', 'rw']).optional(),
  accessMode: z.enum(['OPEN_ACCESS', 'APPROVAL_REQUIRED']).optional(),
});

function buildAgentUpdateData(existing, payload) {
  const {
    role,
    systemPrompt,
    openclawSkill,
    assignedSkills,
    appointmentSchedulerConfig,
    crmPipelineConfig,
    broadcastCampaignConfig,
    analyticsDashboardConfig,
    sharedWorkspaceAccess,
    accessMode,
    ...rest
  } = payload;
  const configTouched = [
    'role',
    'systemPrompt',
    'openclawSkill',
    'assignedSkills',
    'appointmentSchedulerConfig',
    'crmPipelineConfig',
    'broadcastCampaignConfig',
    'analyticsDashboardConfig',
    'sharedWorkspaceAccess',
  ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));
  const nextAccessMode = Object.prototype.hasOwnProperty.call(payload, 'accessMode')
    ? normalizeAgentAccessMode(accessMode)
    : existing.accessMode;

  const nextPrimarySkill = configTouched
    ? (normalizeAssignedSkills(
      Object.prototype.hasOwnProperty.call(payload, 'assignedSkills') ? assignedSkills : openclawSkill,
    )[0] || null)
    : getPrimaryAgentSkill(existing);

  return {
    ...rest,
    ...(Object.prototype.hasOwnProperty.call(payload, 'accessMode')
      ? { accessMode: nextAccessMode }
      : {}),
    ...(nextAccessMode === 'APPROVAL_REQUIRED' && !existing.approvalCode
      ? { approvalCode: generateApprovalCode() }
      : {}),
    ...(configTouched
      ? { openclawSkill: nextPrimarySkill }
      : {}),
    ...(configTouched
      ? { configJson: mergeAgentConfig(existing.configJson, { ...payload, sharedWorkspaceAccess }) }
      : {}),
  };
}

async function syncAppointmentSchedulerConfigForAgent({
  workspaceId,
  agentId,
  assignedSkills,
  appointmentSchedulerConfig,
  configSource,
}) {
  if (!assignedSkills.includes(APPOINTMENT_SCHEDULER_SKILL_KEY)) {
    await syncAgentAppointmentAvailability({
      workspaceId,
      agentId,
      config: null,
    });
    return;
  }

  const normalizedConfig = appointmentSchedulerConfig !== undefined
    ? getAppointmentSchedulerConfig({ appointmentSchedulerConfig })
    : getAppointmentSchedulerConfig(configSource || {});

  await syncAgentAppointmentAvailability({
    workspaceId,
    agentId,
    config: normalizedConfig,
  });
}

export default async function agentRoute(fastify) {
  // Semua agent routes butuh JWT
  fastify.addHook('preHandler', authenticate);

  // Helper: pastikan workspace milik owner yang sedang login
  async function assertOwnsWorkspace(ownerId, workspaceId, reply) {
    const ws = await prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId },
      include: { subscriptions: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    if (!ws) {
      reply.code(404).send({ error: 'Not Found', message: 'Workspace tidak ditemukan' });
      return null;
    }
    return ws;
  }

  // GET /api/agents?workspaceId=xxx — list semua agent
  fastify.get('/', async (request, reply) => {
    const { ownerId } = request.user;
    const { workspaceId } = request.query;

    if (!workspaceId) {
      return reply.code(400).send({ error: 'Bad Request', message: 'workspaceId diperlukan' });
    }

    const ws = await assertOwnsWorkspace(ownerId, workspaceId, reply);
    if (!ws) return;

    const agents = await prisma.agent.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { channels: true, conversations: true } },
      },
    });

    return reply.send({ agents });
  });

  // GET /api/agents/:id — detail satu agent
  fastify.get('/:id', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const agent = await prisma.agent.findFirst({
      where: { id, workspace: { ownerId } },
      include: {
        workspace: { select: { id: true, name: true } },
        channels: { orderBy: { createdAt: 'desc' } },
        appointmentAvailabilities: {
          orderBy: [{ dayOfWeek: 'asc' }, { startHour: 'asc' }],
        },
        _count: { select: { conversations: true } },
      },
    });

    if (!agent) {
      return reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
    }

    return reply.send({ agent });
  });

  // POST /api/agents — buat agent baru
  fastify.post('/', async (request, reply) => {
    const { ownerId } = request.user;

    const parsed = createAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const {
      name,
      persona,
      goal,
      tone,
      role,
      systemPrompt,
      openclawSkill,
      assignedSkills,
      appointmentSchedulerConfig,
      crmPipelineConfig,
      broadcastCampaignConfig,
      analyticsDashboardConfig,
      sharedWorkspaceAccess,
      accessMode,
      workspaceId,
    } = parsed.data;
    const normalizedSkills = normalizeAssignedSkills(assignedSkills ?? openclawSkill);
    const normalizedSharedWorkspaceAccess = normalizeSharedWorkspaceAccess(sharedWorkspaceAccess);
    const normalizedAccessMode = normalizeAgentAccessMode(accessMode);

    const ws = await assertOwnsWorkspace(ownerId, workspaceId, reply);
    if (!ws) return;

    if (normalizedSkills.length > 0 && !workspaceCanUseSkills(ws)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Paket FREE belum mendukung fitur skill agent.',
      });
    }

    if (!await assertRequestedSkillsReady({
      ownerId,
      workspace: ws,
      skillKeys: normalizedSkills,
      reply,
    })) {
      return;
    }

    if (!assertSkillAccessModeRestrictions({
      skillKeys: normalizedSkills,
      accessMode: normalizedAccessMode,
      reply,
    })) {
      return;
    }

    if (normalizedSharedWorkspaceAccess !== 'none' && !workspaceCanUseSharedWorkspace(ws)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Paket FREE belum mendukung shared workspace antar agent.',
      });
    }

    // Cek limit agent berdasarkan tier
    const tier = ws.subTier || 'FREE';
    const limit = AGENT_LIMIT[tier] || 1;

    const currentCount = await prisma.agent.count({ where: { workspaceId } });
    if (currentCount >= limit) {
      return reply.code(403).send({
        error: 'Limit Reached',
        message: `Paket ${tier} hanya bisa membuat ${limit} agent. Upgrade paket untuk menambah lebih banyak agent.`,
        limit,
        current: currentCount,
      });
    }

    const agent = await prisma.agent.create({
      data: {
        workspaceId,
        name,
        persona,
        goal: goal || null,
        tone: tone || null,
        llmProvider: DEFAULT_AI_PROVIDER,
        llmModel: DEFAULT_AI_PROVIDER_MODEL,
        openclawSkill: normalizedSkills[0] || null,
        accessMode: normalizedAccessMode,
        approvalCode: generateApprovalCode(),
        configJson: mergeAgentConfig(null, {
          role,
          systemPrompt,
          assignedSkills: normalizedSkills,
          appointmentSchedulerConfig,
          crmPipelineConfig,
          broadcastCampaignConfig,
          analyticsDashboardConfig,
          sharedWorkspaceAccess: normalizedSharedWorkspaceAccess,
        }) || undefined,
        status: 'INACTIVE',
      },
    });

    await syncAppointmentSchedulerConfigForAgent({
      workspaceId,
      agentId: agent.id,
      assignedSkills: normalizedSkills,
      appointmentSchedulerConfig,
      configSource: agent,
    });

    // Provision ke openclaw gateway (fire and forget — jangan blok response)
    syncAgentToGateway(agent.id).catch((err) => {
      fastify.log.warn({ agentId: agent.id, err: err.message }, 'Failed to provision agent to openclaw gateway');
    });

    return reply.code(201).send({ message: 'Agent berhasil dibuat', agent });
  });

  // PATCH /api/agents/:id — update agent
  fastify.patch('/:id', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const parsed = updateAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const existing = await prisma.agent.findFirst({
      where: { id, workspace: { ownerId } },
      include: {
        workspace: {
          select: {
            id: true,
            ownerId: true,
            name: true,
            subTier: true,
          },
        },
        appointmentAvailabilities: {
          orderBy: [{ dayOfWeek: 'asc' }, { startHour: 'asc' }],
        },
      },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
    }

    if (requestedSkills(parsed.data).length > 0 && !workspaceCanUseSkills(existing.workspace)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Paket FREE belum mendukung fitur skill agent.',
      });
    }

    if (!await assertRequestedSkillsReady({
      ownerId,
      workspace: existing.workspace,
      skillKeys: requestedSkills(parsed.data),
      reply,
    })) {
      return;
    }

    const nextSkills = Object.prototype.hasOwnProperty.call(parsed.data, 'assignedSkills')
      ? normalizeAssignedSkills(parsed.data.assignedSkills)
      : normalizeAssignedSkills(existing.configJson?.assignedSkills || existing.openclawSkill);
    const nextAccessMode = Object.prototype.hasOwnProperty.call(parsed.data, 'accessMode')
      ? parsed.data.accessMode
      : existing.accessMode;

    if (!assertSkillAccessModeRestrictions({
      skillKeys: nextSkills,
      accessMode: nextAccessMode,
      reply,
    })) {
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(parsed.data, 'sharedWorkspaceAccess')
      && normalizeSharedWorkspaceAccess(parsed.data.sharedWorkspaceAccess) !== 'none'
      && !workspaceCanUseSharedWorkspace(existing.workspace)
    ) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Paket FREE belum mendukung shared workspace antar agent.',
      });
    }

    const agent = await prisma.agent.update({
      where: { id },
      data: buildAgentUpdateData(existing, parsed.data),
    });

    await syncAppointmentSchedulerConfigForAgent({
      workspaceId: existing.workspace.id,
      agentId: id,
      assignedSkills: normalizeAssignedSkills(
        Object.prototype.hasOwnProperty.call(parsed.data, 'assignedSkills')
          ? parsed.data.assignedSkills
          : agent.configJson?.assignedSkills || agent.openclawSkill,
      ),
      appointmentSchedulerConfig: Object.prototype.hasOwnProperty.call(parsed.data, 'appointmentSchedulerConfig')
        ? parsed.data.appointmentSchedulerConfig
        : undefined,
      configSource: agent,
    });

    syncAgentToGateway(id).catch((err) => {
      fastify.log.warn({ agentId: id, err: err.message }, 'Failed to sync updated agent to openclaw');
    });

    return reply.send({ message: 'Agent berhasil diupdate', agent });
  });

  // PUT /api/agents/:id — alias untuk PATCH (frontend compat)
  fastify.put('/:id', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const parsed = updateAgentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const existing = await prisma.agent.findFirst({
      where: { id, workspace: { ownerId } },
      include: {
        workspace: {
          select: {
            id: true,
            ownerId: true,
            name: true,
            subTier: true,
          },
        },
        appointmentAvailabilities: {
          orderBy: [{ dayOfWeek: 'asc' }, { startHour: 'asc' }],
        },
      },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
    }

    if (requestedSkills(parsed.data).length > 0 && !workspaceCanUseSkills(existing.workspace)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Paket FREE belum mendukung fitur skill agent.',
      });
    }

    if (!await assertRequestedSkillsReady({
      ownerId,
      workspace: existing.workspace,
      skillKeys: requestedSkills(parsed.data),
      reply,
    })) {
      return;
    }

    const nextSkills = Object.prototype.hasOwnProperty.call(parsed.data, 'assignedSkills')
      ? normalizeAssignedSkills(parsed.data.assignedSkills)
      : normalizeAssignedSkills(existing.configJson?.assignedSkills || existing.openclawSkill);
    const nextAccessMode = Object.prototype.hasOwnProperty.call(parsed.data, 'accessMode')
      ? parsed.data.accessMode
      : existing.accessMode;

    if (!assertSkillAccessModeRestrictions({
      skillKeys: nextSkills,
      accessMode: nextAccessMode,
      reply,
    })) {
      return;
    }

    if (
      Object.prototype.hasOwnProperty.call(parsed.data, 'sharedWorkspaceAccess')
      && normalizeSharedWorkspaceAccess(parsed.data.sharedWorkspaceAccess) !== 'none'
      && !workspaceCanUseSharedWorkspace(existing.workspace)
    ) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Paket FREE belum mendukung shared workspace antar agent.',
      });
    }

    const agent = await prisma.agent.update({
      where: { id },
      data: buildAgentUpdateData(existing, parsed.data),
    });

    await syncAppointmentSchedulerConfigForAgent({
      workspaceId: existing.workspace.id,
      agentId: id,
      assignedSkills: normalizeAssignedSkills(
        Object.prototype.hasOwnProperty.call(parsed.data, 'assignedSkills')
          ? parsed.data.assignedSkills
          : agent.configJson?.assignedSkills || agent.openclawSkill,
      ),
      appointmentSchedulerConfig: Object.prototype.hasOwnProperty.call(parsed.data, 'appointmentSchedulerConfig')
        ? parsed.data.appointmentSchedulerConfig
        : undefined,
      configSource: agent,
    });

    syncAgentToGateway(id).catch((err) => {
      fastify.log.warn({ agentId: id, err: err.message }, 'Failed to sync updated agent to openclaw');
    });

    return reply.send({ message: 'Agent berhasil diupdate', agent });
  });

  // PATCH /api/agents/:id/toggle — aktifkan / nonaktifkan agent
  fastify.patch('/:id/toggle', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const existing = await prisma.agent.findFirst({
      where: { id, workspace: { ownerId } },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
    }

    const newStatus = existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    const agent = await prisma.agent.update({
      where: { id },
      data: { status: newStatus },
    });

    syncAgentToGateway(id).catch((err) => {
      fastify.log.warn({ agentId: id, err: err.message }, 'Failed to sync agent status to openclaw');
    });

    return reply.send({
      message: `Agent ${newStatus === 'ACTIVE' ? 'diaktifkan' : 'dinonaktifkan'}`,
      agent,
    });
  });

  // DELETE /api/agents/:id — mode aman: nonaktifkan agent tanpa hapus histori
  fastify.delete('/:id', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const existing = await prisma.agent.findFirst({
      where: { id, workspace: { ownerId } },
      include: {
        _count: { select: { channels: true, conversations: true } },
      },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
    }

    const agent = await prisma.agent.update({
      where: { id },
      data: { status: 'INACTIVE' },
      include: {
        _count: { select: { channels: true, conversations: true } },
      },
    });

    syncAgentToGateway(id).catch((err) => {
      fastify.log.warn({ agentId: id, err: err.message }, 'Failed to sync agent deactivation to openclaw');
    });

    return reply.send({
      message: 'Agent dinonaktifkan. Channel tetap tersimpan dan dapat dipakai lagi saat agent diaktifkan.',
      mode: 'SAFE_DEACTIVATE',
      agent,
    });
  });
}

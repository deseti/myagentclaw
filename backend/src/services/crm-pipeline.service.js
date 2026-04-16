import prisma from '../lib/prisma.js';
import {
  computeCrmEntryFlags,
  CRM_PIPELINE_SKILL_KEY,
  DEFAULT_CRM_PIPELINE_DESCRIPTION,
  DEFAULT_CRM_PIPELINE_NAME,
  DEFAULT_CRM_PIPELINE_STAGES,
  getDefaultCrmPipelineId,
  getDefaultCrmStageId,
  normalizeText,
  serializeCrmPipeline,
} from '../lib/crm-pipeline.js';
import { listAgentsUsingSkill, matchesSkillKey } from '../lib/skill-activation.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../lib/internal-skills.js';
import { ocListInstalledSkills } from '../lib/openclaw-client.js';
import { ensureWorkspaceRuntime } from '../lib/runtime-manager.js';

const CRM_SKILL_DEFINITION = getInternalSkillDefinition(CRM_PIPELINE_SKILL_KEY);

const pipelineListInclude = {
  stages: {
    orderBy: { position: 'asc' },
  },
  _count: {
    select: {
      stages: true,
      entries: true,
    },
  },
};

export class CrmServiceError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'CrmServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function serviceError(statusCode, message, details) {
  return new CrmServiceError(statusCode, message, details);
}

function clampProbability(value, fallback = 0) {
  const numericValue = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, numericValue));
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildSkillStatus(access) {
  return {
    key: CRM_PIPELINE_SKILL_KEY,
    installed: Boolean(access?.isInstalled),
    active: Boolean(access?.isActive),
    assignedCount: Number(access?.assignedCount || 0),
    usageCount: Number(access?.assignedCount || 0),
    usedBy: Array.isArray(access?.assignedAgents) ? access.assignedAgents : [],
    opensSidebar: 'CRM Pipeline',
    worker: 'crm-automation-worker',
  };
}

export function buildCrmEntryWhere({
  workspaceId,
  pipelineId,
  stageId,
  assignedAgentId,
  priority,
  source,
  search,
  includeArchived = false,
  dateFrom,
  dateTo,
} = {}) {
  const createdAt = {};

  if (dateFrom) {
    createdAt.gte = dateFrom;
  }

  if (dateTo) {
    createdAt.lte = dateTo;
  }

  const normalizedSearch = String(search || '').trim();

  return {
    workspaceId,
    ...(includeArchived ? {} : { isArchived: false }),
    ...(pipelineId ? { pipelineId } : {}),
    ...(stageId ? { stageId } : {}),
    ...(assignedAgentId ? { assignedAgentId } : {}),
    ...(priority ? { priority } : {}),
    ...(source ? { source: { equals: source, mode: 'insensitive' } } : {}),
    ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    ...(normalizedSearch
      ? {
        OR: [
          { title: { contains: normalizedSearch, mode: 'insensitive' } },
          { source: { contains: normalizedSearch, mode: 'insensitive' } },
          { notes: { contains: normalizedSearch, mode: 'insensitive' } },
          { customer: { name: { contains: normalizedSearch, mode: 'insensitive' } } },
          { customer: { phoneNumber: { contains: normalizedSearch } } },
        ],
      }
      : {}),
  };
}

export async function loadCrmWorkspace(ownerId, workspaceId) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId },
    select: { id: true, ownerId: true, name: true, subTier: true, subStatus: true },
  });

  if (!workspace) {
    throw serviceError(404, 'Workspace tidak ditemukan');
  }

  return workspace;
}

export async function assertCrmPipelineAccess({ ownerId, workspaceId, requireActive = true }) {
  const workspace = await loadCrmWorkspace(ownerId, workspaceId);

  if (!workspaceMeetsMinimumTier(workspace.subTier, CRM_SKILL_DEFINITION?.minimumTier || 'STARTER')) {
    throw serviceError(
      403,
      `CRM Pipeline memerlukan minimum paket ${formatInternalSkillTierLabel(CRM_SKILL_DEFINITION?.minimumTier)}.`,
    );
  }

  try {
    const runtime = await ensureWorkspaceRuntime({ ...workspace, ownerId });
    const installedPayload = await ocListInstalledSkills(runtime);
    const installedSkills = Array.isArray(installedPayload?.skills) ? installedPayload.skills : [];
    const skillInstalled = installedSkills.some((skill) => matchesSkillKey(skill, CRM_PIPELINE_SKILL_KEY));

    if (!skillInstalled) {
      throw serviceError(403, 'Skill built-in CRM Pipeline belum diinstall untuk workspace ini.', {
        requiredSkill: CRM_PIPELINE_SKILL_KEY,
      });
    }

    const assignedAgents = await listAgentsUsingSkill(workspace.id, CRM_PIPELINE_SKILL_KEY);
    const isActive = assignedAgents.length > 0;

    if (requireActive && !isActive) {
      throw serviceError(
        403,
        'Skill CRM Pipeline sudah terinstall, tetapi belum aktif. Assign skill ini ke minimal satu agent untuk membuka dashboard dan worker.',
        { requiredSkill: CRM_PIPELINE_SKILL_KEY },
      );
    }

    return {
      workspace,
      runtime,
      isInstalled: true,
      isActive,
      assignedCount: assignedAgents.length,
      assignedAgents: assignedAgents.map(({ id, name, status }) => ({ id, name, status })),
      skillStatus: buildSkillStatus({ isInstalled: true, isActive, assignedCount: assignedAgents.length, assignedAgents }),
    };
  } catch (error) {
    if (error instanceof CrmServiceError) {
      throw error;
    }

    throw serviceError(502, 'Gagal memverifikasi skill CRM Pipeline di runtime workspace.');
  }
}

export async function ensureDefaultCrmPipelineForWorkspace(workspaceId) {
  const pipeline = await prisma.crmPipeline.upsert({
    where: {
      workspaceId_name: {
        workspaceId,
        name: DEFAULT_CRM_PIPELINE_NAME,
      },
    },
    update: {},
    create: {
      id: getDefaultCrmPipelineId(workspaceId),
      workspaceId,
      name: DEFAULT_CRM_PIPELINE_NAME,
      description: DEFAULT_CRM_PIPELINE_DESCRIPTION,
      isDefault: true,
      isActive: true,
    },
  });

  for (const stage of DEFAULT_CRM_PIPELINE_STAGES) {
    await prisma.crmPipelineStage.upsert({
      where: {
        pipelineId_position: {
          pipelineId: pipeline.id,
          position: stage.position,
        },
      },
      update: {},
      create: {
        id: getDefaultCrmStageId(workspaceId, stage.position),
        pipelineId: pipeline.id,
        name: stage.name,
        description: stage.description,
        color: stage.color,
        position: stage.position,
        probabilityPercent: clampProbability(stage.probabilityPercent, 0),
        isDefault: Boolean(stage.isDefault),
        isClosedWon: Boolean(stage.isClosedWon),
        isClosedLost: Boolean(stage.isClosedLost),
      },
    });
  }

  return prisma.crmPipeline.findUnique({
    where: { id: pipeline.id },
    include: pipelineListInclude,
  });
}

async function loadPipelineOrThrow(workspaceId, pipelineId) {
  const pipeline = await prisma.crmPipeline.findFirst({
    where: {
      id: pipelineId,
      workspaceId,
    },
    include: pipelineListInclude,
  });

  if (!pipeline) {
    throw serviceError(404, 'Pipeline CRM tidak ditemukan');
  }

  return pipeline;
}

function buildConversionTrend(entries = [], activities = [], now = new Date()) {
  const currentDate = now instanceof Date ? now : new Date(now);
  const months = [];

  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() - index, 1));
    months.push({
      key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
      created: 0,
      won: 0,
      lost: 0,
    });
  }

  const monthMap = new Map(months.map((month) => [month.key, month]));

  for (const entry of entries) {
    const createdAt = toDateOrNull(entry.createdAt);
    if (!createdAt) continue;

    const key = `${createdAt.getUTCFullYear()}-${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
    const month = monthMap.get(key);
    if (month) {
      month.created += 1;
    }
  }

  for (const activity of activities) {
    if (!['WON', 'LOST'].includes(activity.type)) continue;

    const createdAt = toDateOrNull(activity.createdAt);
    if (!createdAt) continue;

    const key = `${createdAt.getUTCFullYear()}-${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
    const month = monthMap.get(key);
    if (!month) continue;

    if (activity.type === 'WON') month.won += 1;
    if (activity.type === 'LOST') month.lost += 1;
  }

  return months;
}

export function buildDashboardMetrics(entries = [], activities = [], now = new Date()) {
  const flagsByEntryId = new Map(entries.map((entry) => [entry.id, computeCrmEntryFlags(entry, now)]));
  const stageCounts = new Map();
  const stageValue = new Map();
  const stageMeta = new Map();
  const closedOutcomeActivityByEntryId = new Map();
  const lossByPreviousStageId = new Map();
  const stageActivityCount = new Map();
  const agentPerformance = new Map();
  let totalPipelineValue = 0;
  let wonDeals = 0;
  let lostDeals = 0;
  let staleLeadsCount = 0;
  let leadsWithoutActivity = 0;
  let closedDaysAccumulator = 0;
  let closedDaysCount = 0;

  for (const activity of activities) {
    if (activity.newStageId) {
      stageActivityCount.set(activity.newStageId, (stageActivityCount.get(activity.newStageId) || 0) + 1);
    }

    if (activity.type === 'LOST' && activity.previousStageId) {
      lossByPreviousStageId.set(activity.previousStageId, (lossByPreviousStageId.get(activity.previousStageId) || 0) + 1);
      closedOutcomeActivityByEntryId.set(activity.customerPipelineEntryId, activity);
    }

    if (activity.type === 'WON') {
      closedOutcomeActivityByEntryId.set(activity.customerPipelineEntryId, activity);
    }
  }

  for (const entry of entries) {
    const entryFlags = flagsByEntryId.get(entry.id) || computeCrmEntryFlags(entry, now);
    const stageId = entry.stageId;
    const stageName = entry.stage?.name || 'Unknown';
    const stagePosition = Number(entry.stage?.position || 0);
    const valueAmount = Number(entry.valueAmount || 0);

    stageMeta.set(stageId, {
      stageId,
      label: stageName,
      position: stagePosition,
    });
    stageCounts.set(stageId, (stageCounts.get(stageId) || 0) + 1);
    stageValue.set(stageId, (stageValue.get(stageId) || 0) + valueAmount);

    if (!entryFlags.isClosed) {
      totalPipelineValue += valueAmount;
    }

    if (!entry.lastActivityAt) {
      leadsWithoutActivity += 1;
    }

    if (entryFlags.isStale) {
      staleLeadsCount += 1;
    }

    if (entryFlags.isClosedWon) {
      wonDeals += 1;
      if (entry.assignedAgentId) {
        const current = agentPerformance.get(entry.assignedAgentId) || {
          id: entry.assignedAgentId,
          name: entry.assignedAgent?.name || 'Unknown agent',
          deals: 0,
          value: 0,
        };

        current.deals += 1;
        current.value += valueAmount;
        agentPerformance.set(entry.assignedAgentId, current);
      }
    }

    if (entryFlags.isClosedLost) {
      lostDeals += 1;
    }

    if (entryFlags.isClosed) {
      const closedActivity = closedOutcomeActivityByEntryId.get(entry.id);
      const closedAt = toDateOrNull(closedActivity?.createdAt) || toDateOrNull(entry.updatedAt);
      const createdAt = toDateOrNull(entry.createdAt);

      if (closedAt && createdAt) {
        closedDaysAccumulator += Math.max(0, (closedAt.getTime() - createdAt.getTime()) / 86_400_000);
        closedDaysCount += 1;
      }
    }
  }

  const closedDeals = wonDeals + lostDeals;
  const conversionRate = closedDeals > 0 ? Math.round((wonDeals / closedDeals) * 1000) / 10 : 0;
  const averageDaysToClose = closedDaysCount > 0 ? Math.round((closedDaysAccumulator / closedDaysCount) * 10) / 10 : 0;
  const averageValuePerDeal = wonDeals > 0
    ? Math.round(((entries
      .filter((entry) => flagsByEntryId.get(entry.id)?.isClosedWon)
      .reduce((total, entry) => total + Number(entry.valueAmount || 0), 0)) / wonDeals) * 100) / 100
    : 0;

  const leadsPerStage = [...stageCounts.entries()]
    .map(([stageId, value]) => ({
      ...stageMeta.get(stageId),
      value,
    }))
    .sort((left, right) => left.position - right.position);

  const valueByStage = [...stageValue.entries()]
    .map(([stageId, value]) => ({
      ...stageMeta.get(stageId),
      value: Math.round(value * 100) / 100,
    }))
    .sort((left, right) => left.position - right.position);

  const topPerformingAgent = [...agentPerformance.values()]
    .sort((left, right) => {
      if (right.deals !== left.deals) return right.deals - left.deals;
      return right.value - left.value;
    })[0] || null;

  const mostActiveStage = [...stageActivityCount.entries()]
    .map(([stageId, count]) => ({
      ...stageMeta.get(stageId),
      count,
    }))
    .sort((left, right) => right.count - left.count)[0] || null;

  const stageWithMostDropOff = [...lossByPreviousStageId.entries()]
    .map(([stageId, count]) => ({
      ...stageMeta.get(stageId),
      count,
    }))
    .sort((left, right) => right.count - left.count)[0] || null;

  return {
    stats: {
      totalLeads: entries.length,
      wonDeals,
      lostDeals,
      conversionRate,
      totalPipelineValue: Math.round(totalPipelineValue * 100) / 100,
      leadsWithoutActivity,
    },
    analytics: {
      totalLeads: entries.length,
      wonDeals,
      lostDeals,
      conversionRate,
      averageDaysToClose,
      averageValuePerDeal,
      stageWithMostDropOff,
      topPerformingAgent,
      mostActiveStage,
      staleLeadsCount,
    },
    charts: {
      leadsPerStage,
      wonVsLost: [
        { label: 'Won', value: wonDeals },
        { label: 'Lost', value: lostDeals },
      ],
      conversionTrend: buildConversionTrend(entries, activities, now),
      valueByStage,
    },
  };
}

export async function listCrmPipelines({ ownerId, workspaceId }) {
  const access = await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  await ensureDefaultCrmPipelineForWorkspace(access.workspace.id);

  const pipelines = await prisma.crmPipeline.findMany({
    where: { workspaceId: access.workspace.id },
    orderBy: [
      { isDefault: 'desc' },
      { createdAt: 'asc' },
    ],
    include: pipelineListInclude,
  });

  return {
    pipelines: pipelines.map((pipeline) => serializeCrmPipeline({
      ...pipeline,
      usageCount: pipeline._count?.entries || 0,
    })),
    skillStatus: access.skillStatus,
  };
}

export async function createCrmPipeline({ ownerId, workspaceId, name, description, color, isDefault = false, isActive = true }) {
  const access = await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const trimmedName = String(name || '').trim();

  if (!trimmedName) {
    throw serviceError(400, 'Nama pipeline wajib diisi.', {
      name: ['Nama pipeline wajib diisi.'],
    });
  }

  return prisma.$transaction(async (tx) => {
    const existingCount = await tx.crmPipeline.count({ where: { workspaceId: access.workspace.id } });
    const nextDefault = Boolean(isDefault || existingCount === 0);

    if (nextDefault) {
      await tx.crmPipeline.updateMany({
        where: { workspaceId: access.workspace.id },
        data: { isDefault: false },
      });
    }

    const createdPipeline = await tx.crmPipeline.create({
      data: {
        workspaceId: access.workspace.id,
        name: trimmedName,
        description: String(description || '').trim() || null,
        color: String(color || '#2563eb').trim() || '#2563eb',
        isDefault: nextDefault,
        isActive: Boolean(isActive),
      },
    });

    for (const stage of DEFAULT_CRM_PIPELINE_STAGES) {
      await tx.crmPipelineStage.create({
        data: {
          id: stage.isDefault ? getDefaultCrmStageId(createdPipeline.id, stage.position) : undefined,
          pipelineId: createdPipeline.id,
          name: stage.name,
          description: stage.description,
          color: stage.color,
          position: stage.position,
          probabilityPercent: clampProbability(stage.probabilityPercent, 0),
          isDefault: Boolean(stage.isDefault),
          isClosedWon: Boolean(stage.isClosedWon),
          isClosedLost: Boolean(stage.isClosedLost),
        },
      });
    }

    const pipeline = await tx.crmPipeline.findUnique({
      where: { id: createdPipeline.id },
      include: pipelineListInclude,
    });

    return {
      pipeline: serializeCrmPipeline({
        ...pipeline,
        usageCount: pipeline?._count?.entries || 0,
      }),
      skillStatus: access.skillStatus,
    };
  });
}

export async function updateCrmPipeline({ ownerId, workspaceId, pipelineId, payload = {} }) {
  const access = await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const existing = await loadPipelineOrThrow(access.workspace.id, pipelineId);

  return prisma.$transaction(async (tx) => {
    if (payload.isDefault === true) {
      await tx.crmPipeline.updateMany({
        where: { workspaceId: access.workspace.id },
        data: { isDefault: false },
      });
    }

    const updated = await tx.crmPipeline.update({
      where: { id: existing.id },
      data: {
        ...(Object.prototype.hasOwnProperty.call(payload, 'name')
          ? { name: String(payload.name || '').trim() || existing.name }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'description')
          ? { description: String(payload.description || '').trim() || null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'isDefault')
          ? { isDefault: Boolean(payload.isDefault) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'isActive')
          ? { isActive: Boolean(payload.isActive) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(payload, 'color')
          ? { color: String(payload.color || '#2563eb').trim() || '#2563eb' }
          : {}),
      },
      include: pipelineListInclude,
    });

    return {
      pipeline: serializeCrmPipeline({
        ...updated,
        usageCount: updated._count?.entries || 0,
      }),
      skillStatus: access.skillStatus,
    };
  });
}

export async function deleteCrmPipeline({ ownerId, workspaceId, pipelineId }) {
  const access = await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const existing = await loadPipelineOrThrow(access.workspace.id, pipelineId);

  if (Number(existing._count?.entries || 0) > 0) {
    throw serviceError(409, 'Pipeline yang masih memiliki lead tidak bisa dihapus.', {
      pipelineId: existing.id,
      entryCount: existing._count.entries,
    });
  }

  return prisma.$transaction(async (tx) => {
    await tx.crmPipeline.delete({ where: { id: existing.id } });

    const remainingDefault = await tx.crmPipeline.findFirst({
      where: { workspaceId: access.workspace.id, isDefault: true },
      select: { id: true },
    });

    if (!remainingDefault) {
      const fallbackPipeline = await tx.crmPipeline.findFirst({
        where: { workspaceId: access.workspace.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

      if (fallbackPipeline) {
        await tx.crmPipeline.update({
          where: { id: fallbackPipeline.id },
          data: { isDefault: true },
        });
      }
    }

    return {
      deletedPipeline: serializeCrmPipeline(existing),
      skillStatus: access.skillStatus,
    };
  });
}

export async function getCrmDashboardSummary({ ownerId, workspaceId, filters = {} }) {
  const access = await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const where = buildCrmEntryWhere({
    workspaceId: access.workspace.id,
    pipelineId: filters.pipelineId,
    stageId: filters.stageId,
    assignedAgentId: filters.assignedAgentId,
    priority: filters.priority,
    source: filters.source,
    search: filters.search,
    includeArchived: Boolean(filters.includeArchived),
    dateFrom: filters.dateFrom || null,
    dateTo: filters.dateTo || null,
  });

  const entries = await prisma.crmCustomerPipelineEntry.findMany({
    where,
    orderBy: [
      { stage: { position: 'asc' } },
      { updatedAt: 'desc' },
    ],
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          isBlocked: true,
          isArchived: true,
        },
      },
      pipeline: {
        select: {
          id: true,
          workspaceId: true,
          name: true,
          description: true,
          isDefault: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      stage: {
        select: {
          id: true,
          pipelineId: true,
          name: true,
          description: true,
          color: true,
          position: true,
          probabilityPercent: true,
          isDefault: true,
          isClosedWon: true,
          isClosedLost: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      assignedAgent: {
        select: {
          id: true,
          name: true,
          status: true,
          configJson: true,
        },
      },
    },
  });

  const entryIds = entries.map((entry) => entry.id);
  const activities = entryIds.length > 0
    ? await prisma.crmPipelineActivity.findMany({
      where: { customerPipelineEntryId: { in: entryIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        customerPipelineEntryId: true,
        type: true,
        previousStageId: true,
        newStageId: true,
        createdAt: true,
      },
    })
    : [];

  return {
    ...buildDashboardMetrics(entries, activities, new Date()),
    filters: {
      pipelineId: filters.pipelineId || null,
      stageId: filters.stageId || null,
      assignedAgentId: filters.assignedAgentId || null,
      priority: filters.priority || null,
      source: filters.source || null,
      search: filters.search || '',
      dateFrom: filters.dateFrom || null,
      dateTo: filters.dateTo || null,
      includeArchived: Boolean(filters.includeArchived),
    },
    skillStatus: access.skillStatus,
  };
}

export const crmPipelineService = {
  assertCrmPipelineAccess,
  buildCrmEntryWhere,
  createCrmPipeline,
  deleteCrmPipeline,
  ensureDefaultCrmPipelineForWorkspace,
  getCrmDashboardSummary,
  listCrmPipelines,
  loadCrmWorkspace,
  updateCrmPipeline,
};
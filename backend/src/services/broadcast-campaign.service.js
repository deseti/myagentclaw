import prisma from '../lib/prisma.js';
import {
  BROADCAST_CAMPAIGN_SKILL_KEY,
  BROADCAST_AUDIENCE_FILTER_TYPES,
  agentCanUseBroadcast,
  getBroadcastTierLimits,
  normalizeBroadcastCampaignStatus,
  normalizeBroadcastFilterMode,
  normalizeBroadcastFilterType,
  serializeBroadcastCampaign,
  serializeBroadcastRecipient,
} from '../lib/broadcast-campaign.js';
import { normalizeBroadcastRecipientStatus } from '../lib/broadcast-campaign.js';
import { getCustomerPhoneChannelType, normalizeChannelType, stripCustomerPhonePrefix } from '../lib/channel-utils.js';
import { listAgentsUsingSkill, matchesSkillKey } from '../lib/skill-activation.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../lib/internal-skills.js';
import { ocListInstalledSkills, ocSendChannelMessage } from '../lib/openclaw-client.js';
import { ensureWorkspaceRuntime, resolveChannelRuntime } from '../lib/runtime-manager.js';

const BROADCAST_SKILL_DEFINITION = getInternalSkillDefinition(BROADCAST_CAMPAIGN_SKILL_KEY);
const ALLOWED_MUTABLE_STATUSES = new Set(['DRAFT', 'SCHEDULED']);
const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const campaignListInclude = {
  assignedAgent: {
    select: {
      id: true,
      name: true,
      status: true,
      accessMode: true,
      configJson: true,
      openclawSkill: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  audiences: {
    orderBy: { position: 'asc' },
  },
  _count: {
    select: {
      recipients: true,
    },
  },
};

const campaignDetailInclude = {
  ...campaignListInclude,
  recipients: {
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          isBlocked: true,
          isArchived: true,
          tags: true,
        },
      },
    },
    orderBy: [
      { updatedAt: 'desc' },
      { createdAt: 'desc' },
    ],
    take: 500,
  },
};

export class BroadcastCampaignServiceError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'BroadcastCampaignServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function broadcastServiceError(statusCode, message, details) {
  return new BroadcastCampaignServiceError(statusCode, message, details);
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeDateInput(value, fieldName = 'Tanggal') {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw broadcastServiceError(400, `${fieldName} tidak valid.`);
  }

  return date;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
  }

  if (typeof value === 'string') {
    return [...new Set(value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean))];
  }

  return [];
}

function sanitizeCampaignStatusForSave(value, fallback = 'DRAFT') {
  const normalizedStatus = normalizeBroadcastCampaignStatus(value, fallback);
  return ['DRAFT', 'SCHEDULED'].includes(normalizedStatus) ? normalizedStatus : fallback;
}

function normalizeAudienceFilters(filters = []) {
  if (!Array.isArray(filters)) return [];

  return filters
    .map((filter, index) => ({
      filterType: normalizeBroadcastFilterType(filter?.filterType),
      includeMode: normalizeBroadcastFilterMode(filter?.includeMode),
      operator: normalizeOptionalText(filter?.operator),
      position: Number.isFinite(Number(filter?.position)) ? Number(filter.position) : index,
      valueJson: filter?.valueJson && typeof filter.valueJson === 'object'
        ? filter.valueJson
        : filter?.valueJson ?? null,
    }))
    .filter((filter) => BROADCAST_AUDIENCE_FILTER_TYPES.includes(filter.filterType));
}

function buildSkillStatus(access, usage = {}) {
  return {
    key: BROADCAST_CAMPAIGN_SKILL_KEY,
    installed: Boolean(access?.isInstalled),
    active: Boolean(access?.isActive),
    assignedCount: Number(access?.assignedCount || 0),
    usageCount: Number(usage.totalCampaignCreated || 0),
    usedBy: Array.isArray(access?.assignedAgents) ? access.assignedAgents : [],
    opensSidebar: 'Broadcast Campaign',
    worker: 'broadcast-campaign-worker',
    mainCapability: 'canUseBroadcast',
    supportsAnalytics: true,
  };
}

async function computeBroadcastUsage(workspaceId) {
  const [aggregate, activeAgents] = await Promise.all([
    prisma.broadcastCampaign.aggregate({
      where: { workspaceId },
      _count: { id: true },
      _sum: {
        totalAudience: true,
        totalSent: true,
        totalDelivered: true,
      },
    }),
    listAgentsUsingSkill(workspaceId, BROADCAST_CAMPAIGN_SKILL_KEY),
  ]);

  return {
    totalCampaignCreated: Number(aggregate._count?.id || 0),
    totalCampaignSent: Number(aggregate._sum?.totalSent || 0),
    totalAudienceReached: Number(aggregate._sum?.totalDelivered || aggregate._sum?.totalAudience || 0),
    activeAgentCount: activeAgents.length,
    usagePerWorkspace: {
      workspaceId,
      totalCampaignCreated: Number(aggregate._count?.id || 0),
      totalCampaignSent: Number(aggregate._sum?.totalSent || 0),
      totalAudienceReached: Number(aggregate._sum?.totalDelivered || aggregate._sum?.totalAudience || 0),
      activeAgentCount: activeAgents.length,
    },
  };
}

async function loadBroadcastWorkspace(ownerId, workspaceId) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId },
    select: { id: true, ownerId: true, name: true, subTier: true, subStatus: true },
  });

  if (!workspace) {
    throw broadcastServiceError(404, 'Workspace tidak ditemukan');
  }

  return workspace;
}

export async function assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive = true }) {
  const workspace = await loadBroadcastWorkspace(ownerId, workspaceId);

  if (!workspaceMeetsMinimumTier(workspace.subTier, BROADCAST_SKILL_DEFINITION?.minimumTier || 'STARTER')) {
    throw broadcastServiceError(
      403,
      `Broadcast Campaign memerlukan minimum paket ${formatInternalSkillTierLabel(BROADCAST_SKILL_DEFINITION?.minimumTier)}.`,
    );
  }

  try {
    const runtime = await ensureWorkspaceRuntime({ ...workspace, ownerId });
    const installedPayload = await ocListInstalledSkills(runtime);
    const installedSkills = Array.isArray(installedPayload?.skills) ? installedPayload.skills : [];
    const skillInstalled = installedSkills.some((skill) => matchesSkillKey(skill, BROADCAST_CAMPAIGN_SKILL_KEY));

    if (!skillInstalled) {
      throw broadcastServiceError(403, 'Skill built-in Broadcast Campaign belum diinstall untuk workspace ini.', {
        requiredSkill: BROADCAST_CAMPAIGN_SKILL_KEY,
      });
    }

    const assignedAgents = await listAgentsUsingSkill(workspace.id, BROADCAST_CAMPAIGN_SKILL_KEY);
    const activeAssignedAgents = assignedAgents.filter((agent) => agentCanUseBroadcast(agent));
    const isActive = activeAssignedAgents.length > 0;

    if (requireActive && !isActive) {
      throw broadcastServiceError(
        403,
        'Skill Broadcast Campaign sudah terinstall, tetapi belum aktif. Assign skill ini ke minimal satu agent Approval Required untuk membuka dashboard dan worker.',
        { requiredSkill: BROADCAST_CAMPAIGN_SKILL_KEY },
      );
    }

    const usage = await computeBroadcastUsage(workspace.id);

    return {
      workspace,
      runtime,
      isInstalled: true,
      isActive,
      assignedCount: activeAssignedAgents.length,
      assignedAgents: activeAssignedAgents.map(({ id, name, status }) => ({ id, name, status })),
      usage,
      skillStatus: buildSkillStatus({
        isInstalled: true,
        isActive,
        assignedCount: activeAssignedAgents.length,
        assignedAgents: activeAssignedAgents,
      }, usage),
    };
  } catch (error) {
    if (error instanceof BroadcastCampaignServiceError) {
      throw error;
    }

    throw broadcastServiceError(502, 'Gagal memverifikasi skill Broadcast Campaign di runtime workspace.');
  }
}

async function resolveAssignedAgentOrThrow({ workspaceId, assignedAgentId, requiredCapability = 'canUseBroadcast' }) {
  const agent = await prisma.agent.findFirst({
    where: {
      id: assignedAgentId,
      workspaceId,
    },
    select: {
      id: true,
      name: true,
      status: true,
      accessMode: true,
      openclawSkill: true,
      configJson: true,
    },
  });

  if (!agent) {
    throw broadcastServiceError(404, 'Agent Broadcast tidak ditemukan.');
  }

  if (agent.status !== 'ACTIVE') {
    throw broadcastServiceError(409, 'Agent Broadcast harus aktif.');
  }

  if (!agentCanUseBroadcast(agent, requiredCapability)) {
    throw broadcastServiceError(403, 'Agent yang dipilih belum memiliki capability Broadcast Campaign yang dibutuhkan.', {
      requiredCapability,
      requiredSkill: BROADCAST_CAMPAIGN_SKILL_KEY,
    });
  }

  return agent;
}

async function loadCampaignOrThrow({ ownerId, workspaceId, campaignId, include = campaignDetailInclude }) {
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: {
      id: campaignId,
      workspaceId,
      workspace: ownerId ? { ownerId } : undefined,
    },
    include,
  });

  if (!campaign) {
    throw broadcastServiceError(404, 'Broadcast campaign tidak ditemukan.');
  }

  return campaign;
}

async function loadConnectedAgentChannel({ workspaceId, agentId, channelType }) {
  return prisma.channel.findFirst({
    where: {
      workspaceId,
      agentId,
      type: normalizeChannelType(channelType, 'TELEGRAM'),
      status: 'CONNECTED',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      status: true,
    },
  });
}

function computeCustomerLifecycleStatus(customer, assignedAgentId = null) {
  if (customer.isBlocked) return 'BLOCKED';
  if (customer.isArchived) return 'ARCHIVED';

  const relevantAccess = assignedAgentId
    ? (customer.agentAccesses || []).find((entry) => entry.agentId === assignedAgentId) || null
    : null;

  if (relevantAccess?.status === 'PENDING') return 'PENDING';
  if ((customer.agentAccesses || []).some((entry) => entry.status === 'PENDING')) return 'PENDING';
  return 'ACTIVE';
}

function computeLastActivityAt(customer) {
  const timestamps = [
    customer.lastSeen,
    ...(Array.isArray(customer.crmPipelineEntries)
      ? customer.crmPipelineEntries.map((entry) => entry.lastActivityAt).filter(Boolean)
      : []),
  ]
    .map((value) => (value ? new Date(value) : null))
    .filter((date) => date && !Number.isNaN(date.getTime()));

  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps.map((date) => date.getTime())));
}

function extractCustomerTags(customer) {
  return Array.isArray(customer.tags) ? customer.tags.map((tag) => String(tag || '').trim()).filter(Boolean) : [];
}

function customerMatchesAudienceFilter(customer, filter, context = {}) {
  const valueJson = filter.valueJson && typeof filter.valueJson === 'object' ? filter.valueJson : {};
  const assignedAgentId = context.assignedAgentId || null;
  const customerChannelType = getCustomerPhoneChannelType(customer.phoneNumber);
  const customerLifecycleStatus = computeCustomerLifecycleStatus(customer, assignedAgentId);
  const customerTags = extractCustomerTags(customer);
  const customerAccessStatus = assignedAgentId
    ? ((customer.agentAccesses || []).find((entry) => entry.agentId === assignedAgentId)?.status || 'NONE')
    : ((customer.agentAccesses || [])[0]?.status || 'NONE');
  const customerAssignedAgentIds = [...new Set((customer.crmPipelineEntries || []).map((entry) => entry.assignedAgentId).filter(Boolean))];
  const customerStageIds = [...new Set((customer.crmPipelineEntries || []).map((entry) => entry.stageId).filter(Boolean))];
  const lastActivityAt = computeLastActivityAt(customer);

  switch (filter.filterType) {
    case 'CRM_STAGE': {
      const stageIds = toStringArray(valueJson.stageIds || valueJson.values || valueJson.value);
      return stageIds.length === 0 ? true : stageIds.some((stageId) => customerStageIds.includes(stageId));
    }
    case 'CUSTOMER_TAG': {
      const tags = toStringArray(valueJson.tags || valueJson.values || valueJson.value);
      return tags.length === 0 ? true : tags.some((tag) => customerTags.includes(tag));
    }
    case 'CUSTOMER_STATUS': {
      const statuses = toStringArray(valueJson.statuses || valueJson.values || valueJson.value).map((status) => status.toUpperCase());
      return statuses.length === 0 ? true : statuses.includes(customerLifecycleStatus);
    }
    case 'ASSIGNED_AGENT': {
      const agentIds = toStringArray(valueJson.agentIds || valueJson.values || valueJson.value);
      return agentIds.length === 0 ? true : agentIds.some((agentId) => customerAssignedAgentIds.includes(agentId));
    }
    case 'CHANNEL_TYPE': {
      const channelTypes = toStringArray(valueJson.channelTypes || valueJson.values || valueJson.value).map((channelType) => normalizeChannelType(channelType, null));
      return channelTypes.length === 0 ? true : channelTypes.includes(customerChannelType);
    }
    case 'APPROVAL_STATUS': {
      const statuses = toStringArray(valueJson.statuses || valueJson.values || valueJson.value).map((status) => status.toUpperCase());
      return statuses.length === 0 ? true : statuses.includes(String(customerAccessStatus || 'NONE').toUpperCase());
    }
    case 'LAST_ACTIVITY': {
      const operator = String(filter.operator || valueJson.operator || 'WITHIN_LAST_DAYS').trim().toUpperCase();
      if (!lastActivityAt) {
        return operator === 'NO_ACTIVITY';
      }

      if (operator === 'NO_ACTIVITY') {
        return false;
      }

      if (operator === 'WITHIN_LAST_DAYS') {
        const days = Number(valueJson.days || valueJson.value || 0);
        if (!Number.isFinite(days) || days <= 0) return true;
        const threshold = Date.now() - (days * 86_400_000);
        return lastActivityAt.getTime() >= threshold;
      }

      if (operator === 'BEFORE_DATE') {
        const date = normalizeDateInput(valueJson.date, 'Tanggal last activity');
        return date ? lastActivityAt.getTime() < date.getTime() : true;
      }

      if (operator === 'AFTER_DATE') {
        const date = normalizeDateInput(valueJson.date, 'Tanggal last activity');
        return date ? lastActivityAt.getTime() > date.getTime() : true;
      }

      if (operator === 'BETWEEN_DATES') {
        const fromDate = normalizeDateInput(valueJson.dateFrom, 'Tanggal last activity awal');
        const toDate = normalizeDateInput(valueJson.dateTo, 'Tanggal last activity akhir');
        if (!fromDate || !toDate) return true;
        return lastActivityAt.getTime() >= fromDate.getTime() && lastActivityAt.getTime() <= toDate.getTime();
      }

      return true;
    }
    case 'SPECIFIC_CUSTOMER': {
      const customerIds = toStringArray(valueJson.customerIds || valueJson.values || valueJson.value);
      return customerIds.length === 0 ? true : customerIds.includes(customer.id);
    }
    default:
      return true;
  }
}

async function loadAudienceDataset({ workspaceId, assignedAgentId }) {
  return prisma.customer.findMany({
    where: { workspaceId },
    orderBy: [
      { lastSeen: 'desc' },
      { createdAt: 'desc' },
    ],
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      tags: true,
      isBlocked: true,
      isArchived: true,
      lastSeen: true,
      agentAccesses: {
        where: assignedAgentId ? { agentId: assignedAgentId } : undefined,
        select: {
          agentId: true,
          status: true,
          updatedAt: true,
        },
      },
      crmPipelineEntries: {
        where: { isArchived: false },
        select: {
          id: true,
          stageId: true,
          assignedAgentId: true,
          lastActivityAt: true,
        },
      },
    },
  });
}

function buildAudiencePreviewRows(customers, filters, context = {}) {
  const includedFilters = filters.filter((filter) => filter.includeMode === 'INCLUDE');
  const excludedFilters = filters.filter((filter) => filter.includeMode === 'EXCLUDE');

  return customers
    .map((customer) => {
      const matchesIncluded = includedFilters.length === 0
        ? true
        : includedFilters.every((filter) => customerMatchesAudienceFilter(customer, filter, context));
      const matchesExcluded = excludedFilters.some((filter) => customerMatchesAudienceFilter(customer, filter, context));
      const matched = matchesIncluded && !matchesExcluded;

      if (!matched) {
        return null;
      }

      const customerChannelType = getCustomerPhoneChannelType(customer.phoneNumber);
      let previewStatus = 'DELIVERABLE';
      let previewReason = null;

      if (!customer.phoneNumber) {
        previewStatus = 'SKIPPED';
        previewReason = 'missing_phone';
      } else if (customerChannelType !== normalizeChannelType(context.channelType, null)) {
        previewStatus = 'SKIPPED';
        previewReason = 'channel_mismatch';
      } else if (customer.isBlocked) {
        previewStatus = 'SKIPPED';
        previewReason = 'customer_blocked';
      } else if (customer.isArchived) {
        previewStatus = 'SKIPPED';
        previewReason = 'customer_archived';
      } else if (!context.connectedChannelId) {
        previewStatus = 'SKIPPED';
        previewReason = 'missing_channel_session';
      }

      return {
        customerId: customer.id,
        customer,
        previewStatus,
        previewReason,
        channelSessionId: context.connectedChannelId || null,
        lifecycleStatus: computeCustomerLifecycleStatus(customer, context.assignedAgentId || null),
        lastActivityAt: computeLastActivityAt(customer),
      };
    })
    .filter(Boolean);
}

export async function previewBroadcastAudience({
  ownerId,
  workspaceId,
  assignedAgentId,
  channelType,
  audienceFilters = [],
}) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  await resolveAssignedAgentOrThrow({
    workspaceId: access.workspace.id,
    assignedAgentId,
    requiredCapability: 'canUseBroadcast',
  });

  const normalizedChannelType = normalizeChannelType(channelType, 'TELEGRAM');
  const normalizedFilters = normalizeAudienceFilters(audienceFilters);
  const [customers, connectedChannel] = await Promise.all([
    loadAudienceDataset({ workspaceId: access.workspace.id, assignedAgentId }),
    loadConnectedAgentChannel({ workspaceId: access.workspace.id, agentId: assignedAgentId, channelType: normalizedChannelType }),
  ]);

  const members = buildAudiencePreviewRows(customers, normalizedFilters, {
    assignedAgentId,
    channelType: normalizedChannelType,
    connectedChannelId: connectedChannel?.id || null,
  });
  const limits = getBroadcastTierLimits(access.workspace.subTier);

  const summary = members.reduce((accumulator, member) => {
    accumulator.matchedCount += 1;
    if (member.previewStatus === 'DELIVERABLE') {
      accumulator.deliverableCount += 1;
    }

    if (member.previewReason === 'customer_blocked') accumulator.blockedCount += 1;
    if (member.previewReason === 'customer_archived') accumulator.archivedCount += 1;
    if (member.previewReason === 'missing_phone') accumulator.missingPhoneCount += 1;
    if (member.previewReason === 'missing_channel_session') accumulator.missingChannelSessionCount += 1;
    if (member.previewReason === 'channel_mismatch') accumulator.channelMismatchCount += 1;

    return accumulator;
  }, {
    matchedCount: 0,
    deliverableCount: 0,
    blockedCount: 0,
    archivedCount: 0,
    missingPhoneCount: 0,
    missingChannelSessionCount: 0,
    channelMismatchCount: 0,
  });

  return {
    members,
    filters: normalizedFilters,
    summary: {
      ...summary,
      maxAudience: limits.maxAudience,
      overAudienceLimit: limits.maxAudience !== null && summary.matchedCount > limits.maxAudience,
      channelSessionId: connectedChannel?.id || null,
      channelType: normalizedChannelType,
    },
    previewCustomers: members.slice(0, 25).map((member) => ({
      customerId: member.customerId,
      name: member.customer.name || null,
      phoneNumber: member.customer.phoneNumber || null,
      tags: extractCustomerTags(member.customer),
      previewStatus: member.previewStatus,
      previewReason: member.previewReason,
      lifecycleStatus: member.lifecycleStatus,
      lastActivityAt: member.lastActivityAt || null,
    })),
    skillStatus: access.skillStatus,
  };
}

function assertCampaignTierLimits({ workspaceTier, matchedCount, existingCampaignCount }) {
  const limits = getBroadcastTierLimits(workspaceTier);

  if (limits.maxCampaigns !== null && existingCampaignCount >= limits.maxCampaigns) {
    throw broadcastServiceError(
      403,
      `Tier ${workspaceTier} mencapai batas maksimal ${limits.maxCampaigns} broadcast campaign per workspace.`,
      { maxCampaigns: limits.maxCampaigns },
    );
  }

  if (limits.maxAudience !== null && matchedCount > limits.maxAudience) {
    throw broadcastServiceError(
      403,
      `Tier ${workspaceTier} membatasi audience broadcast sampai ${limits.maxAudience} customer per campaign.`,
      { maxAudience: limits.maxAudience },
    );
  }

  return limits;
}

async function replaceAudienceFiltersTx(tx, { workspaceId, campaignId, filters }) {
  await tx.broadcastCampaignAudience.deleteMany({ where: { campaignId } });

  if (filters.length === 0) {
    return;
  }

  await tx.broadcastCampaignAudience.createMany({
    data: filters.map((filter, index) => ({
      workspaceId,
      campaignId,
      filterType: filter.filterType,
      includeMode: filter.includeMode,
      operator: filter.operator || null,
      position: Number.isFinite(Number(filter.position)) ? Number(filter.position) : index,
      valueJson: filter.valueJson || null,
    })),
  });
}

async function replaceRecipientPreviewTx(tx, { workspaceId, campaignId, previewMembers }) {
  await tx.broadcastCampaignRecipient.deleteMany({ where: { campaignId } });

  if (previewMembers.length === 0) {
    return;
  }

  await tx.broadcastCampaignRecipient.createMany({
    data: previewMembers.map((member) => ({
      workspaceId,
      campaignId,
      customerId: member.customerId,
      channelSessionId: member.channelSessionId || null,
      recipientStatus: 'PENDING',
      metadataJson: member.previewReason
        ? { previewReason: member.previewReason }
        : null,
    })),
    skipDuplicates: true,
  });
}

async function recomputeCampaignRollupTx(tx, campaignId, statusOverride = null) {
  const recipients = await tx.broadcastCampaignRecipient.findMany({
    where: { campaignId },
    select: {
      recipientStatus: true,
    },
  });

  const summary = recipients.reduce((accumulator, recipient) => {
    const status = String(recipient.recipientStatus || '').toUpperCase();
    accumulator.totalAudience += 1;
    if (status === 'SENT' || status === 'DELIVERED') accumulator.totalSent += 1;
    if (status === 'DELIVERED') accumulator.totalDelivered += 1;
    if (status === 'FAILED') accumulator.totalFailed += 1;
    if (status === 'SKIPPED') accumulator.totalSkipped += 1;
    if (status === 'PENDING') accumulator.pending += 1;
    if (status === 'QUEUED') accumulator.queued += 1;
    return accumulator;
  }, {
    totalAudience: 0,
    totalSent: 0,
    totalDelivered: 0,
    totalFailed: 0,
    totalSkipped: 0,
    pending: 0,
    queued: 0,
  });

  let nextStatus = statusOverride;
  if (!nextStatus) {
    if (summary.pending > 0 || summary.queued > 0) {
      nextStatus = 'RUNNING';
    } else if (summary.totalDelivered === 0 && summary.totalSent === 0 && (summary.totalFailed > 0 || summary.totalSkipped > 0)) {
      nextStatus = 'FAILED';
    } else {
      nextStatus = 'COMPLETED';
    }
  }

  return tx.broadcastCampaign.update({
    where: { id: campaignId },
    data: {
      totalAudience: summary.totalAudience,
      totalSent: summary.totalSent,
      totalDelivered: summary.totalDelivered,
      totalFailed: summary.totalFailed,
      totalSkipped: summary.totalSkipped,
      status: nextStatus,
      ...(nextStatus === 'RUNNING' ? { startedAt: new Date(), completedAt: null } : {}),
      ...((nextStatus === 'COMPLETED' || nextStatus === 'FAILED') ? { completedAt: new Date() } : {}),
    },
    include: campaignDetailInclude,
  });
}

function buildCampaignAnalytics(campaigns = [], workspaceTier = 'STARTER') {
  const totalCampaigns = campaigns.length;
  const totals = campaigns.reduce((accumulator, campaign) => {
    accumulator.totalAudience += Number(campaign.totalAudience || 0);
    accumulator.totalSent += Number(campaign.totalSent || 0);
    accumulator.totalDelivered += Number(campaign.totalDelivered || 0);
    accumulator.totalFailed += Number(campaign.totalFailed || 0);
    accumulator.channelCounts.set(campaign.channelType, (accumulator.channelCounts.get(campaign.channelType) || 0) + 1);

    if (campaign.assignedAgentId) {
      const current = accumulator.agentPerformance.get(campaign.assignedAgentId) || {
        agentId: campaign.assignedAgentId,
        name: campaign.assignedAgent?.name || 'Agent',
        totalDelivered: 0,
        campaignCount: 0,
      };

      current.totalDelivered += Number(campaign.totalDelivered || 0);
      current.campaignCount += 1;
      accumulator.agentPerformance.set(campaign.assignedAgentId, current);
    }

    const deliveryRate = Number(campaign.totalAudience || 0) > 0
      ? Number(campaign.totalDelivered || 0) / Number(campaign.totalAudience || 0)
      : 0;
    if (!accumulator.topCampaign || deliveryRate > accumulator.topCampaign.deliveryRate || (
      deliveryRate === accumulator.topCampaign.deliveryRate
      && Number(campaign.totalDelivered || 0) > Number(accumulator.topCampaign.totalDelivered || 0)
    )) {
      accumulator.topCampaign = {
        id: campaign.id,
        title: campaign.title,
        deliveryRate: Math.round(deliveryRate * 1000) / 10,
        totalDelivered: Number(campaign.totalDelivered || 0),
      };
    }

    return accumulator;
  }, {
    totalAudience: 0,
    totalSent: 0,
    totalDelivered: 0,
    totalFailed: 0,
    channelCounts: new Map(),
    agentPerformance: new Map(),
    topCampaign: null,
  });

  const advancedAnalyticsEnabled = String(workspaceTier || '').toUpperCase() === 'PRO';
  const mostUsedChannelEntry = [...totals.channelCounts.entries()]
    .sort((left, right) => right[1] - left[1])[0] || null;
  const topPerformingAgent = [...totals.agentPerformance.values()]
    .sort((left, right) => {
      if (right.totalDelivered !== left.totalDelivered) return right.totalDelivered - left.totalDelivered;
      return right.campaignCount - left.campaignCount;
    })[0] || null;

  return {
    totalCampaigns,
    totalAudience: totals.totalAudience,
    totalSent: totals.totalSent,
    totalDelivered: totals.totalDelivered,
    totalFailed: totals.totalFailed,
    deliveryRate: totals.totalAudience > 0
      ? Math.round((totals.totalDelivered / totals.totalAudience) * 1000) / 10
      : 0,
    mostUsedChannel: advancedAnalyticsEnabled && mostUsedChannelEntry
      ? {
        channelType: mostUsedChannelEntry[0],
        campaignCount: mostUsedChannelEntry[1],
      }
      : null,
    topPerformingAgent: advancedAnalyticsEnabled ? topPerformingAgent : null,
    topCampaign: advancedAnalyticsEnabled ? totals.topCampaign : null,
    advancedAnalyticsEnabled,
  };
}

export async function listBroadcastCampaigns({ ownerId, workspaceId }) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  const campaigns = await prisma.broadcastCampaign.findMany({
    where: { workspaceId: access.workspace.id },
    include: campaignListInclude,
    orderBy: [
      { updatedAt: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  return {
    campaigns: campaigns.map((campaign) => serializeBroadcastCampaign(campaign)),
    analytics: buildCampaignAnalytics(campaigns, access.workspace.subTier),
    usage: access.usage,
    skillStatus: access.skillStatus,
  };
}

export async function getBroadcastCampaignDetail({ ownerId, workspaceId, campaignId }) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  const campaign = await loadCampaignOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    campaignId,
    include: campaignDetailInclude,
  });

  return {
    campaign: serializeBroadcastCampaign(campaign),
    skillStatus: access.skillStatus,
  };
}

export async function getBroadcastAnalyticsSummary({ ownerId, workspaceId }) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  const campaigns = await prisma.broadcastCampaign.findMany({
    where: { workspaceId: access.workspace.id },
    include: {
      assignedAgent: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return {
    analytics: buildCampaignAnalytics(campaigns, access.workspace.subTier),
    usage: access.usage,
    skillStatus: access.skillStatus,
  };
}

async function persistCampaignAudienceSnapshot({
  tx,
  workspaceId,
  campaignId,
  previewMembers,
  normalizedFilters,
}) {
  await Promise.all([
    replaceAudienceFiltersTx(tx, { workspaceId, campaignId, filters: normalizedFilters }),
    replaceRecipientPreviewTx(tx, { workspaceId, campaignId, previewMembers }),
  ]);
}

export async function createBroadcastCampaign({ ownerId, workspaceId, createdById, payload = {} }) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  const title = String(payload.title || '').trim();
  if (!title) {
    throw broadcastServiceError(400, 'Judul campaign wajib diisi.', {
      title: ['Judul campaign wajib diisi.'],
    });
  }

  const messageTemplate = String(payload.messageTemplate || '').trim();
  if (!messageTemplate) {
    throw broadcastServiceError(400, 'Template pesan wajib diisi.', {
      messageTemplate: ['Template pesan wajib diisi.'],
    });
  }

  const channelType = normalizeChannelType(payload.channelType, null);
  if (!channelType) {
    throw broadcastServiceError(400, 'Channel type broadcast tidak valid.', {
      channelType: ['Channel type broadcast tidak valid.'],
    });
  }

  const scheduledStatus = sanitizeCampaignStatusForSave(payload.status, 'DRAFT');
  const scheduledAt = scheduledStatus === 'SCHEDULED'
    ? normalizeDateInput(payload.scheduledAt, 'scheduledAt') || new Date()
    : null;
  await resolveAssignedAgentOrThrow({
    workspaceId: access.workspace.id,
    assignedAgentId: payload.assignedAgentId,
    requiredCapability: scheduledStatus === 'SCHEDULED' ? 'canScheduleCampaign' : 'canCreateCampaign',
  });

  const existingCampaignCount = await prisma.broadcastCampaign.count({ where: { workspaceId: access.workspace.id } });
  const preview = await previewBroadcastAudience({
    ownerId,
    workspaceId: access.workspace.id,
    assignedAgentId: payload.assignedAgentId,
    channelType,
    audienceFilters: payload.audienceFilters,
  });

  assertCampaignTierLimits({
    workspaceTier: access.workspace.subTier,
    matchedCount: preview.summary.matchedCount,
    existingCampaignCount,
  });

  const campaign = await prisma.$transaction(async (tx) => {
    const createdCampaign = await tx.broadcastCampaign.create({
      data: {
        workspaceId: access.workspace.id,
        createdById,
        assignedAgentId: payload.assignedAgentId,
        title,
        description: normalizeOptionalText(payload.description),
        messageTemplate,
        channelType,
        status: scheduledStatus,
        scheduledAt,
        audiencePreviewCount: preview.summary.matchedCount,
        totalAudience: preview.summary.matchedCount,
      },
    });

    await persistCampaignAudienceSnapshot({
      tx,
      workspaceId: access.workspace.id,
      campaignId: createdCampaign.id,
      previewMembers: preview.members,
      normalizedFilters: preview.filters,
    });

    return tx.broadcastCampaign.findUnique({
      where: { id: createdCampaign.id },
      include: campaignDetailInclude,
    });
  });

  return {
    campaign: serializeBroadcastCampaign(campaign),
    audiencePreview: {
      summary: preview.summary,
      previewCustomers: preview.previewCustomers,
    },
    skillStatus: access.skillStatus,
  };
}

export async function updateBroadcastCampaign({ ownerId, workspaceId, campaignId, payload = {} }) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  const existing = await loadCampaignOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    campaignId,
    include: campaignDetailInclude,
  });

  if (!ALLOWED_MUTABLE_STATUSES.has(existing.status)) {
    throw broadcastServiceError(409, 'Campaign yang sudah diproses tidak bisa diubah. Gunakan duplicate campaign untuk membuat versi baru.');
  }

  const nextStatus = sanitizeCampaignStatusForSave(payload.status, existing.status);
  const nextAssignedAgentId = payload.assignedAgentId || existing.assignedAgentId;
  const nextChannelType = normalizeChannelType(payload.channelType || existing.channelType, null);
  const nextTitle = Object.prototype.hasOwnProperty.call(payload, 'title')
    ? String(payload.title || '').trim()
    : existing.title;
  const nextMessageTemplate = Object.prototype.hasOwnProperty.call(payload, 'messageTemplate')
    ? String(payload.messageTemplate || '').trim()
    : existing.messageTemplate;

  if (!nextTitle) {
    throw broadcastServiceError(400, 'Judul campaign wajib diisi.', {
      title: ['Judul campaign wajib diisi.'],
    });
  }

  if (!nextMessageTemplate) {
    throw broadcastServiceError(400, 'Template pesan wajib diisi.', {
      messageTemplate: ['Template pesan wajib diisi.'],
    });
  }

  await resolveAssignedAgentOrThrow({
    workspaceId: access.workspace.id,
    assignedAgentId: nextAssignedAgentId,
    requiredCapability: nextStatus === 'SCHEDULED' ? 'canScheduleCampaign' : 'canEditCampaign',
  });

  const preview = await previewBroadcastAudience({
    ownerId,
    workspaceId: access.workspace.id,
    assignedAgentId: nextAssignedAgentId,
    channelType: nextChannelType,
    audienceFilters: Object.prototype.hasOwnProperty.call(payload, 'audienceFilters')
      ? payload.audienceFilters
      : existing.audiences,
  });

  assertCampaignTierLimits({
    workspaceTier: access.workspace.subTier,
    matchedCount: preview.summary.matchedCount,
    existingCampaignCount: await prisma.broadcastCampaign.count({
      where: {
        workspaceId: access.workspace.id,
        id: { not: existing.id },
      },
    }),
  });

  const scheduledAt = nextStatus === 'SCHEDULED'
    ? normalizeDateInput(payload.scheduledAt, 'scheduledAt') || existing.scheduledAt || new Date()
    : null;

  const campaign = await prisma.$transaction(async (tx) => {
    await tx.broadcastCampaign.update({
      where: { id: existing.id },
      data: {
        assignedAgentId: nextAssignedAgentId,
        title: nextTitle,
        description: Object.prototype.hasOwnProperty.call(payload, 'description')
          ? normalizeOptionalText(payload.description)
          : existing.description,
        messageTemplate: nextMessageTemplate,
        channelType: nextChannelType,
        status: nextStatus,
        scheduledAt,
        audiencePreviewCount: preview.summary.matchedCount,
        totalAudience: preview.summary.matchedCount,
        ...(nextStatus === 'DRAFT' ? { startedAt: null, completedAt: null, cancelledAt: null } : {}),
      },
    });

    await persistCampaignAudienceSnapshot({
      tx,
      workspaceId: access.workspace.id,
      campaignId: existing.id,
      previewMembers: preview.members,
      normalizedFilters: preview.filters,
    });

    return tx.broadcastCampaign.findUnique({
      where: { id: existing.id },
      include: campaignDetailInclude,
    });
  });

  return {
    campaign: serializeBroadcastCampaign(campaign),
    audiencePreview: {
      summary: preview.summary,
      previewCustomers: preview.previewCustomers,
    },
    skillStatus: access.skillStatus,
  };
}

export async function deleteBroadcastCampaign({ ownerId, workspaceId, campaignId }) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  const existing = await loadCampaignOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    campaignId,
    include: campaignListInclude,
  });

  if (existing.status === 'RUNNING') {
    throw broadcastServiceError(409, 'Campaign yang sedang RUNNING tidak bisa dihapus. Cancel dulu jika ingin menghentikannya.');
  }

  await prisma.broadcastCampaign.delete({ where: { id: existing.id } });

  return {
    deletedCampaign: serializeBroadcastCampaign(existing),
    skillStatus: access.skillStatus,
  };
}

export async function duplicateBroadcastCampaign({ ownerId, workspaceId, campaignId, createdById }) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  const existing = await loadCampaignOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    campaignId,
    include: campaignDetailInclude,
  });

  await resolveAssignedAgentOrThrow({
    workspaceId: access.workspace.id,
    assignedAgentId: existing.assignedAgentId,
    requiredCapability: 'canCreateCampaign',
  });

  const existingCampaignCount = await prisma.broadcastCampaign.count({ where: { workspaceId: access.workspace.id } });
  assertCampaignTierLimits({
    workspaceTier: access.workspace.subTier,
    matchedCount: Number(existing.audiencePreviewCount || existing.totalAudience || 0),
    existingCampaignCount,
  });

  const campaign = await prisma.$transaction(async (tx) => {
    const duplicated = await tx.broadcastCampaign.create({
      data: {
        workspaceId: access.workspace.id,
        createdById,
        assignedAgentId: existing.assignedAgentId,
        title: `${existing.title} (Copy)`,
        description: existing.description,
        messageTemplate: existing.messageTemplate,
        channelType: existing.channelType,
        status: 'DRAFT',
        audiencePreviewCount: Number(existing.audiencePreviewCount || existing.totalAudience || 0),
        totalAudience: Number(existing.totalAudience || 0),
      },
    });

    await replaceAudienceFiltersTx(tx, {
      workspaceId: access.workspace.id,
      campaignId: duplicated.id,
      filters: normalizeAudienceFilters(existing.audiences),
    });

    await replaceRecipientPreviewTx(tx, {
      workspaceId: access.workspace.id,
      campaignId: duplicated.id,
      previewMembers: (existing.recipients || []).map((recipient) => ({
        customerId: recipient.customerId,
        channelSessionId: recipient.channelSessionId,
        previewReason: recipient.metadataJson?.previewReason || null,
      })),
    });

    return tx.broadcastCampaign.findUnique({
      where: { id: duplicated.id },
      include: campaignDetailInclude,
    });
  });

  return {
    campaign: serializeBroadcastCampaign(campaign),
    skillStatus: access.skillStatus,
  };
}

export async function cancelBroadcastCampaign({ ownerId, workspaceId, campaignId }) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  const existing = await loadCampaignOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    campaignId,
    include: campaignDetailInclude,
  });

  if (TERMINAL_STATUSES.has(existing.status)) {
    return {
      campaign: serializeBroadcastCampaign(existing),
      skillStatus: access.skillStatus,
    };
  }

  const campaign = await prisma.$transaction(async (tx) => {
    await tx.broadcastCampaignRecipient.updateMany({
      where: {
        campaignId: existing.id,
        recipientStatus: { in: ['PENDING', 'QUEUED'] },
      },
      data: {
        recipientStatus: 'SKIPPED',
        skippedAt: new Date(),
        errorMessage: 'Campaign dibatalkan sebelum pengiriman selesai.',
      },
    });

    await tx.broadcastCampaign.update({
      where: { id: existing.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        completedAt: new Date(),
      },
    });

    return recomputeCampaignRollupTx(tx, existing.id, 'CANCELLED');
  });

  return {
    campaign: serializeBroadcastCampaign(campaign),
    skillStatus: access.skillStatus,
  };
}

export async function listBroadcastRecipients({ ownerId, workspaceId, campaignId, recipientStatus }) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  await loadCampaignOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    campaignId,
    include: campaignListInclude,
  });

  const recipients = await prisma.broadcastCampaignRecipient.findMany({
    where: {
      campaignId,
      workspaceId: access.workspace.id,
      ...(recipientStatus ? { recipientStatus: normalizeBroadcastRecipientStatus(recipientStatus, recipientStatus) } : {}),
    },
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phoneNumber: true,
          isBlocked: true,
          isArchived: true,
          tags: true,
        },
      },
    },
    orderBy: [
      { updatedAt: 'desc' },
      { createdAt: 'desc' },
    ],
  });

  const delivery = recipients.reduce((accumulator, recipient) => {
    const status = String(recipient.recipientStatus || '').toUpperCase();
    accumulator.total += 1;
    if (status === 'DELIVERED') accumulator.delivered += 1;
    if (status === 'FAILED') accumulator.failed += 1;
    if (status === 'SKIPPED') accumulator.skipped += 1;
    return accumulator;
  }, {
    total: 0,
    delivered: 0,
    failed: 0,
    skipped: 0,
  });

  return {
    recipients: recipients.map((recipient) => serializeBroadcastRecipient(recipient)),
    delivery: {
      successCount: delivery.delivered,
      failedCount: delivery.failed,
      skippedCount: delivery.skipped,
      deliveryPercentage: delivery.total > 0
        ? Math.round((delivery.delivered / delivery.total) * 1000) / 10
        : 0,
    },
    skillStatus: access.skillStatus,
  };
}

async function resolveBroadcastConversation({ campaign, recipient, channel }) {
  const existingConversation = await prisma.conversation.findFirst({
    where: {
      customerId: recipient.customerId,
      agentId: campaign.assignedAgentId,
      status: { in: ['ACTIVE', 'NEEDS_ADMIN'] },
      channelType: campaign.channelType,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      channelId: true,
      channelType: true,
    },
  });

  if (existingConversation) {
    if (existingConversation.channelId !== channel.id) {
      return prisma.conversation.update({
        where: { id: existingConversation.id },
        data: {
          channelId: channel.id,
          channelType: channel.type,
        },
        select: {
          id: true,
          status: true,
          channelId: true,
          channelType: true,
        },
      });
    }

    return existingConversation;
  }

  return prisma.conversation.create({
    data: {
      customerId: recipient.customerId,
      agentId: campaign.assignedAgentId,
      channelId: channel.id,
      channelType: channel.type,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      status: true,
      channelId: true,
      channelType: true,
    },
  });
}

async function markRecipientStatus(recipientId, data) {
  return prisma.broadcastCampaignRecipient.update({
    where: { id: recipientId },
    data,
  });
}

/**
 * Render placeholders in a message template for a specific recipient.
 * Supported: {customerName}, {agentName}, {phoneNumber}
 */
function renderMessageTemplate(template, { customerName, agentName, phoneNumber } = {}) {
  return String(template || '')
    .replace(/\{customerName\}/gi, customerName || 'Kak')
    .replace(/\{agentName\}/gi, agentName || 'Tim Kami')
    .replace(/\{phoneNumber\}/gi, phoneNumber || '');
}

export async function dispatchBroadcastCampaign({ campaignId }) {
  const campaign = await prisma.broadcastCampaign.findUnique({
    where: { id: campaignId },
    include: {
      assignedAgent: {
        select: {
          id: true,
          name: true,
          status: true,
          accessMode: true,
          openclawSkill: true,
          configJson: true,
        },
      },
      recipients: {
        where: { recipientStatus: { in: ['PENDING', 'QUEUED'] } },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phoneNumber: true,
              isBlocked: true,
              isArchived: true,
              tags: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!campaign) {
    console.log('[Broadcast Worker] campaign not found:', campaignId);
    return { skipped: true, reason: 'campaign_not_found' };
  }

  if (campaign.status === 'CANCELLED') {
    console.log('[Broadcast Worker] campaign cancelled:', campaignId);
    return { skipped: true, reason: 'campaign_cancelled' };
  }

  console.log('[Broadcast Worker] dispatch start', {
    campaignId: campaign.id,
    campaignName: campaign.name,
    channelType: campaign.channelType,
    recipientCount: (campaign.recipients || []).length,
    agentId: campaign.assignedAgentId,
    agentName: campaign.assignedAgent?.name,
    workspaceId: campaign.workspaceId,
  });

  if ((campaign.recipients || []).length === 0) {
    await prisma.broadcastCampaign.update({
      where: { id: campaign.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        lastError: 'Campaign tidak memiliki recipient yang bisa diproses.',
      },
    });
    console.log('[Broadcast Worker] no recipients for campaign:', campaignId);
    return { skipped: true, reason: 'campaign_has_no_recipients' };
  }

  if (!campaign.assignedAgent || !agentCanUseBroadcast(campaign.assignedAgent, 'canUseBroadcast')) {
    await prisma.broadcastCampaign.update({
      where: { id: campaign.id },
      data: {
        status: 'FAILED',
        lastError: 'Agent Broadcast tidak lagi memenuhi capability atau access mode yang dibutuhkan.',
        completedAt: new Date(),
      },
    });
    console.log('[Broadcast Worker] agent invalid for campaign:', campaignId, campaign.assignedAgent?.id);
    return { skipped: true, reason: 'agent_invalid' };
  }

  const connectedChannel = await loadConnectedAgentChannel({
    workspaceId: campaign.workspaceId,
    agentId: campaign.assignedAgentId,
    channelType: campaign.channelType,
  });

  console.log('[Broadcast Worker] channel resolution', {
    campaignId: campaign.id,
    channelType: campaign.channelType,
    channelId: connectedChannel?.id || null,
    channelStatus: connectedChannel?.status || 'NOT_FOUND',
  });

  await prisma.broadcastCampaign.update({
    where: { id: campaign.id },
    data: {
      status: 'RUNNING',
      startedAt: campaign.startedAt || new Date(),
      completedAt: null,
      lastError: null,
    },
  });

  for (const recipient of campaign.recipients) {
    const now = new Date();
    await markRecipientStatus(recipient.id, {
      recipientStatus: 'QUEUED',
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
    });

    console.log('[Broadcast Recipient] processing', {
      campaignId: campaign.id,
      recipientId: recipient.id,
      customerId: recipient.customer?.id,
      customerName: recipient.customer?.name,
      phoneNumber: recipient.customer?.phoneNumber,
      isBlocked: recipient.customer?.isBlocked,
      isArchived: recipient.customer?.isArchived,
    });

    if (!recipient.customer?.phoneNumber) {
      const errMsg = 'Customer belum memiliki identifier channel yang valid.';
      console.log('[Broadcast Failure] no phone number', { recipientId: recipient.id });
      await markRecipientStatus(recipient.id, {
        recipientStatus: 'SKIPPED',
        skippedAt: now,
        errorMessage: errMsg,
      });
      continue;
    }

    const recipientChannelType = getCustomerPhoneChannelType(recipient.customer.phoneNumber);
    if (recipientChannelType !== campaign.channelType) {
      const errMsg = `Customer channel type '${recipientChannelType}' tidak cocok dengan campaign channel '${campaign.channelType}'.`;
      console.log('[Broadcast Failure] channel type mismatch', { recipientId: recipient.id, recipientChannelType, campaignChannelType: campaign.channelType });
      await markRecipientStatus(recipient.id, {
        recipientStatus: 'SKIPPED',
        skippedAt: now,
        errorMessage: errMsg,
      });
      continue;
    }

    if (recipient.customer.isBlocked) {
      console.log('[Broadcast Failure] customer blocked', { recipientId: recipient.id });
      await markRecipientStatus(recipient.id, {
        recipientStatus: 'SKIPPED',
        skippedAt: now,
        errorMessage: 'Customer diblokir.',
      });
      continue;
    }

    if (recipient.customer.isArchived) {
      console.log('[Broadcast Failure] customer archived', { recipientId: recipient.id });
      await markRecipientStatus(recipient.id, {
        recipientStatus: 'SKIPPED',
        skippedAt: now,
        errorMessage: 'Customer diarsipkan.',
      });
      continue;
    }

    if (!connectedChannel) {
      const errMsg = `Tidak ada sesi channel ${campaign.channelType} yang CONNECTED untuk agent ini.`;
      console.log('[Broadcast Failure] no connected channel', { campaignId: campaign.id, channelType: campaign.channelType });
      await markRecipientStatus(recipient.id, {
        recipientStatus: 'SKIPPED',
        skippedAt: now,
        errorMessage: errMsg,
      });
      continue;
    }

    const conversation = await resolveBroadcastConversation({
      campaign,
      recipient,
      channel: connectedChannel,
    });

    // Render placeholders
    const renderedText = renderMessageTemplate(campaign.messageTemplate, {
      customerName: recipient.customer.name || null,
      agentName: campaign.assignedAgent?.name || null,
      phoneNumber: stripCustomerPhonePrefix(recipient.customer.phoneNumber),
    });

    if (!renderedText.trim()) {
      const errMsg = 'Pesan setelah render placeholder kosong — tidak dapat dikirim.';
      console.log('[Broadcast Failure] empty rendered message', { recipientId: recipient.id });
      await markRecipientStatus(recipient.id, {
        recipientStatus: 'FAILED',
        failedAt: now,
        errorMessage: errMsg,
        metadataJson: { conversationId: conversation.id, channelId: connectedChannel.id, channelType: connectedChannel.type, renderedText },
      });
      continue;
    }

    let runtime;
    try {
      runtime = await resolveChannelRuntime(connectedChannel.id);
    } catch (runtimeErr) {
      const errMsg = `Gagal mendapatkan runtime channel: ${runtimeErr.message}`;
      console.log('[Broadcast Failure] runtime resolution failed', { recipientId: recipient.id, channelId: connectedChannel.id, error: runtimeErr.message });
      await markRecipientStatus(recipient.id, {
        recipientStatus: 'FAILED',
        failedAt: now,
        errorMessage: errMsg,
        metadataJson: { conversationId: conversation.id, channelId: connectedChannel.id, channelType: connectedChannel.type },
      });
      continue;
    }

    const strippedPhone = stripCustomerPhonePrefix(recipient.customer.phoneNumber);

    console.log('[Broadcast Send] sending', {
      campaignId: campaign.id,
      recipientId: recipient.id,
      channelId: connectedChannel.id,
      channelType: connectedChannel.type,
      agentId: runtime.agentId,
      sessionKey: `agent:${runtime.agentId}:main`,
      to: strippedPhone,
      textLength: renderedText.length,
      renderedPreview: renderedText.slice(0, 80),
    });
    console.log('[Broadcast Adapter Request]', {
      endpoint: '/messages/send',
      channelId: connectedChannel.id,
      channelType: connectedChannel.type,
      agentId: runtime.agentId,
      to: strippedPhone,
    });

    let sendResult = null;
    try {
      sendResult = await ocSendChannelMessage(
        connectedChannel.id,
        connectedChannel.type,
        strippedPhone,
        renderedText,
        {},
        runtime,
      );
      console.log('[Broadcast Adapter Response]', { recipientId: recipient.id, ok: true, result: sendResult });
    } catch (sendErr) {
      const errMsg = sendErr.message || 'Gagal mengirim pesan via OpenClaw adapter.';
      console.error('[Broadcast Adapter Error]', {
        recipientId: recipient.id,
        campaignId: campaign.id,
        channelId: connectedChannel.id,
        channelType: connectedChannel.type,
        agentId: runtime.agentId,
        sessionKey: `agent:${runtime.agentId}:main`,
        error: errMsg,
        stack: sendErr.stack?.split('\n').slice(0, 4).join(' | '),
      });
      // Try to extract gateway-level error for clarity
      let gatewayError = null;
      try {
        const gatewayMatch = errMsg.match(/gateway.*?-> \d+: ({.+})/);
        if (gatewayMatch) {
          const parsed = JSON.parse(gatewayMatch[1]);
          gatewayError = parsed?.error?.message || parsed?.error?.type || null;
        }
      } catch {}
      if (gatewayError) {
        console.error('[Broadcast Gateway Error]', { gatewayError, recipientId: recipient.id });
      }
      await markRecipientStatus(recipient.id, {
        recipientStatus: 'FAILED',
        failedAt: now,
        errorMessage: errMsg,
        metadataJson: {
          conversationId: conversation.id,
          channelId: connectedChannel.id,
          channelType: connectedChannel.type,
          agentId: runtime.agentId,
          sessionKey: `agent:${runtime.agentId}:main`,
          renderedText,
          gatewayError,
        },
      });
      continue;
    }

    console.log('[Broadcast Success] message sent', { campaignId: campaign.id, recipientId: recipient.id, customerId: recipient.customer.id, result: sendResult });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'AI',
        content: renderedText,
        type: 'broadcast_campaign',
      },
    }).catch((dbErr) => {
      console.warn('[Broadcast Worker] message.create failed (non-fatal):', dbErr.message);
    });

    await markRecipientStatus(recipient.id, {
      recipientStatus: 'DELIVERED',
      sentAt: now,
      deliveredAt: now,
      errorMessage: null,
      metadataJson: {
        conversationId: conversation.id,
        channelId: connectedChannel.id,
        channelType: connectedChannel.type,
        agentId: runtime.agentId,
        renderedText,
      },
    });
  }

  const updatedCampaign = await prisma.$transaction(async (tx) => recomputeCampaignRollupTx(tx, campaign.id));
  const nextStatus = updatedCampaign.status;

  console.log('[Broadcast Worker] dispatch complete', {
    campaignId: campaign.id,
    finalStatus: nextStatus,
    totalSent: updatedCampaign.totalSent,
    totalDelivered: updatedCampaign.totalDelivered,
    totalFailed: updatedCampaign.totalFailed,
    totalSkipped: updatedCampaign.totalSkipped,
  });

  if (nextStatus === 'FAILED') {
    // Collect sample error from last failed recipient for better visibility
    const failedRecipient = await prisma.broadcastCampaignRecipient.findFirst({
      where: { campaignId: campaign.id, recipientStatus: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      select: { errorMessage: true },
    });
    const lastError = failedRecipient?.errorMessage || 'Campaign selesai tanpa recipient yang berhasil dikirim.';
    await prisma.broadcastCampaign.update({
      where: { id: campaign.id },
      data: { lastError },
    });
  }

  return {
    campaign: serializeBroadcastCampaign(updatedCampaign),
  };
}

export async function retryFailedBroadcastRecipients({ ownerId, workspaceId, campaignId }) {
  const access = await assertBroadcastCampaignAccess({ ownerId, workspaceId, requireActive: true });
  const campaign = await loadCampaignOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    campaignId,
    include: campaignDetailInclude,
  });

  await resolveAssignedAgentOrThrow({
    workspaceId: access.workspace.id,
    assignedAgentId: campaign.assignedAgentId,
    requiredCapability: 'canEditCampaign',
  });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.broadcastCampaignRecipient.updateMany({
      where: {
        campaignId: campaign.id,
        recipientStatus: 'FAILED',
      },
      data: {
        recipientStatus: 'PENDING',
        failedAt: null,
        errorMessage: null,
      },
    });

    await tx.broadcastCampaign.update({
      where: { id: campaign.id },
      data: {
        status: 'SCHEDULED',
        scheduledAt: new Date(),
        completedAt: null,
        lastError: null,
      },
    });

    const nextCampaign = await tx.broadcastCampaign.findUnique({
      where: { id: campaign.id },
      include: campaignDetailInclude,
    });

    return {
      retriedCount: updated.count,
      campaign: nextCampaign,
    };
  });

  return {
    retriedCount: result.retriedCount,
    campaign: serializeBroadcastCampaign(result.campaign),
    skillStatus: access.skillStatus,
  };
}

export async function listDueBroadcastCampaignIds({ limit = 25 }) {
  const now = new Date();
  const dueCampaigns = await prisma.broadcastCampaign.findMany({
    where: {
      OR: [
        {
          status: 'SCHEDULED',
          scheduledAt: { lte: now },
        },
        {
          status: 'RUNNING',
        },
      ],
    },
    select: {
      id: true,
      workspaceId: true,
    },
    orderBy: [
      { scheduledAt: 'asc' },
      { createdAt: 'asc' },
    ],
    take: limit,
  });

  return dueCampaigns;
}

export const broadcastCampaignService = {
  assertBroadcastCampaignAccess,
  cancelBroadcastCampaign,
  createBroadcastCampaign,
  deleteBroadcastCampaign,
  dispatchBroadcastCampaign,
  duplicateBroadcastCampaign,
  getBroadcastAnalyticsSummary,
  getBroadcastCampaignDetail,
  listBroadcastCampaigns,
  listBroadcastRecipients,
  listDueBroadcastCampaignIds,
  previewBroadcastAudience,
  retryFailedBroadcastRecipients,
  updateBroadcastCampaign,
};
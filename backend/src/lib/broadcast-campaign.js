import { getAgentSkillConfig } from './agent-config.js';

export const BROADCAST_CAMPAIGN_SKILL_KEY = 'broadcast-campaign';

export const BROADCAST_CAMPAIGN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

export const BROADCAST_RECIPIENT_STATUSES = [
  'PENDING',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'SKIPPED',
];

export const BROADCAST_AUDIENCE_FILTER_TYPES = [
  'CRM_STAGE',
  'CUSTOMER_TAG',
  'CUSTOMER_STATUS',
  'ASSIGNED_AGENT',
  'CHANNEL_TYPE',
  'APPROVAL_STATUS',
  'LAST_ACTIVITY',
  'SPECIFIC_CUSTOMER',
];

export const BROADCAST_FILTER_MODES = ['INCLUDE', 'EXCLUDE'];

export const DEFAULT_BROADCAST_AGENT_CONFIG = Object.freeze({
  canUseBroadcast: true,
  canCreateCampaign: true,
  canEditCampaign: true,
  canDeleteCampaign: true,
  canScheduleCampaign: true,
  canViewCampaignAnalytics: true,
});

export const BROADCAST_TIER_LIMITS = Object.freeze({
  STARTER: {
    maxCampaigns: 5,
    maxAudience: 100,
    advancedAnalytics: false,
  },
  GROWTH: {
    maxCampaigns: 50,
    maxAudience: 1000,
    advancedAnalytics: false,
  },
  PRO: {
    maxCampaigns: null,
    maxAudience: null,
    advancedAnalytics: true,
  },
});

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeJsonValue(value, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null) return null;
  return value;
}

export function normalizeBroadcastCampaignStatus(value, fallback = 'DRAFT') {
  const normalized = String(value || '').trim().toUpperCase();
  return BROADCAST_CAMPAIGN_STATUSES.includes(normalized) ? normalized : fallback;
}

export function normalizeBroadcastRecipientStatus(value, fallback = 'PENDING') {
  const normalized = String(value || '').trim().toUpperCase();
  return BROADCAST_RECIPIENT_STATUSES.includes(normalized) ? normalized : fallback;
}

export function normalizeBroadcastFilterType(value, fallback = 'SPECIFIC_CUSTOMER') {
  const normalized = String(value || '').trim().toUpperCase();
  return BROADCAST_AUDIENCE_FILTER_TYPES.includes(normalized) ? normalized : fallback;
}

export function normalizeBroadcastFilterMode(value, fallback = 'INCLUDE') {
  const normalized = String(value || '').trim().toUpperCase();
  return BROADCAST_FILTER_MODES.includes(normalized) ? normalized : fallback;
}

export function normalizeBroadcastAgentConfig(value = {}) {
  const raw = asPlainObject(value);

  return {
    canUseBroadcast: normalizeBoolean(raw.canUseBroadcast, DEFAULT_BROADCAST_AGENT_CONFIG.canUseBroadcast),
    canCreateCampaign: normalizeBoolean(raw.canCreateCampaign, DEFAULT_BROADCAST_AGENT_CONFIG.canCreateCampaign),
    canEditCampaign: normalizeBoolean(raw.canEditCampaign, DEFAULT_BROADCAST_AGENT_CONFIG.canEditCampaign),
    canDeleteCampaign: normalizeBoolean(raw.canDeleteCampaign, DEFAULT_BROADCAST_AGENT_CONFIG.canDeleteCampaign),
    canScheduleCampaign: normalizeBoolean(raw.canScheduleCampaign, DEFAULT_BROADCAST_AGENT_CONFIG.canScheduleCampaign),
    canViewCampaignAnalytics: normalizeBoolean(raw.canViewCampaignAnalytics, DEFAULT_BROADCAST_AGENT_CONFIG.canViewCampaignAnalytics),
  };
}

export function getBroadcastAgentConfig(agentOrConfig) {
  return normalizeBroadcastAgentConfig(
    getAgentSkillConfig(agentOrConfig, BROADCAST_CAMPAIGN_SKILL_KEY)
      || agentOrConfig?.broadcastCampaignConfig
      || agentOrConfig?.broadcastCampaign
      || {},
  );
}

export function getBroadcastTierLimits(tier) {
  const normalizedTier = String(tier || 'FREE').trim().toUpperCase();
  if (normalizedTier === 'PRO') return BROADCAST_TIER_LIMITS.PRO;
  if (normalizedTier === 'GROWTH') return BROADCAST_TIER_LIMITS.GROWTH;
  return BROADCAST_TIER_LIMITS.STARTER;
}

export function agentCanUseBroadcast(agent, capability = 'canUseBroadcast') {
  const config = getBroadcastAgentConfig(agent);
  if (agent?.accessMode !== 'APPROVAL_REQUIRED') {
    return false;
  }

  if (!config.canUseBroadcast) {
    return false;
  }

  return capability === 'canUseBroadcast' ? true : Boolean(config[capability]);
}

export function serializeBroadcastAudienceFilter(filter) {
  if (!filter) return null;

  return {
    id: filter.id,
    workspaceId: filter.workspaceId,
    campaignId: filter.campaignId,
    filterType: normalizeBroadcastFilterType(filter.filterType),
    includeMode: normalizeBroadcastFilterMode(filter.includeMode),
    operator: normalizeOptionalText(filter.operator),
    position: Number(filter.position || 0),
    valueJson: normalizeJsonValue(filter.valueJson, null),
    createdAt: filter.createdAt,
    updatedAt: filter.updatedAt,
  };
}

export function serializeBroadcastRecipient(recipient) {
  if (!recipient) return null;

  return {
    id: recipient.id,
    workspaceId: recipient.workspaceId,
    campaignId: recipient.campaignId,
    customerId: recipient.customerId,
    channelSessionId: recipient.channelSessionId || null,
    recipientStatus: normalizeBroadcastRecipientStatus(recipient.recipientStatus),
    sentAt: recipient.sentAt || null,
    deliveredAt: recipient.deliveredAt || null,
    failedAt: recipient.failedAt || null,
    skippedAt: recipient.skippedAt || null,
    lastAttemptAt: recipient.lastAttemptAt || null,
    attemptCount: Number(recipient.attemptCount || 0),
    errorMessage: recipient.errorMessage || null,
    metadataJson: recipient.metadataJson || null,
    customer: recipient.customer
      ? {
        id: recipient.customer.id,
        name: recipient.customer.name || null,
        phoneNumber: recipient.customer.phoneNumber || null,
        isBlocked: Boolean(recipient.customer.isBlocked),
        isArchived: Boolean(recipient.customer.isArchived),
        tags: Array.isArray(recipient.customer.tags) ? recipient.customer.tags : [],
      }
      : null,
  };
}

export function serializeBroadcastCampaign(campaign) {
  if (!campaign) return null;

  const recipients = Array.isArray(campaign.recipients) ? campaign.recipients.map(serializeBroadcastRecipient) : undefined;

  return {
    id: campaign.id,
    workspaceId: campaign.workspaceId,
    createdById: campaign.createdById,
    assignedAgentId: campaign.assignedAgentId,
    title: campaign.title,
    description: campaign.description || null,
    messageTemplate: campaign.messageTemplate,
    channelType: campaign.channelType,
    status: normalizeBroadcastCampaignStatus(campaign.status),
    scheduledAt: campaign.scheduledAt || null,
    startedAt: campaign.startedAt || null,
    completedAt: campaign.completedAt || null,
    cancelledAt: campaign.cancelledAt || null,
    audiencePreviewCount: Number(campaign.audiencePreviewCount || 0),
    totalAudience: Number(campaign.totalAudience || 0),
    totalSent: Number(campaign.totalSent || 0),
    totalDelivered: Number(campaign.totalDelivered || 0),
    totalFailed: Number(campaign.totalFailed || 0),
    totalSkipped: Number(campaign.totalSkipped || 0),
    usageCount: Number(campaign.totalAudience || 0),
    deliveryRate: Number(campaign.totalAudience || 0) > 0
      ? Math.round((Number(campaign.totalDelivered || 0) / Number(campaign.totalAudience || 0)) * 1000) / 10
      : 0,
    lastError: campaign.lastError || null,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    createdBy: campaign.createdBy
      ? {
        id: campaign.createdBy.id,
        name: campaign.createdBy.name,
        email: campaign.createdBy.email,
      }
      : null,
    assignedAgent: campaign.assignedAgent
      ? {
        id: campaign.assignedAgent.id,
        name: campaign.assignedAgent.name,
        status: campaign.assignedAgent.status,
        accessMode: campaign.assignedAgent.accessMode,
        capabilities: getBroadcastAgentConfig(campaign.assignedAgent),
      }
      : null,
    audiences: Array.isArray(campaign.audiences)
      ? [...campaign.audiences]
        .sort((left, right) => Number(left.position || 0) - Number(right.position || 0))
        .map(serializeBroadcastAudienceFilter)
      : undefined,
    recipients,
    recipientCount: Array.isArray(recipients) ? recipients.length : Number(campaign._count?.recipients || 0),
    failedRecipientCount: Array.isArray(recipients)
      ? recipients.filter((recipient) => recipient.recipientStatus === 'FAILED').length
      : Number(campaign.totalFailed || 0),
  };
}
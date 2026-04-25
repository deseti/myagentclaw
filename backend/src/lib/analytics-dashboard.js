import { getAgentAssignedSkills, getAgentSkillConfig } from './agent-config.js';

export const ANALYTICS_DASHBOARD_SKILL_KEY = 'analytics-dashboard';

export const ANALYTICS_CAPABILITIES = Object.freeze([
  'canViewAnalytics',
  'canViewRevenueAnalytics',
  'canViewAgentPerformance',
  'canViewBroadcastAnalytics',
  'canViewAppointmentAnalytics',
  'canViewPaymentAnalytics',
]);

export const ANALYTICS_SKILL_TYPES = Object.freeze([
  'analytics-dashboard',
  'appointment-scheduler',
  'broadcast-campaign',
  'crm-pipeline',
  'payment-reminder',
  'polymarket-read-only',
  'polymarket-growth-autopilot',
]);

export const ANALYTICS_WINDOWS = Object.freeze([
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'ROLLING_7_DAYS',
  'ROLLING_30_DAYS',
]);

export const ANALYTICS_ACTIVITY_TYPES = Object.freeze([
  'customer-created',
  'lead-stage-changed',
  'appointment-created',
  'appointment-missed',
  'payment-reminder-sent',
  'broadcast-campaign-sent',
  'broadcast-campaign-delivered',
  'broadcast-campaign-failed',
  'skill-installed',
  'agent-assigned-skill',
  'conversation-started',
]);

export const DEFAULT_ANALYTICS_AGENT_CONFIG = Object.freeze({
  canViewAnalytics: true,
  canViewRevenueAnalytics: true,
  canViewAgentPerformance: true,
  canViewBroadcastAnalytics: true,
  canViewAppointmentAnalytics: true,
  canViewPaymentAnalytics: true,
});

export const ANALYTICS_TIER_RULES = Object.freeze({
  STARTER: {
    supportsAdvancedCharts: false,
    supportsForecasting: false,
    supportsRevenueAnalytics: false,
    supportsAgentPerformance: false,
    enabledCapabilities: ['canViewAnalytics'],
  },
  GROWTH: {
    supportsAdvancedCharts: true,
    supportsForecasting: false,
    supportsRevenueAnalytics: false,
    supportsAgentPerformance: false,
    enabledCapabilities: [
      'canViewAnalytics',
      'canViewBroadcastAnalytics',
      'canViewAppointmentAnalytics',
      'canViewPaymentAnalytics',
    ],
  },
  PRO: {
    supportsAdvancedCharts: true,
    supportsForecasting: true,
    supportsRevenueAnalytics: true,
    supportsAgentPerformance: true,
    enabledCapabilities: [...ANALYTICS_CAPABILITIES],
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

export function normalizeAnalyticsTier(value, fallback = 'STARTER') {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'PRO') return 'PRO';
  if (normalized === 'GROWTH') return 'GROWTH';
  if (normalized === 'STARTER') return 'STARTER';
  if (normalized === 'FREE') return 'FREE';
  return fallback;
}

export function getAnalyticsTierRules(tier) {
  const normalizedTier = normalizeAnalyticsTier(tier, 'STARTER');
  if (normalizedTier === 'PRO') return ANALYTICS_TIER_RULES.PRO;
  if (normalizedTier === 'GROWTH') return ANALYTICS_TIER_RULES.GROWTH;
  return ANALYTICS_TIER_RULES.STARTER;
}

export function normalizeAnalyticsWindow(value, fallback = 'DAILY') {
  const normalized = String(value || '').trim().toUpperCase();
  return ANALYTICS_WINDOWS.includes(normalized) ? normalized : fallback;
}

export function normalizeAnalyticsSkillType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ANALYTICS_SKILL_TYPES.includes(normalized) ? normalized : null;
}

export function normalizeAnalyticsActivityType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ANALYTICS_ACTIVITY_TYPES.includes(normalized) ? normalized : null;
}

export function normalizeAnalyticsAgentConfig(value = {}) {
  const raw = asPlainObject(value);

  return {
    canViewAnalytics: normalizeBoolean(raw.canViewAnalytics, DEFAULT_ANALYTICS_AGENT_CONFIG.canViewAnalytics),
    canViewRevenueAnalytics: normalizeBoolean(raw.canViewRevenueAnalytics, DEFAULT_ANALYTICS_AGENT_CONFIG.canViewRevenueAnalytics),
    canViewAgentPerformance: normalizeBoolean(raw.canViewAgentPerformance, DEFAULT_ANALYTICS_AGENT_CONFIG.canViewAgentPerformance),
    canViewBroadcastAnalytics: normalizeBoolean(raw.canViewBroadcastAnalytics, DEFAULT_ANALYTICS_AGENT_CONFIG.canViewBroadcastAnalytics),
    canViewAppointmentAnalytics: normalizeBoolean(raw.canViewAppointmentAnalytics, DEFAULT_ANALYTICS_AGENT_CONFIG.canViewAppointmentAnalytics),
    canViewPaymentAnalytics: normalizeBoolean(raw.canViewPaymentAnalytics, DEFAULT_ANALYTICS_AGENT_CONFIG.canViewPaymentAnalytics),
  };
}

export function getAnalyticsDashboardAgentConfig(agentOrConfig) {
  return normalizeAnalyticsAgentConfig(
    getAgentSkillConfig(agentOrConfig, ANALYTICS_DASHBOARD_SKILL_KEY)
      || agentOrConfig?.analyticsDashboardConfig
      || agentOrConfig?.analyticsDashboard
      || {},
  );
}

export function workspaceTierAllowsAnalyticsCapability(workspaceTier, capability = 'canViewAnalytics') {
  const rules = getAnalyticsTierRules(workspaceTier);
  return rules.enabledCapabilities.includes(capability);
}

export function agentCanUseAnalyticsDashboard(agent, capability = 'canViewAnalytics', workspaceTier = 'PRO') {
  const config = getAnalyticsDashboardAgentConfig(agent);
  const assignedSkills = getAgentAssignedSkills(agent).map((skill) => String(skill || '').trim().toLowerCase());

  if (agent?.accessMode !== 'APPROVAL_REQUIRED') {
    return false;
  }

  if (!assignedSkills.includes(ANALYTICS_DASHBOARD_SKILL_KEY)) {
    return false;
  }

  if (!config.canViewAnalytics) {
    return false;
  }

  if (!workspaceTierAllowsAnalyticsCapability(workspaceTier, capability)) {
    return false;
  }

  return capability === 'canViewAnalytics' ? true : Boolean(config[capability]);
}

export function serializeAnalyticsTierAccess(workspaceTier) {
  const normalizedTier = normalizeAnalyticsTier(workspaceTier, 'STARTER');
  const rules = getAnalyticsTierRules(normalizedTier);

  return {
    tier: normalizedTier,
    supportsAdvancedCharts: rules.supportsAdvancedCharts,
    supportsForecasting: rules.supportsForecasting,
    supportsRevenueAnalytics: rules.supportsRevenueAnalytics,
    supportsAgentPerformance: rules.supportsAgentPerformance,
    enabledCapabilities: [...rules.enabledCapabilities],
  };
}

export function buildAnalyticsSkillStatus(access, usageCount = 0) {
  return {
    key: ANALYTICS_DASHBOARD_SKILL_KEY,
    installed: Boolean(access?.isInstalled),
    active: Boolean(access?.isActive),
    assignedCount: Number(access?.assignedCount || 0),
    usageCount: Number(usageCount || 0),
    usedBy: Array.isArray(access?.assignedAgents) ? access.assignedAgents : [],
    opensSidebar: 'Analytics Dashboard',
    worker: 'analytics-dashboard-worker',
    mainCapability: 'canViewAnalytics',
    supportsAnalytics: true,
  };
}
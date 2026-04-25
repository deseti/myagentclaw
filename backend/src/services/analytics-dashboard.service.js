import prisma from '../lib/prisma.js';
import { getAgentAssignedSkills } from '../lib/agent-config.js';
import {
  ANALYTICS_DASHBOARD_SKILL_KEY,
  agentCanUseAnalyticsDashboard,
  buildAnalyticsSkillStatus,
  getAnalyticsDashboardAgentConfig,
  serializeAnalyticsTierAccess,
  workspaceTierAllowsAnalyticsCapability,
} from '../lib/analytics-dashboard.js';
import { APPOINTMENT_ACTIVITY_ACTIONS } from '../lib/appointment-scheduler.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../lib/internal-skills.js';
import { ocListInstalledSkills } from '../lib/openclaw-client.js';
import { ensureWorkspaceRuntime } from '../lib/runtime-manager.js';
import { matchesSkillKey } from '../lib/skill-activation.js';

const ANALYTICS_SKILL_DEFINITION = getInternalSkillDefinition(ANALYTICS_DASHBOARD_SKILL_KEY);
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVITY_ITEMS = 120;
const TOP_LIST_LIMIT = 10;

const KNOWN_SKILL_METADATA = Object.freeze({
  'analytics-dashboard': { displayName: 'Analytics Dashboard', group: 'Insights' },
  'appointment-scheduler': { displayName: 'Appointment Scheduler', group: 'Productivity' },
  'broadcast-campaign': { displayName: 'Broadcast Campaign', group: 'Campaign Ops' },
  'crm-pipeline': { displayName: 'CRM Pipeline', group: 'Sales Ops' },
  'payment-reminder': { displayName: 'Payment Reminder', group: 'Finance' },
  'polymarket-read-only': { displayName: 'Polymarket Read-Only', group: 'Market Intelligence' },
  'polymarket-growth-autopilot': { displayName: 'Polymarket Growth Autopilot', group: 'Automation' },
});

const SKILL_COMPARISON_KEYS = [
  'crm-pipeline',
  'broadcast-campaign',
  'appointment-scheduler',
  'payment-reminder',
  'polymarket-read-only',
  'polymarket-growth-autopilot',
  'analytics-dashboard',
];

export class AnalyticsDashboardServiceError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'AnalyticsDashboardServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function analyticsError(statusCode, message, details) {
  return new AnalyticsDashboardServiceError(statusCode, message, details);
}

function decimalToNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundNumber(value, fractionDigits = 1) {
  const precision = 10 ** fractionDigits;
  return Math.round(decimalToNumber(value, 0) * precision) / precision;
}

function safeDivide(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function safePercent(numerator, denominator) {
  return roundNumber(safeDivide(numerator, denominator) * 100, 1);
}

function normalizeOptionalText(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeDatePreset(value, fallback = '30d') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'today') return 'today';
  if (['7d', '7days', '7-days', '7_days'].includes(normalized)) return '7d';
  if (['30d', '30days', '30-days', '30_days'].includes(normalized)) return '30d';
  if (normalized === 'custom') return 'custom';
  return fallback;
}

function startOfUtcDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function addUtcDays(value, dayCount) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayCount, 0, 0, 0, 0));
}

function startOfUtcWeek(value) {
  const baseDate = startOfUtcDay(value);
  const weekday = baseDate.getUTCDay();
  const distanceFromMonday = weekday === 0 ? 6 : weekday - 1;
  return addUtcDays(baseDate, -distanceFromMonday);
}

function startOfUtcMonth(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function coerceDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isWithinRange(value, rangeStart, rangeEnd) {
  const date = coerceDate(value);
  if (!date) return false;
  return date.getTime() >= rangeStart.getTime() && date.getTime() <= rangeEnd.getTime();
}

function toDateKey(value) {
  return startOfUtcDay(value).toISOString().slice(0, 10);
}

function toCompactDateLabel(value) {
  return startOfUtcDay(value).toISOString().slice(5, 10);
}

function buildDayBuckets(rangeStart, rangeEnd) {
  const buckets = [];

  for (let cursor = startOfUtcDay(rangeStart); cursor.getTime() <= rangeEnd.getTime(); cursor = addUtcDays(cursor, 1)) {
    buckets.push({
      key: toDateKey(cursor),
      label: toCompactDateLabel(cursor),
      date: new Date(cursor),
    });
  }

  return buckets;
}

function createBucketIndex(buckets) {
  return new Map(buckets.map((bucket) => [bucket.key, bucket]));
}

function incrementBucket(index, value, field, amount = 1) {
  if (!value) return;
  const bucket = index.get(toDateKey(value));
  if (!bucket) return;
  bucket[field] = decimalToNumber(bucket[field], 0) + decimalToNumber(amount, 0);
}

function buildScopeKey({ agentId = null, skillType = null } = {}) {
  if (agentId && skillType) return `agent:${agentId}:skill:${skillType}`;
  if (agentId) return `agent:${agentId}`;
  if (skillType) return `skill:${skillType}`;
  return 'workspace';
}

function buildCacheWindow(preset) {
  if (preset === 'today') return 'DAILY';
  if (preset === '7d') return 'ROLLING_7_DAYS';
  if (preset === '30d') return 'ROLLING_30_DAYS';
  return 'DAILY';
}

function buildCacheRange(rangeStart, rangeEnd) {
  return {
    rangeStart: startOfUtcDay(rangeStart),
    rangeEnd: endOfUtcDay(rangeEnd),
  };
}

function buildAgentMap(agents) {
  return new Map((agents || []).map((agent) => [agent.id, agent]));
}

function createAssignedSkillMap(agents = []) {
  const assignments = new Map();

  for (const agent of agents) {
    for (const skillKey of getAgentAssignedSkills(agent)) {
      const current = assignments.get(skillKey) || [];
      current.push(agent);
      assignments.set(skillKey, current);
    }
  }

  return assignments;
}

function mergeInstalledAssignments(installedSkills = [], agents = []) {
  const assignments = createAssignedSkillMap(agents);

  return installedSkills.map((skill) => {
    const assignedAgents = assignments.get(skill.skillKey) || [];

    return {
      ...skill,
      assignedAgents: assignedAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        accessMode: agent.accessMode,
      })),
      assignedCount: assignedAgents.length,
      isActive: assignedAgents.length > 0,
    };
  });
}

function buildInstalledSkillsMap(installedSkills = []) {
  const map = new Map();

  for (const skill of installedSkills) {
    if (skill?.skillKey) map.set(skill.skillKey, skill);
    if (skill?.slug) map.set(skill.slug, skill);
  }

  return map;
}

function buildKnownSkillList(installedSkills = []) {
  const installedMap = buildInstalledSkillsMap(installedSkills);

  return SKILL_COMPARISON_KEYS.map((skillKey) => {
    const installedSkill = installedMap.get(skillKey) || null;
    const metadata = KNOWN_SKILL_METADATA[skillKey] || {};

    return {
      skillKey,
      displayName: installedSkill?.displayName || metadata.displayName || skillKey,
      installed: Boolean(installedSkill),
      installedAt: installedSkill?.installedAt || null,
      assignedCount: Number(installedSkill?.assignedCount || 0),
      assignedAgents: Array.isArray(installedSkill?.assignedAgents) ? installedSkill.assignedAgents : [],
      group: metadata.group || 'Workspace',
    };
  });
}

function serializeFilters(filters) {
  return {
    preset: filters.preset,
    rangeStart: filters.rangeStart.toISOString(),
    rangeEnd: filters.rangeEnd.toISOString(),
    agentId: filters.agentId || null,
    skillType: filters.skillType || null,
    activityType: filters.activityType || null,
    scopeKey: filters.scopeKey,
    window: filters.window,
  };
}

function normalizeBundleMeta(meta = {}) {
  return {
    generatedAt: meta.generatedAt || new Date().toISOString(),
    cache: {
      hit: Boolean(meta.cache?.hit),
      updatedAt: meta.cache?.updatedAt || null,
      ttlMs: CACHE_TTL_MS,
    },
  };
}

async function readDashboardCache({ workspaceId, scopeKey, cacheKey, window, rangeStart, rangeEnd }) {
  const cached = await prisma.analyticsSummaryCache.findUnique({
    where: {
      workspaceId_scopeKey_cacheKey_window_rangeStart_rangeEnd: {
        workspaceId,
        scopeKey,
        cacheKey,
        window,
        rangeStart,
        rangeEnd,
      },
    },
  });

  if (!cached) return null;
  if ((Date.now() - new Date(cached.updatedAt).getTime()) > CACHE_TTL_MS) return null;

  return cached;
}

async function writeDashboardCache({ workspaceId, agentId, scopeKey, cacheKey, skillType, window, rangeStart, rangeEnd, summaryJson }) {
  return prisma.analyticsSummaryCache.upsert({
    where: {
      workspaceId_scopeKey_cacheKey_window_rangeStart_rangeEnd: {
        workspaceId,
        scopeKey,
        cacheKey,
        window,
        rangeStart,
        rangeEnd,
      },
    },
    update: {
      agentId: agentId || null,
      skillType: skillType || null,
      summaryJson,
      lastComputedAt: new Date(),
    },
    create: {
      workspaceId,
      agentId: agentId || null,
      scopeKey,
      cacheKey,
      skillType: skillType || null,
      window,
      rangeStart,
      rangeEnd,
      summaryJson,
      lastComputedAt: new Date(),
    },
  });
}

function buildCapabilityCoverage(analyticsAgents = [], workspaceTier = 'STARTER') {
  const capabilities = [
    'canViewAnalytics',
    'canViewRevenueAnalytics',
    'canViewAgentPerformance',
    'canViewBroadcastAnalytics',
    'canViewAppointmentAnalytics',
    'canViewPaymentAnalytics',
  ];

  return Object.fromEntries(capabilities.map((capability) => [
    capability,
    {
      enabled: workspaceTierAllowsAnalyticsCapability(workspaceTier, capability),
      assignedAgents: analyticsAgents.filter((agent) => agentCanUseAnalyticsDashboard(agent, capability, workspaceTier)).length,
    },
  ]));
}

function buildRelatedCustomerIds({ conversations = [], appointments = [], reminders = [], crmEntries = [], recipients = [] }) {
  const customerIds = new Set();

  for (const row of conversations) customerIds.add(row.customerId);
  for (const row of appointments) customerIds.add(row.customerId);
  for (const row of reminders) customerIds.add(row.customerId);
  for (const row of crmEntries) customerIds.add(row.customerId);
  for (const row of recipients) customerIds.add(row.customerId);

  customerIds.delete(undefined);
  customerIds.delete(null);
  customerIds.delete('');
  return customerIds;
}

function buildConversationWhere(workspaceId, filters) {
  return {
    agent: { workspaceId },
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    startedAt: { gte: filters.rangeStart, lte: filters.rangeEnd },
  };
}

function buildAppointmentWhere(workspaceId, filters) {
  return {
    workspaceId,
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    OR: [
      { createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { scheduledAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { completedAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { updatedAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
    ],
  };
}

function buildReminderWhere(workspaceId, filters) {
  return {
    workspaceId,
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    OR: [
      { createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { sentAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { failedAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { dueDate: { gte: filters.rangeStart, lte: filters.rangeEnd } },
    ],
  };
}

function buildCrmEntryWhere(workspaceId, filters) {
  return {
    workspaceId,
    ...(filters.agentId ? { assignedAgentId: filters.agentId } : {}),
    OR: [
      { createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { updatedAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { lastActivityAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
    ],
  };
}

function buildCrmActivityWhere(workspaceId, filters) {
  return {
    workspaceId,
    createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd },
    ...(filters.agentId ? { customerPipelineEntry: { assignedAgentId: filters.agentId } } : {}),
  };
}

function buildCampaignWhere(workspaceId, filters) {
  return {
    workspaceId,
    ...(filters.agentId ? { assignedAgentId: filters.agentId } : {}),
    OR: [
      { createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { startedAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { completedAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { updatedAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
    ],
  };
}

function buildRecipientWhere(workspaceId, filters) {
  return {
    workspaceId,
    ...(filters.agentId ? { campaign: { assignedAgentId: filters.agentId } } : {}),
    OR: [
      { createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { sentAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { deliveredAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { failedAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
    ],
  };
}

function buildTransactionWhere(workspaceId, filters) {
  return {
    workspaceId,
    OR: [
      { createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
      { paidAt: { gte: filters.rangeStart, lte: filters.rangeEnd } },
    ],
  };
}

async function loadAnalyticsWorkspace(ownerId, workspaceId) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId },
    select: { id: true, ownerId: true, name: true, subTier: true, subStatus: true },
  });

  if (!workspace) {
    throw analyticsError(404, 'Workspace tidak ditemukan.');
  }

  return workspace;
}

function resolveFilterRange({ preset, startDate, endDate, now = new Date() }) {
  const normalizedPreset = normalizeDatePreset(preset, '30d');
  const referenceDate = endOfUtcDay(now);

  if (normalizedPreset === 'today') {
    return {
      preset: normalizedPreset,
      rangeStart: startOfUtcDay(referenceDate),
      rangeEnd: endOfUtcDay(referenceDate),
      window: 'DAILY',
    };
  }

  if (normalizedPreset === '7d') {
    return {
      preset: normalizedPreset,
      rangeStart: addUtcDays(startOfUtcDay(referenceDate), -6),
      rangeEnd: endOfUtcDay(referenceDate),
      window: 'ROLLING_7_DAYS',
    };
  }

  if (normalizedPreset === '30d') {
    return {
      preset: normalizedPreset,
      rangeStart: addUtcDays(startOfUtcDay(referenceDate), -29),
      rangeEnd: endOfUtcDay(referenceDate),
      window: 'ROLLING_30_DAYS',
    };
  }

  const parsedStartDate = coerceDate(startDate);
  const parsedEndDate = coerceDate(endDate);

  if (!parsedStartDate || !parsedEndDate) {
    throw analyticsError(400, 'Custom date range membutuhkan startDate dan endDate yang valid.');
  }

  const rangeStart = startOfUtcDay(parsedStartDate);
  const rangeEnd = endOfUtcDay(parsedEndDate);

  if (rangeStart.getTime() > rangeEnd.getTime()) {
    throw analyticsError(400, 'startDate tidak boleh lebih besar dari endDate.');
  }

  return {
    preset: normalizedPreset,
    rangeStart,
    rangeEnd,
    window: 'DAILY',
  };
}

function resolveAnalyticsFilters(filters = {}) {
  const range = resolveFilterRange({
    preset: filters.preset,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });
  const skillType = normalizeOptionalText(filters.skillType)?.toLowerCase() || null;
  const agentId = normalizeOptionalText(filters.agentId);
  const activityType = normalizeOptionalText(filters.activityType)?.toLowerCase() || null;

  return {
    ...range,
    agentId,
    skillType,
    activityType,
    scopeKey: buildScopeKey({ agentId, skillType }),
  };
}

export async function assertAnalyticsDashboardAccess({ ownerId, workspaceId, requireActive = true }) {
  const workspace = await loadAnalyticsWorkspace(ownerId, workspaceId);

  if (!workspaceMeetsMinimumTier(workspace.subTier, ANALYTICS_SKILL_DEFINITION?.minimumTier || 'STARTER')) {
    throw analyticsError(
      403,
      `Analytics Dashboard memerlukan minimum paket ${formatInternalSkillTierLabel(ANALYTICS_SKILL_DEFINITION?.minimumTier)}.`,
    );
  }

  try {
    const runtime = await ensureWorkspaceRuntime({ ...workspace, ownerId });
    const [installedPayload, agents, usageCount] = await Promise.all([
      ocListInstalledSkills(runtime),
      prisma.agent.findMany({
        where: { workspaceId: workspace.id },
        select: {
          id: true,
          name: true,
          status: true,
          accessMode: true,
          openclawSkill: true,
          configJson: true,
          updatedAt: true,
        },
        orderBy: { name: 'asc' },
      }),
      prisma.analyticsMetricSnapshot.count({ where: { workspaceId: workspace.id } }),
    ]);

    const installedSkills = mergeInstalledAssignments(
      Array.isArray(installedPayload?.skills) ? installedPayload.skills : [],
      agents,
    );
    const skillInstalled = installedSkills.some((skill) => matchesSkillKey(skill, ANALYTICS_DASHBOARD_SKILL_KEY));

    if (!skillInstalled) {
      throw analyticsError(403, 'Skill built-in Analytics Dashboard belum diinstall untuk workspace ini.', {
        requiredSkill: ANALYTICS_DASHBOARD_SKILL_KEY,
      });
    }

    const analyticsAssignedAgents = agents.filter((agent) => agentCanUseAnalyticsDashboard(agent, 'canViewAnalytics', workspace.subTier));
    const isActive = analyticsAssignedAgents.length > 0;

    if (requireActive && !isActive) {
      throw analyticsError(
        403,
        'Skill Analytics Dashboard sudah terinstall, tetapi belum aktif. Assign skill ini ke minimal satu agent Approval Required untuk menampilkan widget analytics.',
        { requiredSkill: ANALYTICS_DASHBOARD_SKILL_KEY },
      );
    }

    return {
      workspace,
      runtime,
      agents,
      installedSkills,
      isInstalled: true,
      isActive,
      assignedCount: analyticsAssignedAgents.length,
      assignedAgents: analyticsAssignedAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        accessMode: agent.accessMode,
        capabilities: getAnalyticsDashboardAgentConfig(agent),
      })),
      skillStatus: buildAnalyticsSkillStatus({
        isInstalled: true,
        isActive,
        assignedCount: analyticsAssignedAgents.length,
        assignedAgents: analyticsAssignedAgents,
      }, usageCount),
      tierAccess: serializeAnalyticsTierAccess(workspace.subTier),
      capabilityCoverage: buildCapabilityCoverage(analyticsAssignedAgents, workspace.subTier),
    };
  } catch (error) {
    if (error instanceof AnalyticsDashboardServiceError) {
      throw error;
    }

    throw analyticsError(502, 'Gagal memverifikasi skill Analytics Dashboard di runtime workspace.');
  }
}

function buildMessagesByConversation(messages = []) {
  const grouped = new Map();

  for (const message of messages) {
    const current = grouped.get(message.conversationId) || [];
    current.push(message);
    grouped.set(message.conversationId, current);
  }

  return grouped;
}

function buildFirstResponseMetrics(conversations = [], messages = []) {
  const messagesByConversation = buildMessagesByConversation(messages);
  const responseMap = new Map();

  for (const conversation of conversations) {
    const timeline = messagesByConversation.get(conversation.id) || [];
    let firstCustomerAt = null;
    let firstResponseAt = null;

    for (const message of timeline) {
      if (!firstCustomerAt && message.role === 'CUSTOMER') {
        firstCustomerAt = coerceDate(message.sentAt);
        continue;
      }

      if (firstCustomerAt && !firstResponseAt && ['AI', 'ADMIN'].includes(message.role)) {
        firstResponseAt = coerceDate(message.sentAt);
        break;
      }
    }

    if (!firstCustomerAt || !firstResponseAt || !conversation.agentId) continue;

    const diffMs = firstResponseAt.getTime() - firstCustomerAt.getTime();
    if (diffMs < 0) continue;

    const current = responseMap.get(conversation.agentId) || { totalMs: 0, count: 0 };
    current.totalMs += diffMs;
    current.count += 1;
    responseMap.set(conversation.agentId, current);
  }

  return responseMap;
}

function buildAgentPerformanceSummary({ access, conversations, messages, appointments, reminders, campaigns, recipients, crmEntries }) {
  const agentsById = buildAgentMap(access.agents);
  const metrics = new Map();
  const responseMetrics = buildFirstResponseMetrics(conversations, messages);

  for (const agent of access.agents) {
    metrics.set(agent.id, {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      accessMode: agent.accessMode,
      assignedSkills: getAgentAssignedSkills(agent),
      totalConversationsHandled: 0,
      totalBroadcastsSent: 0,
      totalBroadcastsDelivered: 0,
      totalAppointmentsHandled: 0,
      totalAppointmentsCompleted: 0,
      totalRemindersSent: 0,
      totalCustomersHandled: 0,
      totalWonLeads: 0,
      totalClosedLeads: 0,
      averageResponseTimeMinutes: null,
      mostAssignedSkill: getAgentAssignedSkills(agent)[0] || null,
      _customerIds: new Set(),
    });
  }

  for (const conversation of conversations) {
    const metric = metrics.get(conversation.agentId);
    if (!metric) continue;
    metric.totalConversationsHandled += 1;
    metric._customerIds.add(conversation.customerId);
  }

  for (const appointment of appointments) {
    const metric = metrics.get(appointment.agentId);
    if (!metric) continue;
    metric.totalAppointmentsHandled += 1;
    if (appointment.status === 'COMPLETED') {
      metric.totalAppointmentsCompleted += 1;
    }
    metric._customerIds.add(appointment.customerId);
  }

  for (const reminder of reminders) {
    const metric = metrics.get(reminder.agentId);
    if (!metric) continue;
    if (reminder.sentAt) {
      metric.totalRemindersSent += 1;
    }
    metric._customerIds.add(reminder.customerId);
  }

  for (const campaign of campaigns) {
    const metric = metrics.get(campaign.assignedAgentId);
    if (!metric) continue;
    metric.totalBroadcastsSent += decimalToNumber(campaign.totalSent, 0);
    metric.totalBroadcastsDelivered += decimalToNumber(campaign.totalDelivered, 0);
  }

  for (const recipient of recipients) {
    const metric = metrics.get(recipient.campaign?.assignedAgentId);
    if (!metric) continue;
    metric._customerIds.add(recipient.customerId);
  }

  for (const entry of crmEntries) {
    const metric = metrics.get(entry.assignedAgentId);
    if (!metric) continue;
    metric._customerIds.add(entry.customerId);
    if (entry.stage?.isClosedWon) {
      metric.totalWonLeads += 1;
      metric.totalClosedLeads += 1;
    } else if (entry.stage?.isClosedLost) {
      metric.totalClosedLeads += 1;
    }
  }

  const rankedAgents = [...metrics.values()]
    .map((metric) => {
      const response = responseMetrics.get(metric.id);
      const averageResponseTimeMinutes = response?.count
        ? roundNumber((response.totalMs / response.count) / 60_000, 1)
        : null;
      const totalCustomersHandled = metric._customerIds.size;
      const leadConversionRate = safePercent(metric.totalWonLeads, metric.totalClosedLeads);
      const performanceScore = roundNumber(
        (leadConversionRate * 2)
        + metric.totalAppointmentsCompleted
        + (metric.totalBroadcastsDelivered * 0.05)
        + metric.totalConversationsHandled,
        2,
      );
      const activityScore = roundNumber(
        metric.totalConversationsHandled
        + (metric.totalAppointmentsHandled * 2)
        + metric.totalRemindersSent
        + (metric.totalBroadcastsSent * 0.05),
        2,
      );

      return {
        id: metric.id,
        name: metric.name,
        status: metric.status,
        accessMode: metric.accessMode,
        assignedSkills: metric.assignedSkills,
        mostAssignedSkill: metric.mostAssignedSkill,
        totalConversationsHandled: metric.totalConversationsHandled,
        totalBroadcastsSent: metric.totalBroadcastsSent,
        totalBroadcastsDelivered: metric.totalBroadcastsDelivered,
        totalAppointmentsHandled: metric.totalAppointmentsHandled,
        totalAppointmentsCompleted: metric.totalAppointmentsCompleted,
        totalRemindersSent: metric.totalRemindersSent,
        totalCustomersHandled,
        totalWonLeads: metric.totalWonLeads,
        leadConversionRate,
        averageResponseTimeMinutes,
        performanceScore,
        activityScore,
      };
    })
    .filter((metric) => {
      const agent = agentsById.get(metric.id);
      if (!agent) return false;
      return metric.totalConversationsHandled
        || metric.totalBroadcastsSent
        || metric.totalAppointmentsHandled
        || metric.totalRemindersSent
        || metric.totalCustomersHandled
        || agent.status === 'ACTIVE';
    });

  const topPerformingAgent = [...rankedAgents]
    .sort((left, right) => right.performanceScore - left.performanceScore || right.totalCustomersHandled - left.totalCustomersHandled)[0] || null;
  const mostActiveAgent = [...rankedAgents]
    .sort((left, right) => right.activityScore - left.activityScore || right.totalConversationsHandled - left.totalConversationsHandled)[0] || null;

  return {
    agents: [...rankedAgents]
      .sort((left, right) => right.performanceScore - left.performanceScore || right.activityScore - left.activityScore)
      .slice(0, TOP_LIST_LIMIT),
    topPerformingAgent,
    mostActiveAgent,
  };
}

function buildSkillUsageSummary({ access, campaigns, appointments, reminders, crmEntries, crmActivities, tradeAudits, autopilotRuns }) {
  const analyticsUsageCount = decimalToNumber(access.skillStatus?.usageCount, 0);
  const usageBySkill = {
    'analytics-dashboard': analyticsUsageCount,
    'appointment-scheduler': appointments.length,
    'broadcast-campaign': campaigns.length + campaigns.reduce((sum, campaign) => sum + decimalToNumber(campaign.totalSent, 0), 0),
    'crm-pipeline': crmEntries.length + crmActivities.length,
    'payment-reminder': reminders.length,
    'polymarket-read-only': tradeAudits.length,
    'polymarket-growth-autopilot': autopilotRuns.length,
  };

  const skillItems = buildKnownSkillList(access.installedSkills)
    .map((skill) => ({
      ...skill,
      totalInstalls: skill.installed ? 1 : 0,
      totalActiveAgents: skill.assignedCount,
      totalUsage: decimalToNumber(usageBySkill[skill.skillKey], 0),
      score: decimalToNumber(usageBySkill[skill.skillKey], 0) + (skill.assignedCount * 10),
    }))
    .sort((left, right) => right.totalUsage - left.totalUsage || right.totalActiveAgents - left.totalActiveAgents);

  const mostUsedSkill = skillItems[0] || null;
  const leastUsedSkill = [...skillItems]
    .filter((skill) => skill.installed || skill.totalUsage > 0)
    .sort((left, right) => left.totalUsage - right.totalUsage || left.totalActiveAgents - right.totalActiveAgents)[0] || null;
  const topPerformingSkill = [...skillItems].sort((left, right) => right.score - left.score)[0] || null;

  const topBroadcastCampaign = [...campaigns]
    .sort((left, right) => decimalToNumber(right.totalDelivered, 0) - decimalToNumber(left.totalDelivered, 0))[0] || null;
  const topAppointmentSchedulerUsage = (() => {
    const counts = new Map();
    for (const appointment of appointments) {
      counts.set(appointment.agentId, (counts.get(appointment.agentId) || 0) + 1);
    }
    const [agentId, count] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0] || [];
    if (!agentId) return null;
    const agent = access.agents.find((row) => row.id === agentId);
    return agent ? { id: agent.id, name: agent.name, count } : null;
  })();
  const topCrmPipelineUsage = (() => {
    const counts = new Map();
    for (const entry of crmEntries) {
      const current = counts.get(entry.pipelineId) || { id: entry.pipelineId, name: entry.pipeline?.name || 'Pipeline', count: 0 };
      current.count += 1;
      counts.set(entry.pipelineId, current);
    }
    return [...counts.values()].sort((left, right) => right.count - left.count)[0] || null;
  })();
  const topPaymentReminderUsage = (() => {
    const counts = new Map();
    for (const reminder of reminders) {
      counts.set(reminder.type, (counts.get(reminder.type) || 0) + 1);
    }
    const [type, count] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0] || [];
    return type ? { type, count } : null;
  })();

  return {
    skills: skillItems.slice(0, TOP_LIST_LIMIT),
    mostUsedSkill,
    leastUsedSkill,
    topPerformingSkill,
    topBroadcastCampaign: topBroadcastCampaign
      ? {
        id: topBroadcastCampaign.id,
        title: topBroadcastCampaign.title,
        totalDelivered: decimalToNumber(topBroadcastCampaign.totalDelivered, 0),
        totalSent: decimalToNumber(topBroadcastCampaign.totalSent, 0),
      }
      : null,
    topAppointmentSchedulerUsage,
    topCrmPipelineUsage,
    topPaymentReminderUsage,
  };
}

function buildCrmStageSummary(crmEntries = []) {
  const stageMap = new Map();

  for (const entry of crmEntries) {
    const stageId = entry.stageId || entry.stage?.id;
    if (!stageId) continue;
    const current = stageMap.get(stageId) || {
      stageId,
      label: entry.stage?.name || 'Unknown Stage',
      position: decimalToNumber(entry.stage?.position, 999),
      pipelineId: entry.pipelineId,
      pipelineName: entry.pipeline?.name || 'Pipeline',
      totalLeads: 0,
      totalValue: 0,
      wonCount: 0,
      lostCount: 0,
      color: entry.stage?.color || null,
    };
    current.totalLeads += 1;
    current.totalValue += decimalToNumber(entry.valueAmount, 0);
    if (entry.stage?.isClosedWon) current.wonCount += 1;
    if (entry.stage?.isClosedLost) current.lostCount += 1;
    stageMap.set(stageId, current);
  }

  const totalLeads = [...stageMap.values()].reduce((sum, stage) => sum + stage.totalLeads, 0);

  return [...stageMap.values()]
    .map((stage) => ({
      ...stage,
      share: safePercent(stage.totalLeads, totalLeads),
    }))
    .sort((left, right) => right.totalLeads - left.totalLeads || left.position - right.position)
    .slice(0, TOP_LIST_LIMIT);
}

function buildRevenueSummary({ crmEntries, transactions, rangeStart, rangeEnd }) {
  let weightedPipelineValue = 0;
  let closedWonRevenue = 0;

  const revenueBuckets = buildDayBuckets(rangeStart, rangeEnd).map((bucket) => ({
    ...bucket,
    weightedPipeline: 0,
    closedWon: 0,
    paidRevenue: 0,
  }));
  const revenueBucketIndex = createBucketIndex(revenueBuckets);

  for (const entry of crmEntries) {
    const entryValue = decimalToNumber(entry.valueAmount, 0);
    if (!entryValue) continue;

    if (entry.stage?.isClosedWon) {
      closedWonRevenue += entryValue;
      incrementBucket(revenueBucketIndex, entry.updatedAt || entry.createdAt, 'closedWon', entryValue);
      continue;
    }

    if (!entry.stage?.isClosedLost) {
      const weightedValue = entryValue * safeDivide(decimalToNumber(entry.stage?.probabilityPercent, 0), 100);
      weightedPipelineValue += weightedValue;
      incrementBucket(revenueBucketIndex, entry.createdAt, 'weightedPipeline', weightedValue);
    }
  }

  const paidRevenue = transactions
    .filter((transaction) => transaction.status === 'PAID')
    .reduce((sum, transaction) => {
      incrementBucket(revenueBucketIndex, transaction.paidAt || transaction.createdAt, 'paidRevenue', decimalToNumber(transaction.amount, 0));
      return sum + decimalToNumber(transaction.amount, 0);
    }, 0);

  const trend = revenueBuckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    weightedPipeline: roundNumber(bucket.weightedPipeline, 2),
    closedWon: roundNumber(bucket.closedWon, 2),
    paidRevenue: roundNumber(bucket.paidRevenue, 2),
    estimatedRevenue: roundNumber(bucket.weightedPipeline + bucket.closedWon + bucket.paidRevenue, 2),
  }));

  return {
    weightedPipelineValue: roundNumber(weightedPipelineValue, 2),
    closedWonRevenue: roundNumber(closedWonRevenue, 2),
    paidRevenue: roundNumber(paidRevenue, 2),
    estimatedRevenue: roundNumber(weightedPipelineValue + closedWonRevenue + paidRevenue, 2),
    trend,
  };
}

function buildLeadConversionSummary({ crmEntries, leads }) {
  const wonCount = crmEntries.filter((entry) => entry.stage?.isClosedWon).length;
  const lostCount = crmEntries.filter((entry) => entry.stage?.isClosedLost).length;
  const closedCount = wonCount + lostCount;
  const totalLeads = Math.max(leads.length, crmEntries.length);

  return {
    totalLeads,
    wonLeads: wonCount,
    lostLeads: lostCount,
    closedLeads: closedCount,
    conversionRate: safePercent(wonCount, closedCount),
    conversionFromAllLeads: safePercent(wonCount, totalLeads),
  };
}

function buildBroadcastPerformanceSummary({ campaigns, recipients }) {
  const totalCampaigns = campaigns.length;
  const totalSent = recipients.filter((recipient) => recipient.sentAt).length;
  const totalDelivered = recipients.filter((recipient) => recipient.deliveredAt).length;
  const totalFailed = recipients.filter((recipient) => recipient.failedAt || recipient.recipientStatus === 'FAILED').length;
  const channelBreakdown = new Map();

  for (const campaign of campaigns) {
    const key = campaign.channelType || 'UNKNOWN';
    const current = channelBreakdown.get(key) || { channelType: key, campaigns: 0, totalSent: 0, totalDelivered: 0 };
    current.campaigns += 1;
    current.totalSent += decimalToNumber(campaign.totalSent, 0);
    current.totalDelivered += decimalToNumber(campaign.totalDelivered, 0);
    channelBreakdown.set(key, current);
  }

  return {
    totalCampaigns,
    totalSent,
    totalDelivered,
    totalFailed,
    deliveryRate: safePercent(totalDelivered, totalSent),
    failureRate: safePercent(totalFailed, totalSent),
    channelBreakdown: [...channelBreakdown.values()].sort((left, right) => right.totalDelivered - left.totalDelivered),
  };
}

function buildAppointmentPerformanceSummary(appointments = []) {
  const totalCreated = appointments.length;
  const completed = appointments.filter((appointment) => appointment.status === 'COMPLETED').length;
  const missed = appointments.filter((appointment) => appointment.status === 'MISSED').length;
  const cancelled = appointments.filter((appointment) => appointment.status === 'CANCELLED').length;
  const scheduled = appointments.filter((appointment) => ['PENDING', 'CONFIRMED', 'RESCHEDULED'].includes(appointment.status)).length;

  return {
    totalCreated,
    completed,
    missed,
    cancelled,
    scheduled,
    completionRate: safePercent(completed, totalCreated),
    missedRate: safePercent(missed, totalCreated),
  };
}

function buildPaymentPerformanceSummary(reminders = []) {
  const totalCreated = reminders.length;
  const sent = reminders.filter((reminder) => reminder.sentAt || reminder.status === 'SENT').length;
  const failed = reminders.filter((reminder) => reminder.failedAt || reminder.status === 'FAILED').length;
  const scheduled = reminders.filter((reminder) => reminder.status === 'SCHEDULED').length;
  const pending = reminders.filter((reminder) => reminder.status === 'PENDING').length;
  const byType = new Map();

  for (const reminder of reminders) {
    const current = byType.get(reminder.type) || { type: reminder.type, count: 0, sent: 0, failed: 0 };
    current.count += 1;
    if (reminder.sentAt || reminder.status === 'SENT') current.sent += 1;
    if (reminder.failedAt || reminder.status === 'FAILED') current.failed += 1;
    byType.set(reminder.type, current);
  }

  return {
    totalCreated,
    sent,
    failed,
    scheduled,
    pending,
    sendRate: safePercent(sent, totalCreated),
    failureRate: safePercent(failed, totalCreated),
    byType: [...byType.values()].sort((left, right) => right.count - left.count),
  };
}

function buildRecentActivity({ access, filters, conversations, customers, appointments, appointmentLogs, reminders, crmActivities, campaigns, installedSkills }) {
  const agentMap = buildAgentMap(access.agents);
  const activities = [];

  for (const customer of customers) {
    activities.push({
      id: `customer-created:${customer.id}`,
      occurredAt: customer.createdAt,
      activityType: 'customer-created',
      skillType: null,
      agentId: null,
      agentName: null,
      title: 'Customer baru dibuat',
      description: customer.name ? `${customer.name} masuk ke workspace.` : `Customer ${customer.phoneNumber} masuk ke workspace.`,
    });
  }

  for (const activity of crmActivities.filter((row) => row.type === 'STAGE_CHANGED')) {
    const agent = agentMap.get(activity.customerPipelineEntry?.assignedAgentId);
    activities.push({
      id: `crm-stage:${activity.id}`,
      occurredAt: activity.createdAt,
      activityType: 'lead-stage-changed',
      skillType: 'crm-pipeline',
      agentId: agent?.id || null,
      agentName: agent?.name || null,
      title: 'Lead berpindah stage',
      description: `${activity.customerPipelineEntry?.title || 'Lead'} dari ${activity.previousStage?.name || 'stage sebelumnya'} ke ${activity.newStage?.name || 'stage baru'}.`,
    });
  }

  for (const appointment of appointments) {
    const agent = agentMap.get(appointment.agentId);
    activities.push({
      id: `appointment-created:${appointment.id}`,
      occurredAt: appointment.createdAt,
      activityType: 'appointment-created',
      skillType: 'appointment-scheduler',
      agentId: agent?.id || null,
      agentName: agent?.name || null,
      title: 'Appointment dibuat',
      description: `${appointment.title} dijadwalkan untuk workflow appointment.`,
    });
  }

  for (const log of appointmentLogs.filter((row) => row.actionType === APPOINTMENT_ACTIVITY_ACTIONS.MARKED_MISSED)) {
    const agent = agentMap.get(log.appointment?.agentId);
    activities.push({
      id: `appointment-missed:${log.id}`,
      occurredAt: log.createdAt,
      activityType: 'appointment-missed',
      skillType: 'appointment-scheduler',
      agentId: agent?.id || null,
      agentName: agent?.name || null,
      title: 'Appointment missed',
      description: `${log.appointment?.title || 'Appointment'} ditandai sebagai missed.`,
    });
  }

  for (const reminder of reminders.filter((row) => row.sentAt)) {
    const agent = agentMap.get(reminder.agentId);
    activities.push({
      id: `payment-reminder-sent:${reminder.id}`,
      occurredAt: reminder.sentAt,
      activityType: 'payment-reminder-sent',
      skillType: 'payment-reminder',
      agentId: agent?.id || null,
      agentName: agent?.name || null,
      title: 'Payment reminder terkirim',
      description: `${reminder.title || reminder.type} berhasil dikirim.`,
    });
  }

  for (const campaign of campaigns.filter((row) => row.startedAt)) {
    const agent = agentMap.get(campaign.assignedAgentId);
    activities.push({
      id: `broadcast-sent:${campaign.id}`,
      occurredAt: campaign.startedAt,
      activityType: 'broadcast-campaign-sent',
      skillType: 'broadcast-campaign',
      agentId: agent?.id || null,
      agentName: agent?.name || null,
      title: 'Broadcast campaign berjalan',
      description: `${campaign.title} mulai dikirim ke audience workspace.`,
    });
  }

  for (const campaign of campaigns.filter((row) => row.completedAt && decimalToNumber(row.totalDelivered, 0) > 0)) {
    const agent = agentMap.get(campaign.assignedAgentId);
    activities.push({
      id: `broadcast-delivered:${campaign.id}`,
      occurredAt: campaign.completedAt,
      activityType: 'broadcast-campaign-delivered',
      skillType: 'broadcast-campaign',
      agentId: agent?.id || null,
      agentName: agent?.name || null,
      title: 'Broadcast campaign selesai',
      description: `${campaign.title} selesai dengan ${decimalToNumber(campaign.totalDelivered, 0)} delivery.`,
    });
  }

  for (const campaign of campaigns.filter((row) => decimalToNumber(row.totalFailed, 0) > 0 || row.status === 'FAILED')) {
    const agent = agentMap.get(campaign.assignedAgentId);
    activities.push({
      id: `broadcast-failed:${campaign.id}`,
      occurredAt: campaign.updatedAt,
      activityType: 'broadcast-campaign-failed',
      skillType: 'broadcast-campaign',
      agentId: agent?.id || null,
      agentName: agent?.name || null,
      title: 'Broadcast campaign mengalami kegagalan',
      description: `${campaign.title} memiliki ${decimalToNumber(campaign.totalFailed, 0)} recipient gagal.`,
    });
  }

  for (const skill of installedSkills.filter((row) => isWithinRange(row.installedAt, filters.rangeStart, filters.rangeEnd))) {
    activities.push({
      id: `skill-installed:${skill.skillKey}`,
      occurredAt: skill.installedAt,
      activityType: 'skill-installed',
      skillType: skill.skillKey,
      agentId: null,
      agentName: null,
      title: 'Skill baru diinstall',
      description: `${skill.displayName || skill.skillKey} tersedia untuk workspace ini.`,
    });
  }

  for (const agent of access.agents.filter((row) => isWithinRange(row.updatedAt, filters.rangeStart, filters.rangeEnd))) {
    for (const skillKey of getAgentAssignedSkills(agent)) {
      activities.push({
        id: `agent-skill:${agent.id}:${skillKey}`,
        occurredAt: agent.updatedAt,
        activityType: 'agent-assigned-skill',
        skillType: skillKey,
        agentId: agent.id,
        agentName: agent.name,
        title: 'Agent diassign ke skill',
        description: `${agent.name} kini memakai skill ${KNOWN_SKILL_METADATA[skillKey]?.displayName || skillKey}.`,
      });
    }
  }

  for (const conversation of conversations) {
    const agent = agentMap.get(conversation.agentId);
    activities.push({
      id: `conversation-started:${conversation.id}`,
      occurredAt: conversation.startedAt,
      activityType: 'conversation-started',
      skillType: null,
      agentId: agent?.id || null,
      agentName: agent?.name || null,
      title: 'Percakapan baru dimulai',
      description: `${agent?.name || 'Agent'} memulai percakapan baru dengan customer.`,
    });
  }

  return activities
    .filter((activity) => !filters.activityType || activity.activityType === filters.activityType)
    .filter((activity) => !filters.skillType || activity.skillType === filters.skillType)
    .filter((activity) => !filters.agentId || activity.agentId === filters.agentId)
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime())
    .slice(0, MAX_ACTIVITY_ITEMS);
}

function buildCharts({ rangeStart, rangeEnd, conversations, customers, leads, recipients, appointments, reminders, crmEntries, stageSummary, revenueSummary, agentPerformance, skillUsage, tradeAudits, autopilotRuns, snapshotRows = [] }) {
  const buckets = buildDayBuckets(rangeStart, rangeEnd).map((bucket) => ({
    ...bucket,
    conversations: 0,
    newCustomers: 0,
    totalCustomers: 0,
    newLeads: 0,
    totalLeads: 0,
    broadcastSent: 0,
    broadcastDelivered: 0,
    appointmentCreated: 0,
    appointmentCompleted: 0,
    paymentReminder: 0,
    appointmentScheduler: 0,
    crmPipeline: 0,
    broadcastCampaign: 0,
    polymarketReadOnly: 0,
    polymarketGrowthAutopilot: 0,
    analyticsDashboard: 0,
  }));
  const index = createBucketIndex(buckets);

  for (const conversation of conversations) {
    incrementBucket(index, conversation.startedAt, 'conversations', 1);
  }

  for (const customer of customers) {
    incrementBucket(index, customer.createdAt, 'newCustomers', 1);
  }

  for (const lead of leads) {
    incrementBucket(index, lead.createdAt, 'newLeads', 1);
  }

  for (const recipient of recipients) {
    incrementBucket(index, recipient.sentAt, 'broadcastSent', 1);
    incrementBucket(index, recipient.deliveredAt, 'broadcastDelivered', 1);
  }

  for (const appointment of appointments) {
    incrementBucket(index, appointment.createdAt, 'appointmentCreated', 1);
    incrementBucket(index, appointment.completedAt, 'appointmentCompleted', 1);
    incrementBucket(index, appointment.createdAt, 'appointmentScheduler', 1);
  }

  for (const reminder of reminders) {
    incrementBucket(index, reminder.createdAt, 'paymentReminder', 1);
  }

  for (const entry of crmEntries) {
    incrementBucket(index, entry.createdAt, 'crmPipeline', 1);
  }

  for (const row of snapshotRows) {
    incrementBucket(index, row.createdAt, 'analyticsDashboard', 1);
  }

  for (const audit of tradeAudits) {
    incrementBucket(index, audit.createdAt, 'polymarketReadOnly', 1);
  }

  for (const run of autopilotRuns) {
    incrementBucket(index, run.startedAt, 'polymarketGrowthAutopilot', 1);
  }

  buckets.forEach((bucket) => {
    bucket.broadcastCampaign = bucket.broadcastSent;
  });

  let customerRunningTotal = 0;
  let leadRunningTotal = 0;

  const customerGrowth = buckets.map((bucket) => {
    customerRunningTotal += bucket.newCustomers;
    return {
      key: bucket.key,
      label: bucket.label,
      value: customerRunningTotal,
      newValue: bucket.newCustomers,
    };
  });

  const leadGrowth = buckets.map((bucket) => {
    leadRunningTotal += bucket.newLeads;
    return {
      key: bucket.key,
      label: bucket.label,
      value: leadRunningTotal,
      newValue: bucket.newLeads,
    };
  });

  return {
    conversationTrend: buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.conversations })),
    customerGrowth,
    leadGrowth,
    broadcastSentVsDelivered: buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      sent: bucket.broadcastSent,
      delivered: bucket.broadcastDelivered,
    })),
    appointmentCreatedVsCompleted: buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      created: bucket.appointmentCreated,
      completed: bucket.appointmentCompleted,
    })),
    crmStageDistribution: stageSummary.map((stage) => ({ label: stage.label, value: stage.totalLeads, color: stage.color || null })),
    topPerformingAgents: (agentPerformance.agents || []).slice(0, 6).map((agent) => ({
      label: agent.name,
      value: agent.performanceScore,
      secondaryValue: agent.totalConversationsHandled,
    })),
    topUsedSkills: (skillUsage.skills || []).slice(0, 6).map((skill) => ({
      label: skill.displayName,
      value: skill.totalUsage,
      secondaryValue: skill.totalActiveAgents,
    })),
    revenueEstimateTrend: revenueSummary.trend,
    usageTrendBySkill: buckets.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      paymentReminder: bucket.paymentReminder,
      appointmentScheduler: bucket.appointmentScheduler,
      crmPipeline: bucket.crmPipeline,
      broadcastCampaign: bucket.broadcastCampaign,
      polymarketReadOnly: bucket.polymarketReadOnly,
      polymarketGrowthAutopilot: bucket.polymarketGrowthAutopilot,
      analyticsDashboard: bucket.analyticsDashboard,
    })),
  };
}

function buildWorkspaceSummary({ access, relatedCustomerIds, campaigns, reminders }) {
  return {
    workspaceId: access.workspace.id,
    workspaceName: access.workspace.name,
    subscriptionTier: access.workspace.subTier,
    subscriptionStatus: access.workspace.subStatus,
    activeAgentCount: access.agents.filter((agent) => agent.status === 'ACTIVE').length,
    activeSkillCount: access.installedSkills.filter((skill) => Number(skill.assignedCount || 0) > 0).length,
    installedSkillCount: access.installedSkills.length,
    analyticsUsageCount: decimalToNumber(access.skillStatus?.usageCount, 0),
    trackedCustomerCount: relatedCustomerIds.size,
    campaignCount: campaigns.length,
    paymentReminderCount: reminders.length,
  };
}

function applySkillTypeScope(dataset, skillType) {
  if (!skillType) return dataset;

  const emptyDataset = {
    conversations: [],
    messages: [],
    appointments: [],
    appointmentLogs: [],
    reminders: [],
    crmEntries: [],
    crmActivities: [],
    campaigns: [],
    recipients: [],
    customers: [],
    leads: [],
    transactions: [],
    tradeAudits: [],
    autopilotRuns: [],
    snapshotRows: [],
  };

  if (skillType === 'crm-pipeline') {
    return {
      ...emptyDataset,
      crmEntries: dataset.crmEntries,
      crmActivities: dataset.crmActivities,
      customers: dataset.customers,
      leads: dataset.leads,
    };
  }

  if (skillType === 'broadcast-campaign') {
    return {
      ...emptyDataset,
      campaigns: dataset.campaigns,
      recipients: dataset.recipients,
      customers: dataset.customers,
    };
  }

  if (skillType === 'appointment-scheduler') {
    return {
      ...emptyDataset,
      appointments: dataset.appointments,
      appointmentLogs: dataset.appointmentLogs,
      customers: dataset.customers,
    };
  }

  if (skillType === 'payment-reminder') {
    return {
      ...emptyDataset,
      reminders: dataset.reminders,
      customers: dataset.customers,
      transactions: dataset.transactions,
    };
  }

  if (skillType === 'polymarket-read-only') {
    return {
      ...emptyDataset,
      tradeAudits: dataset.tradeAudits,
    };
  }

  if (skillType === 'polymarket-growth-autopilot') {
    return {
      ...emptyDataset,
      autopilotRuns: dataset.autopilotRuns,
    };
  }

  if (skillType === 'analytics-dashboard') {
    return {
      ...emptyDataset,
      snapshotRows: dataset.snapshotRows,
    };
  }

  return dataset;
}

async function loadAnalyticsDataset(access, filters) {
  const [
    conversations,
    appointments,
    appointmentLogs,
    reminders,
    crmEntries,
    crmActivities,
    campaigns,
    recipients,
    customers,
    leads,
    transactions,
    tradeAudits,
    autopilotRuns,
    snapshotRows,
  ] = await Promise.all([
    prisma.conversation.findMany({
      where: buildConversationWhere(access.workspace.id, filters),
      select: {
        id: true,
        agentId: true,
        customerId: true,
        status: true,
        startedAt: true,
        createdAt: true,
      },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.appointmentSchedule.findMany({
      where: buildAppointmentWhere(access.workspace.id, filters),
      select: {
        id: true,
        agentId: true,
        customerId: true,
        title: true,
        status: true,
        scheduledAt: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.appointmentActivityLog.findMany({
      where: {
        workspaceId: access.workspace.id,
        createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd },
        ...(filters.agentId ? { appointment: { agentId: filters.agentId } } : {}),
      },
      select: {
        id: true,
        actionType: true,
        createdAt: true,
        appointment: {
          select: {
            id: true,
            title: true,
            agentId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.paymentReminder.findMany({
      where: buildReminderWhere(access.workspace.id, filters),
      select: {
        id: true,
        workspaceId: true,
        agentId: true,
        customerId: true,
        title: true,
        type: true,
        status: true,
        amount: true,
        currency: true,
        dueDate: true,
        createdAt: true,
        sentAt: true,
        failedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.crmCustomerPipelineEntry.findMany({
      where: buildCrmEntryWhere(access.workspace.id, filters),
      select: {
        id: true,
        customerId: true,
        pipelineId: true,
        stageId: true,
        assignedAgentId: true,
        title: true,
        valueAmount: true,
        currency: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        lastActivityAt: true,
        pipeline: {
          select: {
            id: true,
            name: true,
          },
        },
        stage: {
          select: {
            id: true,
            name: true,
            color: true,
            position: true,
            probabilityPercent: true,
            isClosedWon: true,
            isClosedLost: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.crmPipelineActivity.findMany({
      where: buildCrmActivityWhere(access.workspace.id, filters),
      select: {
        id: true,
        type: true,
        createdAt: true,
        customerPipelineEntry: {
          select: {
            id: true,
            title: true,
            customerId: true,
            assignedAgentId: true,
          },
        },
        previousStage: {
          select: {
            id: true,
            name: true,
          },
        },
        newStage: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.broadcastCampaign.findMany({
      where: buildCampaignWhere(access.workspace.id, filters),
      select: {
        id: true,
        assignedAgentId: true,
        title: true,
        channelType: true,
        status: true,
        totalAudience: true,
        totalSent: true,
        totalDelivered: true,
        totalFailed: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.broadcastCampaignRecipient.findMany({
      where: buildRecipientWhere(access.workspace.id, filters),
      select: {
        id: true,
        customerId: true,
        campaignId: true,
        recipientStatus: true,
        createdAt: true,
        sentAt: true,
        deliveredAt: true,
        failedAt: true,
        campaign: {
          select: {
            assignedAgentId: true,
            title: true,
            channelType: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.customer.findMany({
      where: {
        workspaceId: access.workspace.id,
        createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd },
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.lead.findMany({
      where: {
        workspaceId: access.workspace.id,
        createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd },
      },
      select: {
        id: true,
        customerId: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.transaction.findMany({
      where: buildTransactionWhere(access.workspace.id, filters),
      select: {
        id: true,
        type: true,
        amount: true,
        status: true,
        paidAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.polymarketTradeAudit.findMany({
      where: {
        workspaceId: access.workspace.id,
        createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd },
      },
      select: {
        id: true,
        action: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.polymarketAutopilotRun.findMany({
      where: {
        workspaceId: access.workspace.id,
        startedAt: { gte: filters.rangeStart, lte: filters.rangeEnd },
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        finishedAt: true,
      },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.analyticsMetricSnapshot.findMany({
      where: {
        workspaceId: access.workspace.id,
        createdAt: { gte: filters.rangeStart, lte: filters.rangeEnd },
      },
      select: {
        id: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const conversationIds = conversations.map((conversation) => conversation.id);
  const messages = conversationIds.length > 0
    ? await prisma.message.findMany({
      where: { conversationId: { in: conversationIds } },
      select: {
        conversationId: true,
        role: true,
        sentAt: true,
      },
      orderBy: [{ conversationId: 'asc' }, { sentAt: 'asc' }],
    })
    : [];

  return {
    conversations,
    messages,
    appointments,
    appointmentLogs,
    reminders,
    crmEntries,
    crmActivities,
    campaigns,
    recipients,
    customers,
    leads,
    transactions,
    tradeAudits,
    autopilotRuns,
    snapshotRows,
  };
}

function buildKpiSummary({ access, filters, relatedCustomerIds, customers, leads, conversations, appointments, reminders, crmEntries, campaigns, recipients }) {
  const totalCustomers = filters.agentId ? relatedCustomerIds.size : customers.length;
  const filteredLeads = filters.agentId
    ? leads.filter((lead) => relatedCustomerIds.has(lead.customerId))
    : leads;
  const openPipelineValue = crmEntries
    .filter((entry) => !entry.isArchived && !entry.stage?.isClosedWon && !entry.stage?.isClosedLost)
    .reduce((sum, entry) => sum + decimalToNumber(entry.valueAmount, 0), 0);

  return {
    totalConversations: conversations.length,
    totalCustomers,
    totalLeads: filteredLeads.length,
    totalAppointments: appointments.length,
    totalReminders: reminders.length,
    totalBroadcasts: recipients.filter((recipient) => recipient.sentAt).length,
    totalDeliveredBroadcasts: recipients.filter((recipient) => recipient.deliveredAt).length,
    totalFailedBroadcasts: recipients.filter((recipient) => recipient.failedAt || recipient.recipientStatus === 'FAILED').length,
    totalCampaigns: campaigns.length,
    totalPipelineValue: roundNumber(openPipelineValue, 2),
    totalActiveAgents: access.agents.filter((agent) => agent.status === 'ACTIVE').length,
    totalActiveSkills: access.installedSkills.filter((skill) => Number(skill.assignedCount || 0) > 0).length,
  };
}

async function buildAnalyticsDashboardBundle({ access, filters }) {
  const rawDataset = await loadAnalyticsDataset(access, filters);
  const dataset = applySkillTypeScope(rawDataset, filters.skillType);
  const relatedCustomerIds = buildRelatedCustomerIds(dataset);
  const agentPerformance = buildAgentPerformanceSummary({ access, ...dataset });
  const stageSummary = buildCrmStageSummary(dataset.crmEntries.filter((entry) => !entry.isArchived));
  const revenueSummary = buildRevenueSummary({
    crmEntries: dataset.crmEntries.filter((entry) => !entry.isArchived),
    transactions: dataset.transactions,
    rangeStart: filters.rangeStart,
    rangeEnd: filters.rangeEnd,
  });
  const skillUsage = buildSkillUsageSummary({ access, ...dataset });
  const leadConversion = buildLeadConversionSummary({ crmEntries: dataset.crmEntries.filter((entry) => !entry.isArchived), leads: dataset.leads });
  const broadcastPerformance = buildBroadcastPerformanceSummary({ campaigns: dataset.campaigns, recipients: dataset.recipients });
  const appointmentPerformance = buildAppointmentPerformanceSummary(dataset.appointments);
  const paymentPerformance = buildPaymentPerformanceSummary(dataset.reminders);
  const charts = buildCharts({
    rangeStart: filters.rangeStart,
    rangeEnd: filters.rangeEnd,
    conversations: dataset.conversations,
    customers: dataset.customers,
    leads: dataset.leads,
    recipients: dataset.recipients,
    appointments: dataset.appointments,
    reminders: dataset.reminders,
    crmEntries: dataset.crmEntries.filter((entry) => !entry.isArchived),
    stageSummary,
    revenueSummary,
    agentPerformance,
    skillUsage,
    tradeAudits: dataset.tradeAudits,
    autopilotRuns: dataset.autopilotRuns,
    snapshotRows: dataset.snapshotRows,
  });
  const recentActivity = buildRecentActivity({
    access,
    filters,
    conversations: dataset.conversations,
    customers: dataset.customers,
    appointments: dataset.appointments,
    appointmentLogs: dataset.appointmentLogs,
    reminders: dataset.reminders,
    crmActivities: dataset.crmActivities,
    campaigns: dataset.campaigns,
    installedSkills: access.installedSkills,
  });
  const kpiSummary = buildKpiSummary({
    access,
    filters,
    relatedCustomerIds,
    customers: dataset.customers,
    leads: dataset.leads,
    conversations: dataset.conversations,
    appointments: dataset.appointments,
    reminders: dataset.reminders,
    crmEntries: dataset.crmEntries,
    campaigns: dataset.campaigns,
    recipients: dataset.recipients,
  });

  return {
    filters: serializeFilters(filters),
    skillStatus: access.skillStatus,
    tierAccess: access.tierAccess,
    capabilityCoverage: access.capabilityCoverage,
    workspaceSummary: buildWorkspaceSummary({
      access,
      relatedCustomerIds,
      campaigns: dataset.campaigns,
      reminders: dataset.reminders,
    }),
    summary: kpiSummary,
    charts,
    recentActivity,
    topAgents: agentPerformance,
    topSkills: skillUsage,
    topCrmStages: stageSummary,
    revenueEstimate: revenueSummary,
    leadConversion,
    broadcastPerformance,
    appointmentPerformance,
    paymentPerformance,
    emptyState: {
      hasData: Boolean(
        kpiSummary.totalConversations
        || kpiSummary.totalCustomers
        || kpiSummary.totalLeads
        || kpiSummary.totalAppointments
        || kpiSummary.totalReminders
        || kpiSummary.totalCampaigns
      ),
    },
  };
}

export async function getAnalyticsDashboardBundle({ ownerId, workspaceId, filters = {}, requireActive = true }) {
  const access = await assertAnalyticsDashboardAccess({ ownerId, workspaceId, requireActive });
  const resolvedFilters = resolveAnalyticsFilters(filters);
  const cacheWindow = buildCacheWindow(resolvedFilters.preset);
  const cacheRange = buildCacheRange(resolvedFilters.rangeStart, resolvedFilters.rangeEnd);
  const cacheKey = 'dashboard-bundle';

  const cached = await readDashboardCache({
    workspaceId: access.workspace.id,
    scopeKey: resolvedFilters.scopeKey,
    cacheKey,
    window: cacheWindow,
    rangeStart: cacheRange.rangeStart,
    rangeEnd: cacheRange.rangeEnd,
  });

  if (cached?.summaryJson) {
    return {
      ...cached.summaryJson,
      skillStatus: access.skillStatus,
      tierAccess: access.tierAccess,
      capabilityCoverage: access.capabilityCoverage,
      meta: normalizeBundleMeta({
        generatedAt: cached.summaryJson?.meta?.generatedAt || cached.updatedAt?.toISOString?.() || new Date().toISOString(),
        cache: { hit: true, updatedAt: cached.updatedAt?.toISOString?.() || null },
      }),
    };
  }

  const bundle = await buildAnalyticsDashboardBundle({ access, filters: resolvedFilters });
  const cachedRecord = await writeDashboardCache({
    workspaceId: access.workspace.id,
    agentId: resolvedFilters.agentId,
    scopeKey: resolvedFilters.scopeKey,
    cacheKey,
    skillType: resolvedFilters.skillType,
    window: cacheWindow,
    rangeStart: cacheRange.rangeStart,
    rangeEnd: cacheRange.rangeEnd,
    summaryJson: bundle,
  });

  return {
    ...bundle,
    meta: normalizeBundleMeta({
      generatedAt: new Date().toISOString(),
      cache: { hit: false, updatedAt: cachedRecord.updatedAt.toISOString() },
    }),
  };
}

export async function getAnalyticsStatus({ ownerId, workspaceId, filters = {} }) {
  const access = await assertAnalyticsDashboardAccess({ ownerId, workspaceId, requireActive: false });
  const resolvedFilters = resolveAnalyticsFilters(filters);

  return {
    filters: serializeFilters(resolvedFilters),
    skillStatus: access.skillStatus,
    tierAccess: access.tierAccess,
    capabilityCoverage: access.capabilityCoverage,
    workspaceSummary: buildWorkspaceSummary({
      access,
      relatedCustomerIds: new Set(),
      campaigns: [],
      reminders: [],
    }),
    availableAgents: access.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      accessMode: agent.accessMode,
      assignedSkills: getAgentAssignedSkills(agent),
    })),
    availableSkills: buildKnownSkillList(access.installedSkills),
    installedSkills: access.installedSkills,
    assignedAgents: access.assignedAgents,
  };
}

export async function upsertAnalyticsSnapshot({
  workspaceId,
  agentId = null,
  scopeKey = 'workspace',
  metricType,
  metricValue,
  metricDate,
  skillType = null,
  window = 'DAILY',
  metadataJson = null,
}) {
  return prisma.analyticsMetricSnapshot.upsert({
    where: {
      workspaceId_scopeKey_metricType_metricDate_window: {
        workspaceId,
        scopeKey,
        metricType,
        metricDate,
        window,
      },
    },
    update: {
      agentId,
      metricValue,
      skillType,
      metadataJson,
    },
    create: {
      workspaceId,
      agentId,
      scopeKey,
      metricType,
      metricValue,
      metricDate,
      skillType,
      window,
      metadataJson,
    },
  });
}

async function computeSnapshotMetricsForRange(workspaceId, rangeStart, rangeEnd) {
  const [
    totalConversations,
    totalCustomers,
    totalLeads,
    totalAppointments,
    totalReminders,
    totalCampaigns,
    totalBroadcastSent,
    totalBroadcastDelivered,
    totalBroadcastFailed,
    activeAgents,
    crmEntries,
    assignedAgents,
  ] = await Promise.all([
    prisma.conversation.count({ where: { agent: { workspaceId }, startedAt: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.customer.count({ where: { workspaceId, createdAt: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.lead.count({ where: { workspaceId, createdAt: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.appointmentSchedule.count({ where: { workspaceId, createdAt: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.paymentReminder.count({ where: { workspaceId, createdAt: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.broadcastCampaign.count({ where: { workspaceId, createdAt: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.broadcastCampaignRecipient.count({ where: { workspaceId, sentAt: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.broadcastCampaignRecipient.count({ where: { workspaceId, deliveredAt: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.broadcastCampaignRecipient.count({ where: { workspaceId, failedAt: { gte: rangeStart, lte: rangeEnd } } }),
    prisma.agent.count({ where: { workspaceId, status: 'ACTIVE' } }),
    prisma.crmCustomerPipelineEntry.findMany({
      where: { workspaceId, OR: [{ createdAt: { gte: rangeStart, lte: rangeEnd } }, { updatedAt: { gte: rangeStart, lte: rangeEnd } }] },
      select: {
        valueAmount: true,
        stage: {
          select: {
            isClosedWon: true,
            isClosedLost: true,
          },
        },
      },
    }),
    prisma.agent.findMany({
      where: { workspaceId },
      select: {
        id: true,
        openclawSkill: true,
        configJson: true,
      },
    }),
  ]);

  const totalPipelineValue = crmEntries
    .filter((entry) => !entry.stage?.isClosedWon && !entry.stage?.isClosedLost)
    .reduce((sum, entry) => sum + decimalToNumber(entry.valueAmount, 0), 0);

  const activeSkillKeys = new Set();
  for (const agent of assignedAgents) {
    for (const skillKey of getAgentAssignedSkills(agent)) {
      activeSkillKeys.add(skillKey);
    }
  }

  return {
    totalConversations,
    totalCustomers,
    totalLeads,
    totalAppointments,
    totalReminders,
    totalCampaigns,
    totalBroadcastSent,
    totalBroadcastDelivered,
    totalBroadcastFailed,
    totalPipelineValue,
    totalActiveAgents: activeAgents,
    totalActiveSkills: activeSkillKeys.size,
  };
}

export async function captureAnalyticsSnapshotsForWorkspace({ workspaceId }) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, subTier: true },
  });

  if (!workspace) {
    return { workspaceId, skipped: true, reason: 'workspace_not_found' };
  }

  const agents = await prisma.agent.findMany({
    where: { workspaceId },
    select: {
      id: true,
      name: true,
      status: true,
      accessMode: true,
      openclawSkill: true,
      configJson: true,
    },
  });

  const analyticsAgents = agents.filter((agent) => agentCanUseAnalyticsDashboard(agent, 'canViewAnalytics', workspace.subTier));
  if (analyticsAgents.length === 0) {
    return { workspaceId, skipped: true, reason: 'analytics_skill_not_active' };
  }

  const metricDate = startOfUtcDay(new Date());
  const windows = [
    { window: 'DAILY', rangeStart: startOfUtcDay(metricDate), rangeEnd: endOfUtcDay(metricDate) },
    { window: 'WEEKLY', rangeStart: startOfUtcWeek(metricDate), rangeEnd: endOfUtcDay(metricDate) },
    { window: 'MONTHLY', rangeStart: startOfUtcMonth(metricDate), rangeEnd: endOfUtcDay(metricDate) },
    { window: 'ROLLING_7_DAYS', rangeStart: addUtcDays(metricDate, -6), rangeEnd: endOfUtcDay(metricDate) },
    { window: 'ROLLING_30_DAYS', rangeStart: addUtcDays(metricDate, -29), rangeEnd: endOfUtcDay(metricDate) },
  ];

  let snapshotCount = 0;

  for (const windowConfig of windows) {
    const metrics = await computeSnapshotMetricsForRange(workspaceId, windowConfig.rangeStart, windowConfig.rangeEnd);

    for (const [metricType, metricValue] of Object.entries(metrics)) {
      await upsertAnalyticsSnapshot({
        workspaceId,
        scopeKey: 'workspace',
        metricType,
        metricValue,
        metricDate,
        window: windowConfig.window,
      });
      snapshotCount += 1;
    }
  }

  for (const agent of analyticsAgents) {
    const [conversationCount, appointmentCount, reminderCount, campaignCount] = await Promise.all([
      prisma.conversation.count({ where: { agentId: agent.id, startedAt: { gte: metricDate, lte: endOfUtcDay(metricDate) } } }),
      prisma.appointmentSchedule.count({ where: { agentId: agent.id, createdAt: { gte: metricDate, lte: endOfUtcDay(metricDate) } } }),
      prisma.paymentReminder.count({ where: { agentId: agent.id, createdAt: { gte: metricDate, lte: endOfUtcDay(metricDate) } } }),
      prisma.broadcastCampaign.count({ where: { assignedAgentId: agent.id, createdAt: { gte: metricDate, lte: endOfUtcDay(metricDate) } } }),
    ]);

    for (const [metricType, metricValue] of Object.entries({
      totalConversations: conversationCount,
      totalAppointments: appointmentCount,
      totalReminders: reminderCount,
      totalCampaigns: campaignCount,
    })) {
      await upsertAnalyticsSnapshot({
        workspaceId,
        agentId: agent.id,
        scopeKey: buildScopeKey({ agentId: agent.id }),
        metricType,
        metricValue,
        metricDate,
        window: 'DAILY',
      });
      snapshotCount += 1;
    }
  }

  const assignedSkillMap = createAssignedSkillMap(agents);
  for (const [skillKey, skillAgents] of assignedSkillMap.entries()) {
    await upsertAnalyticsSnapshot({
      workspaceId,
      scopeKey: buildScopeKey({ skillType: skillKey }),
      metricType: 'usageCount',
      metricValue: skillAgents.length,
      metricDate,
      skillType: skillKey,
      window: 'DAILY',
    });
    snapshotCount += 1;
  }

  return {
    workspaceId,
    snapshotCount,
    assignedAgentCount: analyticsAgents.length,
  };
}

export async function runAnalyticsDashboardWorkerTick() {
  const candidateAgents = await prisma.agent.findMany({
    select: {
      id: true,
      workspaceId: true,
      accessMode: true,
      openclawSkill: true,
      configJson: true,
      workspace: {
        select: {
          subTier: true,
        },
      },
    },
  });

  const activeWorkspaceIds = [...new Set(candidateAgents
    .filter((agent) => agentCanUseAnalyticsDashboard(agent, 'canViewAnalytics', agent.workspace?.subTier || 'STARTER'))
    .map((agent) => agent.workspaceId)
    .filter(Boolean))];

  const results = [];
  for (const workspaceId of activeWorkspaceIds) {
    results.push(await captureAnalyticsSnapshotsForWorkspace({ workspaceId }));
  }

  return {
    workspaceCount: activeWorkspaceIds.length,
    results,
  };
}
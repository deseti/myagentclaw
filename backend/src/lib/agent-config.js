function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

import {
  buildAccessModeBadgeLabel,
  mapAccessModeToDmPolicy,
  normalizeAgentAccessMode,
} from './agent-access.js';

const SHARED_WORKSPACE_ACCESS_VALUES = new Set(['none', 'ro', 'rw']);

function trimString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeSkillConfigMap(value) {
  const raw = asPlainObject(value);
  const entries = Object.entries(raw)
    .filter(([key, config]) => String(key || '').trim() && config && typeof config === 'object' && !Array.isArray(config));

  if (entries.length === 0) {
    return null;
  }

  return Object.fromEntries(entries.map(([key, config]) => [String(key).trim(), { ...config }]));
}

export function normalizeSharedWorkspaceAccess(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return SHARED_WORKSPACE_ACCESS_VALUES.has(normalized) ? normalized : 'none';
}

export function normalizeAssignedSkills(value) {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,]/)
      : [];

  return [...new Set(rawValues
    .map((item) => String(item ?? '').trim())
    .filter(Boolean))];
}

export function getAgentConfigJson(agentOrConfig) {
  if (agentOrConfig && Object.prototype.hasOwnProperty.call(agentOrConfig, 'configJson')) {
    return asPlainObject(agentOrConfig.configJson);
  }
  return asPlainObject(agentOrConfig);
}

export function getAgentSkillConfigs(agent) {
  const config = getAgentConfigJson(agent);
  return normalizeSkillConfigMap(config.skillConfigs) || {};
}

export function getAgentSkillConfig(agent, skillKey) {
  const normalizedSkillKey = String(skillKey || '').trim().toLowerCase();
  if (!normalizedSkillKey) {
    return null;
  }

  const skillConfigs = getAgentSkillConfigs(agent);
  const matchedEntry = Object.entries(skillConfigs).find(([key]) => String(key || '').trim().toLowerCase() === normalizedSkillKey);
  return matchedEntry?.[1] || null;
}

export function getAgentAssignedSkills(agent) {
  const config = getAgentConfigJson(agent);
  const fromConfig = normalizeAssignedSkills(config.assignedSkills);
  if (fromConfig.length > 0) {
    return fromConfig;
  }
  return normalizeAssignedSkills(agent?.openclawSkill);
}

export function getPrimaryAgentSkill(agent) {
  return getAgentAssignedSkills(agent)[0] || null;
}

export function getAgentRole(agent) {
  return trimString(getAgentConfigJson(agent).role);
}

export function getAgentSystemPrompt(agent) {
  return trimString(getAgentConfigJson(agent).systemPrompt) || '';
}

export function getAgentSharedWorkspaceAccess(agent) {
  const config = getAgentConfigJson(agent);
  return normalizeSharedWorkspaceAccess(config.sharedWorkspaceAccess);
}

export function getAgentAccessMode(agent) {
  return normalizeAgentAccessMode(agent?.accessMode);
}

export function mergeAgentConfig(existingConfig, payload) {
  const next = { ...getAgentConfigJson(existingConfig) };

  if (Object.prototype.hasOwnProperty.call(payload, 'role')) {
    const role = trimString(payload.role);
    if (role) next.role = role;
    else delete next.role;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'systemPrompt')) {
    const systemPrompt = trimString(payload.systemPrompt);
    if (systemPrompt) next.systemPrompt = systemPrompt;
    else delete next.systemPrompt;
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, 'assignedSkills')
    || Object.prototype.hasOwnProperty.call(payload, 'openclawSkill')
  ) {
    const assignedSkills = normalizeAssignedSkills(
      Object.prototype.hasOwnProperty.call(payload, 'assignedSkills')
        ? payload.assignedSkills
        : payload.openclawSkill,
    );

    if (assignedSkills.length > 0) next.assignedSkills = assignedSkills;
    else delete next.assignedSkills;
  }

  if (
    Object.prototype.hasOwnProperty.call(payload, 'skillConfigs')
    || Object.prototype.hasOwnProperty.call(payload, 'appointmentSchedulerConfig')
    || Object.prototype.hasOwnProperty.call(payload, 'crmPipelineConfig')
    || Object.prototype.hasOwnProperty.call(payload, 'broadcastCampaignConfig')
  ) {
    const nextSkillConfigs = {
      ...getAgentSkillConfigs(existingConfig),
      ...(normalizeSkillConfigMap(payload.skillConfigs) || {}),
    };

    if (Object.prototype.hasOwnProperty.call(payload, 'appointmentSchedulerConfig')) {
      const appointmentSchedulerConfig = asPlainObject(payload.appointmentSchedulerConfig);
      if (Object.keys(appointmentSchedulerConfig).length > 0) {
        nextSkillConfigs['appointment-scheduler'] = appointmentSchedulerConfig;
      } else {
        delete nextSkillConfigs['appointment-scheduler'];
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'crmPipelineConfig')) {
      const crmPipelineConfig = asPlainObject(payload.crmPipelineConfig);
      if (Object.keys(crmPipelineConfig).length > 0) {
        nextSkillConfigs['crm-pipeline'] = crmPipelineConfig;
      } else {
        delete nextSkillConfigs['crm-pipeline'];
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'broadcastCampaignConfig')) {
      const broadcastCampaignConfig = asPlainObject(payload.broadcastCampaignConfig);
      if (Object.keys(broadcastCampaignConfig).length > 0) {
        nextSkillConfigs['broadcast-campaign'] = broadcastCampaignConfig;
      } else {
        delete nextSkillConfigs['broadcast-campaign'];
      }
    }

    const normalizedSkillConfigs = normalizeSkillConfigMap(nextSkillConfigs);
    if (normalizedSkillConfigs) next.skillConfigs = normalizedSkillConfigs;
    else delete next.skillConfigs;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'sharedWorkspaceAccess')) {
    const sharedWorkspaceAccess = normalizeSharedWorkspaceAccess(payload.sharedWorkspaceAccess);
    if (sharedWorkspaceAccess !== 'none') next.sharedWorkspaceAccess = sharedWorkspaceAccess;
    else delete next.sharedWorkspaceAccess;
  }

  return Object.keys(next).length > 0 ? next : null;
}

export function buildGatewayAgentConfig(agent, extra = {}) {
  const assignedSkills = getAgentAssignedSkills(agent);
  const skillConfigs = getAgentSkillConfigs(agent);
  const workspace = agent.workspace || {};
  const subTier = workspace.subTier || 'FREE';
  const accessMode = getAgentAccessMode(agent);

  return {
    name: agent.name,
    workspaceName: workspace.name || 'Workspace Kami',
    persona: agent.persona || '',
    goal: agent.goal || 'Membantu pengguna mencapai tujuan mereka dengan akurat dan aman.',
    tone: agent.tone || 'Jelas, ramah, dan profesional',
    role: getAgentRole(agent) || 'AI Assistant',
    systemPrompt: getAgentSystemPrompt(agent),
    assignedSkills,
    skillConfigs,
    openclawSkill: assignedSkills[0] || '',
    workspaceId: agent.workspaceId,
    agentId: agent.id,
    ownerId: workspace.ownerId || '',
    subTier,
    privateWorkspaceKey: agent.id,
    hasSharedWorkspace: subTier !== 'FREE',
    sharedWorkspaceAccess: subTier !== 'FREE' ? getAgentSharedWorkspaceAccess(agent) : 'none',
    accessMode,
    accessModeLabel: buildAccessModeBadgeLabel(accessMode),
    dmPolicy: mapAccessModeToDmPolicy(accessMode),
    approvalCode: agent.approvalCode || null,
    ...extra,
  };
}
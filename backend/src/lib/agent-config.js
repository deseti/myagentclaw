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

  if (Object.prototype.hasOwnProperty.call(payload, 'sharedWorkspaceAccess')) {
    const sharedWorkspaceAccess = normalizeSharedWorkspaceAccess(payload.sharedWorkspaceAccess);
    if (sharedWorkspaceAccess !== 'none') next.sharedWorkspaceAccess = sharedWorkspaceAccess;
    else delete next.sharedWorkspaceAccess;
  }

  return Object.keys(next).length > 0 ? next : null;
}

export function buildGatewayAgentConfig(agent, extra = {}) {
  const assignedSkills = getAgentAssignedSkills(agent);
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
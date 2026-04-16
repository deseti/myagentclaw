import prisma from './prisma.js';
import { getAgentAssignedSkills } from './agent-config.js';

function normalizeSkillKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getSkillKeyCandidates(skillLike) {
  if (Array.isArray(skillLike)) {
    return skillLike.map(normalizeSkillKey).filter(Boolean);
  }

  if (typeof skillLike === 'string') {
    const normalized = normalizeSkillKey(skillLike);
    return normalized ? [normalized] : [];
  }

  return [
    skillLike?.skillKey,
    skillLike?.slug,
    skillLike?.name,
    skillLike?.displayName,
  ].map(normalizeSkillKey).filter(Boolean);
}

export function matchesSkillKey(skillLike, requiredSkillKey) {
  const normalizedRequiredSkillKey = normalizeSkillKey(requiredSkillKey);
  if (!normalizedRequiredSkillKey) return false;

  return getSkillKeyCandidates(skillLike).includes(normalizedRequiredSkillKey);
}

export function agentHasAssignedSkill(agent, requiredSkillKey) {
  return getAgentAssignedSkills(agent).some((skillKey) => matchesSkillKey(skillKey, requiredSkillKey));
}

export async function workspaceHasAssignedSkill(workspaceId, requiredSkillKey) {
  if (!workspaceId) return false;

  const agents = await prisma.agent.findMany({
    where: { workspaceId },
    select: { openclawSkill: true, configJson: true },
  });

  return agents.some((agent) => agentHasAssignedSkill(agent, requiredSkillKey));
}

export async function listAgentsUsingSkill(workspaceId, requiredSkillKey) {
  if (!workspaceId) {
    return [];
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
    orderBy: { name: 'asc' },
  });

  return agents.filter((agent) => agentHasAssignedSkill(agent, requiredSkillKey));
}

export async function listWorkspaceIdsWithAssignedSkill(workspaceIds, requiredSkillKey) {
  const uniqueWorkspaceIds = [...new Set((workspaceIds || []).filter(Boolean))];
  if (uniqueWorkspaceIds.length === 0) {
    return new Set();
  }

  const agents = await prisma.agent.findMany({
    where: { workspaceId: { in: uniqueWorkspaceIds } },
    select: { workspaceId: true, openclawSkill: true, configJson: true },
  });

  const matchingWorkspaceIds = new Set();

  for (const agent of agents) {
    if (agentHasAssignedSkill(agent, requiredSkillKey)) {
      matchingWorkspaceIds.add(agent.workspaceId);
    }
  }

  return matchingWorkspaceIds;
}
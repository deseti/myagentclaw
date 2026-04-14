import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import {
  getAgentAssignedSkills,
  mergeAgentConfig,
} from '../lib/agent-config.js';
import {
  ocInstallBundledSkill,
  ocInstallSkill,
  ocListBundledSkills,
  ocListInstalledSkills,
  ocUninstallSkill,
} from '../lib/openclaw-client.js';
import { ensureWorkspaceRuntime } from '../lib/runtime-manager.js';
import { syncAgentToGateway } from '../lib/agent-provisioner.js';
import { APPOINTMENT_SCHEDULER_SKILL_KEY } from '../lib/appointment-scheduler.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../lib/internal-skills.js';

const CLAWHUB_URL = (process.env.OPENCLAW_CLAWHUB_URL || process.env.CLAWHUB_URL || 'https://clawhub.ai').replace(/\/+$/, '');
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;

const skillSearchCache = new Map();
const skillDetailCache = new Map();

const installSkillSchema = z.object({
  slug: z.string().min(1).max(100),
  version: z.string().min(1).max(50).optional(),
  force: z.boolean().optional(),
});

async function assertSkillsAccess(ownerId, reply) {
  const workspace = await prisma.workspace.findFirst({
    where: { ownerId },
    select: { id: true, subTier: true },
  });

  if (!workspace) {
    reply.code(404).send({ error: 'Not Found', message: 'Workspace tidak ditemukan' });
    return null;
  }

  if (workspace.subTier === 'FREE') {
    reply.code(403).send({
      error: 'Forbidden',
      message: 'Fitur skill hanya tersedia mulai paket STARTER.',
    });
    return null;
  }

  return workspace;
}

async function clawhubRequest(path, search = {}) {
  const url = new URL(path, `${CLAWHUB_URL}/`);

  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`ClawHub ${path} -> ${response.status}: ${text}`);
  }

  return response.json();
}

function readCache(store, key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(store, key, value) {
  store.set(key, {
    value,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });
}

function isRateLimitError(err) {
  return String(err?.message || '').includes('-> 429:');
}

function normalizeSlugCandidate(query) {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return '';

  try {
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      const url = new URL(normalized);
      const segments = url.pathname.split('/').filter(Boolean);
      return segments.at(-1) || '';
    }
  } catch {
    // Ignore URL parsing issues and fall back to raw string handling.
  }

  const segments = normalized.split('/').filter(Boolean);
  const candidate = segments.at(-1) || normalized;
  return /^[a-z0-9][a-z0-9-]{1,99}$/.test(candidate) ? candidate : '';
}

function mapDetailToSearchResult(detail, installed = false) {
  if (!detail?.skill?.slug) return null;

  return {
    slug: detail.skill.slug,
    displayName: detail.skill.displayName,
    summary: detail.skill.summary || '',
    version: detail.latestVersion?.version || null,
    updatedAt: detail.skill.updatedAt || null,
    installed,
  };
}

function parseAdapterTransportError(err) {
  const rawMessage = String(err?.message || '').trim();
  const match = rawMessage.match(/->\s*(\d{3}):\s*([\s\S]*)$/);
  const statusCode = match ? parseInt(match[1], 10) : 502;
  const rawBody = match ? match[2].trim() : rawMessage;

  let parsedBody = null;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsedBody = null;
  }

  return {
    statusCode,
    rawBody,
    parsedBody,
    message: parsedBody?.message || parsedBody?.error || rawBody || rawMessage || 'Adapter request gagal',
  };
}

async function inspectBundledSkillAvailability(runtime, slug) {
  const bundledPayload = await ocListBundledSkills(runtime);
  const bundledSkills = Array.isArray(bundledPayload?.skills) ? bundledPayload.skills : [];
  const normalizedSlug = String(slug || '').trim();
  const requestedSkill = bundledSkills.find((skill) => skill.slug === normalizedSlug) || null;

  return {
    bundledSkills,
    requestedSkill,
    bundledSlugs: bundledSkills.map((skill) => skill.slug),
  };
}

async function listAssignedAgents(ownerId) {
  const agents = await prisma.agent.findMany({
    where: { workspace: { ownerId } },
    select: { id: true, name: true, openclawSkill: true, configJson: true },
    orderBy: { name: 'asc' },
  });

  const assignments = new Map();

  for (const agent of agents) {
    for (const skillKey of getAgentAssignedSkills(agent)) {
      const current = assignments.get(skillKey) || [];
      current.push({ id: agent.id, name: agent.name });
      assignments.set(skillKey, current);
    }
  }

  return assignments;
}

function mergeInstalledAssignments(skills, assignments) {
  return skills.map((skill) => {
    const assignedAgents = assignments.get(skill.skillKey) || [];

    return {
      ...skill,
      assignedAgents,
      assignedCount: assignedAgents.length,
      isActive: assignedAgents.length > 0,
    };
  });
}

async function clearSkillAssignments(ownerId, installedSkill) {
  const candidateKeys = [...new Set([
    installedSkill?.skillKey,
    installedSkill?.slug,
  ].filter(Boolean))];
  const removesAppointmentScheduler = candidateKeys.includes(APPOINTMENT_SCHEDULER_SKILL_KEY);

  if (candidateKeys.length === 0) {
    return [];
  }

  const affectedAgents = await prisma.agent.findMany({
    where: { workspace: { ownerId } },
    select: { id: true, name: true, openclawSkill: true, configJson: true },
    orderBy: { name: 'asc' },
  });

  const matchedAgents = affectedAgents.filter((agent) => {
    const assignedSkills = getAgentAssignedSkills(agent);
    return assignedSkills.some((skillKey) => candidateKeys.includes(skillKey));
  });

  if (matchedAgents.length === 0) {
    return [];
  }

  await Promise.all(matchedAgents.map(async (agent) => {
    const remainingSkills = getAgentAssignedSkills(agent)
      .filter((skillKey) => !candidateKeys.includes(skillKey));

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        openclawSkill: remainingSkills[0] || null,
        configJson: mergeAgentConfig(agent.configJson, {
          assignedSkills: remainingSkills,
          ...(removesAppointmentScheduler ? { appointmentSchedulerConfig: {} } : {}),
        }),
      },
    });
  }));

  if (removesAppointmentScheduler) {
    await prisma.appointmentAvailability.deleteMany({
      where: {
        agentId: { in: matchedAgents.map((agent) => agent.id) },
      },
    });
  }

  await Promise.all(matchedAgents.map((agent) => syncAgentToGateway(agent.id)));

  return matchedAgents.map(({ id, name }) => ({ id, name }));
}

export default async function skillsRoute(fastify) {
  fastify.addHook('preHandler', authenticate);
  fastify.addHook('preHandler', async (request, reply) => {
    const workspace = await assertSkillsAccess(request.user.ownerId, reply);
    if (!workspace) return;
    request.workspace = workspace;
  });

  fastify.get('/installed', async (request, reply) => {
    try {
      const runtime = await ensureWorkspaceRuntime({ ...request.workspace, ownerId: request.user.ownerId });
      const [{ skills }, assignments] = await Promise.all([
        ocListInstalledSkills(runtime),
        listAssignedAgents(request.user.ownerId),
      ]);

      return reply.send({ skills: mergeInstalledAssignments(skills ?? [], assignments) });
    } catch (err) {
      request.log.warn({ err: err.message }, 'Failed to load installed skills');
      return reply.code(502).send({ error: 'Bad Gateway', message: 'Gagal mengambil daftar skill terinstall' });
    }
  });

  fastify.get('/bundled', async (request, reply) => {
    try {
      const runtime = await ensureWorkspaceRuntime({ ...request.workspace, ownerId: request.user.ownerId });
      const [{ skills: bundledSkills }, { skills: installedSkills }] = await Promise.all([
        ocListBundledSkills(runtime),
        ocListInstalledSkills(runtime),
      ]);

      const installedBySlug = new Map((installedSkills ?? []).map((skill) => [skill.slug, skill]));
      const skills = (bundledSkills ?? []).map((skill) => ({
        ...skill,
        installed: installedBySlug.has(skill.slug),
        installedSkill: installedBySlug.get(skill.slug) || null,
      }));

      return reply.send({ skills });
    } catch (err) {
      request.log.warn({ err: err.message }, 'Failed to load bundled skills');
      return reply.code(502).send({ error: 'Bad Gateway', message: 'Gagal mengambil daftar skill built-in' });
    }
  });

  fastify.get('/search', async (request, reply) => {
    const query = String(request.query?.q || '').trim();
    const limit = Math.min(parseInt(String(request.query?.limit || '12'), 10) || 12, 24);
    const cacheKey = query.toLowerCase();

    try {
      const runtime = await ensureWorkspaceRuntime({ ...request.workspace, ownerId: request.user.ownerId });
      const { skills } = await ocListInstalledSkills(runtime);
      const installed = new Set((skills ?? []).map((item) => item.slug));

      if (!query) {
        return reply.send({ results: [] });
      }

      const exactSlug = normalizeSlugCandidate(query);
      let exactMatch = null;

      if (exactSlug) {
        try {
          exactMatch = readCache(skillDetailCache, exactSlug)
            || await clawhubRequest(`/api/v1/skills/${encodeURIComponent(exactSlug)}`);
          writeCache(skillDetailCache, exactSlug, exactMatch);

          const mappedExact = mapDetailToSearchResult(exactMatch, installed.has(exactSlug));
          if (mappedExact) {
            writeCache(skillSearchCache, cacheKey, [mappedExact]);
            return reply.send({ results: [mappedExact] });
          }
        } catch (err) {
          if (!String(err?.message || '').includes('-> 404:')) {
            request.log.info({ err: err.message, exactSlug }, 'Exact skill lookup failed, falling back to search');
          }
        }
      }

      const resultsPayload = await clawhubRequest('/api/v1/search', { q: query, limit });

      const results = Array.isArray(resultsPayload.results)
        ? resultsPayload.results.map((item) => ({
          slug: item.slug,
          displayName: item.displayName,
          summary: item.summary || '',
          version: item.version || null,
          updatedAt: item.updatedAt || null,
          installed: installed.has(item.slug),
        }))
        : (resultsPayload.items ?? []).map((item) => ({
          slug: item.slug,
          displayName: item.displayName,
          summary: item.summary || '',
          version: item.latestVersion?.version || null,
          updatedAt: item.updatedAt || null,
          installed: installed.has(item.slug),
        }));

      writeCache(skillSearchCache, cacheKey, results);

      return reply.send({ results });
    } catch (err) {
      if (isRateLimitError(err)) {
        const cached = readCache(skillSearchCache, cacheKey);
        if (cached) {
          request.log.info({ query }, 'Serving cached ClawHub search result after rate limit');
          return reply.send({ results: cached, cached: true });
        }
      }

      request.log.warn({ err: err.message }, 'Failed to search ClawHub skills');
      return reply.code(502).send({ error: 'Bad Gateway', message: 'Gagal mencari skill di ClawHub' });
    }
  });

  fastify.get('/:slug', async (request, reply) => {
    const slug = String(request.params.slug || '').trim();
    if (!slug) {
      return reply.code(400).send({ error: 'Bad Request', message: 'slug diperlukan' });
    }

    try {
      const runtime = await ensureWorkspaceRuntime({ ...request.workspace, ownerId: request.user.ownerId });
      const [detail, installedPayload, assignments] = await Promise.all([
        clawhubRequest(`/api/v1/skills/${encodeURIComponent(slug)}`),
        ocListInstalledSkills(runtime),
        listAssignedAgents(request.user.ownerId),
      ]);

      writeCache(skillDetailCache, slug, detail);

      const installedSkill = (installedPayload.skills ?? []).find((item) => item.slug === slug) || null;
      const skillKey = installedSkill?.skillKey || detail?.skill?.slug || slug;
      const assignedAgents = assignments.get(skillKey) || [];

      return reply.send({
        skill: detail.skill,
        latestVersion: detail.latestVersion || null,
        metadata: detail.metadata || null,
        owner: detail.owner || null,
        installed: Boolean(installedSkill),
        installedSkill,
        runtime: installedPayload.runtime || null,
        assignedAgents,
      });
    } catch (err) {
      request.log.warn({ err: err.message, slug }, 'Failed to inspect ClawHub skill');
      return reply.code(502).send({ error: 'Bad Gateway', message: 'Gagal mengambil detail skill' });
    }
  });

  fastify.post('/install', async (request, reply) => {
    const parsed = installSkillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    try {
      const runtime = await ensureWorkspaceRuntime({ ...request.workspace, ownerId: request.user.ownerId });
      const { skill } = await ocInstallSkill(parsed.data, runtime);
      return reply.code(201).send({ message: 'Skill berhasil diinstall', skill });
    } catch (err) {
      const statusMatch = /->\s(\d{3})/.exec(err.message || '');
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 502;
      const message = statusCode === 409
        ? 'Skill sudah terinstall. Gunakan force untuk install ulang.'
        : 'Gagal menginstall skill dari ClawHub';
      request.log.warn({ err: err.message, slug: parsed.data.slug }, 'Failed to install ClawHub skill');
      return reply.code(statusCode).send({ error: 'Install Failed', message });
    }
  });

  fastify.post('/install-bundled', async (request, reply) => {
    const parsed = installSkillSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const internalSkill = getInternalSkillDefinition(parsed.data.slug);
    if (internalSkill?.isComingSoon) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Skill internal ini masih Coming Soon dan belum bisa diinstall.',
      });
    }

    if (internalSkill && !workspaceMeetsMinimumTier(request.workspace.subTier, internalSkill.minimumTier)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: `Skill ini memerlukan minimum paket ${formatInternalSkillTierLabel(internalSkill.minimumTier)}.`,
      });
    }

    try {
      let runtime = await ensureWorkspaceRuntime({ ...request.workspace, ownerId: request.user.ownerId });
      request.log.info({
        slug: parsed.data.slug,
        force: parsed.data.force === true,
        runtimeMode: runtime.mode,
        adapterContainerName: runtime.adapterContainerName,
      }, 'Bundled skill install requested');

      let availability = await inspectBundledSkillAvailability(runtime, parsed.data.slug);
      request.log.info({
        slug: parsed.data.slug,
        runtimeMode: runtime.mode,
        adapterContainerName: runtime.adapterContainerName,
        bundledSlugs: availability.bundledSlugs,
        requestedSkill: availability.requestedSkill,
      }, 'Bundled skill availability check');

      if (!availability.requestedSkill && runtime.mode === 'DEDICATED') {
        request.log.warn({
          slug: parsed.data.slug,
          runtimeMode: runtime.mode,
          adapterContainerName: runtime.adapterContainerName,
        }, 'Bundled skill missing in dedicated adapter, forcing refresh');

        runtime = await ensureWorkspaceRuntime(
          { ...request.workspace, ownerId: request.user.ownerId },
          { forceRecreateAdapter: true },
        );
        availability = await inspectBundledSkillAvailability(runtime, parsed.data.slug);

        request.log.info({
          slug: parsed.data.slug,
          runtimeMode: runtime.mode,
          adapterContainerName: runtime.adapterContainerName,
          bundledSlugs: availability.bundledSlugs,
          requestedSkill: availability.requestedSkill,
        }, 'Bundled skill availability after dedicated adapter refresh');
      }

      if (!availability.requestedSkill) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `Skill built-in "${parsed.data.slug}" tidak ditemukan di runtime adapter workspace.`,
          details: {
            slug: parsed.data.slug,
            runtimeMode: runtime.mode,
            adapterContainerName: runtime.adapterContainerName,
            bundledSlugs: availability.bundledSlugs,
          },
        });
      }

      const { skill } = await ocInstallBundledSkill(parsed.data, runtime);
      request.log.info({
        slug: parsed.data.slug,
        runtimeMode: runtime.mode,
        adapterContainerName: runtime.adapterContainerName,
        installedSkillSlug: skill?.slug || null,
        installedSkillKey: skill?.skillKey || null,
      }, 'Bundled skill install success');
      return reply.code(201).send({ message: 'Skill built-in berhasil diinstall', skill });
    } catch (err) {
      const adapterError = parseAdapterTransportError(err);
      const message = adapterError.statusCode === 409
        ? 'Skill built-in sudah terinstall. Gunakan force untuk install ulang.'
        : adapterError.message || 'Gagal menginstall skill built-in';
      request.log.warn({
        err: err.message,
        slug: parsed.data.slug,
        statusCode: adapterError.statusCode,
        adapterBody: adapterError.rawBody,
      }, 'Bundled skill install failed');
      return reply.code(adapterError.statusCode).send({
        error: 'Install Failed',
        message,
        details: adapterError.parsedBody?.details || adapterError.parsedBody || undefined,
      });
    }
  });

  fastify.delete('/:slug', async (request, reply) => {
    const slug = String(request.params.slug || '').trim();
    if (!slug) {
      return reply.code(400).send({ error: 'Bad Request', message: 'slug diperlukan' });
    }

    try {
      const runtime = await ensureWorkspaceRuntime({ ...request.workspace, ownerId: request.user.ownerId });
      const installedPayload = await ocListInstalledSkills(runtime);
      const installedSkill = (installedPayload.skills ?? []).find((item) => item.slug === slug) || null;

      if (!installedSkill) {
        return reply.code(404).send({ error: 'Not Found', message: 'Skill belum terinstall di gateway' });
      }

      const unassignedAgents = await clearSkillAssignments(request.user.ownerId, installedSkill);
      const { skill } = await ocUninstallSkill({ slug }, runtime);

      request.log.info({
        slug,
        runtimeMode: runtime.mode,
        adapterContainerName: runtime.adapterContainerName,
        unassignedAgents: unassignedAgents.length,
      }, 'Skill uninstall success');

      return reply.send({
        message: 'Skill berhasil diuninstall',
        skill,
        unassignedAgents,
      });
    } catch (err) {
      const adapterError = parseAdapterTransportError(err);
      request.log.warn({
        err: err.message,
        slug,
        statusCode: adapterError.statusCode,
        adapterBody: adapterError.rawBody,
      }, 'Failed to uninstall skill');
      return reply.code(adapterError.statusCode).send({
        error: 'Uninstall Failed',
        message: adapterError.message || 'Gagal menghapus skill dari gateway',
        details: adapterError.parsedBody?.details || adapterError.parsedBody || undefined,
      });
    }
  });
}
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { ocListInstalledSkills } from '../../lib/openclaw-client.js';
import { ensureWorkspaceRuntime } from '../../lib/runtime-manager.js';
import { agentHasAssignedSkill, matchesSkillKey } from '../../lib/skill-activation.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../../lib/internal-skills.js';
import {
  getPolymarketMarketBySlug,
  getPolymarketOrderBook,
  listPolymarketMarkets,
  listPolymarketPositions,
  listPolymarketTags,
} from '../../lib/polymarket-client.js';

const MARKET_ORDER_VALUES = [
  'volume',
  'volume_24hr',
  'liquidity',
  'created_at',
  'updated_at',
  'open_interest',
  'liquidity_clob',
];

const POLYMARKET_SKILL_KEY = 'polymarket-read-only';
const POLYMARKET_SKILL_DEFINITION = getInternalSkillDefinition(POLYMARKET_SKILL_KEY);

const agentParamsSchema = z.object({
  agentId: z.string().min(1),
});

const marketsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  active: z.enum(['true', 'false']).optional(),
  closed: z.enum(['true', 'false']).optional(),
  ascending: z.enum(['true', 'false']).optional(),
  order: z.enum(MARKET_ORDER_VALUES).optional(),
  slug: z.string().min(1).max(200).optional(),
  tag_id: z.coerce.number().int().positive().optional(),
  related_tags: z.enum(['true', 'false']).optional(),
});

const orderbookParamsSchema = z.object({
  agentId: z.string().min(1),
  tokenId: z.string().min(1).max(200),
});

const positionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sizeThreshold: z.coerce.number().nonnegative().optional(),
});

function serializeProfile(profile) {
  if (!profile) {
    return {
      accountAddress: null,
      apiAddress: null,
      funderAddress: null,
      signatureType: null,
      preferredReadAddress: null,
    };
  }

  const preferredReadAddress = profile.apiAddress || profile.funderAddress || profile.accountAddress || null;

  return {
    accountAddress: profile.accountAddress || null,
    apiAddress: profile.apiAddress || null,
    funderAddress: profile.funderAddress || null,
    signatureType: Number.isInteger(profile.signatureType) ? profile.signatureType : null,
    preferredReadAddress,
  };
}

function toBoolean(value) {
  if (value === undefined) return undefined;
  return value === 'true';
}

async function resolveAgentContext(agentId, reply) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      status: true,
      openclawSkill: true,
      configJson: true,
      workspace: {
        select: {
          id: true,
          ownerId: true,
          subTier: true,
        },
      },
    },
  });

  if (!agent) {
    reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
    return null;
  }

  if (agent.status !== 'ACTIVE') {
    reply.code(403).send({ error: 'Forbidden', message: 'Agent tidak aktif' });
    return null;
  }

  if (!agent.workspace || !workspaceMeetsMinimumTier(agent.workspace.subTier, POLYMARKET_SKILL_DEFINITION?.minimumTier || 'GROWTH')) {
    reply.code(403).send({
      error: 'Forbidden',
      message: `Fitur Polymarket memerlukan minimum paket ${formatInternalSkillTierLabel(POLYMARKET_SKILL_DEFINITION?.minimumTier)}.`,
    });
    return null;
  }

  if (!agentHasAssignedSkill(agent, POLYMARKET_SKILL_KEY)) {
    reply.code(403).send({
      error: 'Forbidden',
      message: 'Skill Polymarket belum aktif pada agent ini.',
      requiredSkill: POLYMARKET_SKILL_KEY,
    });
    return null;
  }

  try {
    const runtime = await ensureWorkspaceRuntime(agent.workspace);
    const installedPayload = await ocListInstalledSkills(runtime);
    const installedSkills = Array.isArray(installedPayload?.skills) ? installedPayload.skills : [];
    const skillInstalled = installedSkills.some((skill) => matchesSkillKey(skill, POLYMARKET_SKILL_KEY));

    if (!skillInstalled) {
      reply.code(403).send({
        error: 'Forbidden',
        message: 'Skill built-in Polymarket belum diinstall untuk workspace agent ini.',
        requiredSkill: POLYMARKET_SKILL_KEY,
      });
      return null;
    }
  } catch {
    reply.code(502).send({
      error: 'Bad Gateway',
      message: 'Gagal memverifikasi skill Polymarket di runtime agent.',
    });
    return null;
  }

  const profile = await prisma.polymarketProfile.findUnique({
    where: { workspaceId: agent.workspace.id },
  });

  return {
    agent,
    workspace: agent.workspace,
    profile,
  };
}

export default async function internalPolymarketRoute(fastify) {
  fastify.get('/agents/:agentId/settings', async (request, reply) => {
    const paramsParsed = agentParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const context = await resolveAgentContext(paramsParsed.data.agentId, reply);
    if (!context) return;

    return reply.send({
      agentId: context.agent.id,
      workspaceId: context.workspace.id,
      tier: context.workspace.subTier,
      settings: serializeProfile(context.profile),
    });
  });

  fastify.get('/agents/:agentId/tags', async (request, reply) => {
    const paramsParsed = agentParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const context = await resolveAgentContext(paramsParsed.data.agentId, reply);
    if (!context) return;

    const tags = await listPolymarketTags();
    return reply.send({
      agentId: context.agent.id,
      workspaceId: context.workspace.id,
      tier: context.workspace.subTier,
      tags,
    });
  });

  fastify.get('/agents/:agentId/markets', async (request, reply) => {
    const paramsParsed = agentParamsSchema.safeParse(request.params);
    const queryParsed = marketsQuerySchema.safeParse(request.query);

    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const context = await resolveAgentContext(paramsParsed.data.agentId, reply);
    if (!context) return;

    const markets = await listPolymarketMarkets({
      ...queryParsed.data,
      active: toBoolean(queryParsed.data.active),
      closed: toBoolean(queryParsed.data.closed),
      ascending: toBoolean(queryParsed.data.ascending),
      related_tags: toBoolean(queryParsed.data.related_tags),
    });

    return reply.send({
      agentId: context.agent.id,
      workspaceId: context.workspace.id,
      tier: context.workspace.subTier,
      markets,
    });
  });

  fastify.get('/agents/:agentId/markets/slug/:slug', async (request, reply) => {
    const paramsParsed = z.object({
      agentId: z.string().min(1),
      slug: z.string().min(1).max(200),
    }).safeParse(request.params);

    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const context = await resolveAgentContext(paramsParsed.data.agentId, reply);
    if (!context) return;

    const market = await getPolymarketMarketBySlug(paramsParsed.data.slug);
    return reply.send({
      agentId: context.agent.id,
      workspaceId: context.workspace.id,
      tier: context.workspace.subTier,
      market,
    });
  });

  fastify.get('/agents/:agentId/orderbook/:tokenId', async (request, reply) => {
    const paramsParsed = orderbookParamsSchema.safeParse(request.params);

    if (!paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const context = await resolveAgentContext(paramsParsed.data.agentId, reply);
    if (!context) return;

    const orderbook = await getPolymarketOrderBook(paramsParsed.data.tokenId);
    return reply.send({
      agentId: context.agent.id,
      workspaceId: context.workspace.id,
      tier: context.workspace.subTier,
      orderbook,
    });
  });

  fastify.get('/agents/:agentId/positions', async (request, reply) => {
    const paramsParsed = agentParamsSchema.safeParse(request.params);
    const queryParsed = positionsQuerySchema.safeParse(request.query);

    if (!paramsParsed.success || !queryParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const context = await resolveAgentContext(paramsParsed.data.agentId, reply);
    if (!context) return;

    const resolvedAddress = context.profile?.apiAddress || context.profile?.funderAddress || context.profile?.accountAddress || null;
    if (!resolvedAddress) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Alamat Polymarket belum diset. Simpan dulu di settings Polymarket.',
      });
    }

    const positions = await listPolymarketPositions(resolvedAddress, queryParsed.data);
    return reply.send({
      agentId: context.agent.id,
      workspaceId: context.workspace.id,
      tier: context.workspace.subTier,
      address: resolvedAddress,
      settings: serializeProfile(context.profile),
      positions,
    });
  });
}
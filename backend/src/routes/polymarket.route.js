import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { ocListInstalledSkills } from '../lib/openclaw-client.js';
import { ensureWorkspaceRuntime } from '../lib/runtime-manager.js';
import { matchesSkillKey, workspaceHasAssignedSkill } from '../lib/skill-activation.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../lib/internal-skills.js';
import {
  getPolymarketMarketBySlug,
  getPolymarketOrderBook,
  listPolymarketMarkets,
  listPolymarketPositions,
  listPolymarketSports,
  listPolymarketTags,
} from '../lib/polymarket-client.js';
import {
  buildCredentialUpdateData,
  cancelManualTrade,
  createOrDeriveTradingCredentials,
  getTradingSummary,
  listTradingOpenOrders,
  placeManualTrade,
  previewManualTrade,
  serializeTradingCredentials,
  testStoredTradingCredentials,
} from '../lib/polymarket-trading.js';
import { createTradeAudit, serializeTradeAuditEntry } from '../lib/polymarket-trade-audit.js';

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

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const ETH_ADDRESS_SEARCH_REGEX = /0x[a-fA-F0-9]{40}/;

function normalizeOptionalAddressInput(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  const match = normalized.match(ETH_ADDRESS_SEARCH_REGEX);
  return match ? match[0] : normalized;
}

function normalizeQueryAddressInput(value) {
  if (value === undefined || value === null) return undefined;

  const normalized = String(value).trim();
  if (!normalized) return undefined;

  const match = normalized.match(ETH_ADDRESS_SEARCH_REGEX);
  return match ? match[0] : normalized;
}

function normalizeSecretInput(value) {
  if (value === undefined || value === null) return undefined;

  const normalized = String(value).trim();
  return normalized || undefined;
}

const optionalAddressSchema = z.preprocess(
  normalizeOptionalAddressInput,
  z.string().regex(ETH_ADDRESS_REGEX, 'Alamat Polymarket tidak valid').optional().nullable(),
);

const queryAddressSchema = z.preprocess(
  normalizeQueryAddressInput,
  z.string().regex(ETH_ADDRESS_REGEX, 'Alamat Polymarket tidak valid').optional(),
);

const workspaceQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

const marketsQuerySchema = workspaceQuerySchema.extend({
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

const orderBookQuerySchema = workspaceQuerySchema.extend({
  tokenId: z.string().min(1).max(200),
});

const positionsQuerySchema = workspaceQuerySchema.extend({
  address: queryAddressSchema,
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sizeThreshold: z.coerce.number().nonnegative().optional(),
});

const settingsSchema = z.object({
  workspaceId: z.string().min(1),
  accountAddress: optionalAddressSchema,
  apiAddress: optionalAddressSchema,
  funderAddress: optionalAddressSchema,
  signatureType: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.null(),
  ]).optional(),
});

const optionalSecretSchema = z.preprocess(
  normalizeSecretInput,
  z.string().max(5000).optional(),
);

const credentialUpdateSchema = z.object({
  workspaceId: z.string().min(1),
  privateKey: optionalSecretSchema,
  apiKey: optionalSecretSchema,
  secret: optionalSecretSchema,
  passphrase: optionalSecretSchema,
});

const credentialDeriveSchema = z.object({
  workspaceId: z.string().min(1),
  privateKey: optionalSecretSchema,
  mode: z.enum(['create', 'derive', 'createOrDerive']).optional(),
});

const tradingSummaryQuerySchema = workspaceQuerySchema.extend({
  tokenId: z.string().min(1).max(200).optional(),
  assetId: z.string().min(1).max(200).optional(),
  market: z.string().min(1).max(200).optional(),
  includeAllOpenOrders: z.enum(['true', 'false']).optional(),
});

const auditQuerySchema = workspaceQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const orderIntentSchema = z.object({
  workspaceId: z.string().min(1),
  marketSlug: z.string().max(200).optional(),
  marketQuestion: z.string().max(500).optional(),
  outcomeLabel: z.string().max(120).optional(),
  tokenId: z.string().min(1).max(200),
  side: z.enum(['BUY', 'SELL']),
  orderKind: z.enum(['limit', 'market']),
  orderType: z.enum(['GTC', 'GTD', 'FOK', 'FAK']),
  price: z.coerce.number().positive(),
  size: z.coerce.number().positive().optional(),
  amount: z.coerce.number().positive().optional(),
  expiration: z.coerce.number().int().positive().optional(),
  postOnly: z.boolean().optional(),
  approvalConfirmed: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.orderKind === 'limit' && (value.size === undefined || value.size <= 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['size'],
      message: 'Limit order membutuhkan size.',
    });
  }

  if (value.orderKind === 'market' && (value.amount === undefined || value.amount <= 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['amount'],
      message: 'Market order membutuhkan amount.',
    });
  }

  if (value.orderKind === 'limit' && !['GTC', 'GTD'].includes(value.orderType)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['orderType'],
      message: 'Limit order hanya mendukung GTC atau GTD.',
    });
  }

  if (value.orderKind === 'market' && !['FOK', 'FAK'].includes(value.orderType)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['orderType'],
      message: 'Market order hanya mendukung FOK atau FAK.',
    });
  }

  if (value.orderType === 'GTD' && (!value.expiration || value.expiration <= 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiration'],
      message: 'Order type GTD membutuhkan expiration timestamp.',
    });
  }

  if (value.postOnly && value.orderKind !== 'limit') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['postOnly'],
      message: 'Post-only hanya didukung untuk limit order.',
    });
  }
});

const cancelOrderSchema = z.object({
  workspaceId: z.string().min(1),
  orderId: z.string().min(1).max(200),
  marketSlug: z.string().max(200).optional(),
  outcomeLabel: z.string().max(120).optional(),
  tokenId: z.string().max(200).optional(),
});

async function assertPolymarketReadAccess(ownerId, workspaceId, reply) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId },
    select: { id: true, ownerId: true, subTier: true, subStatus: true },
  });

  if (!workspace) {
    reply.code(404).send({ error: 'Not Found', message: 'Workspace tidak ditemukan' });
    return null;
  }

  if (!workspaceMeetsMinimumTier(workspace.subTier, POLYMARKET_SKILL_DEFINITION?.minimumTier || 'GROWTH')) {
    reply.code(403).send({
      error: 'Forbidden',
      message: `Fitur Polymarket memerlukan minimum paket ${formatInternalSkillTierLabel(POLYMARKET_SKILL_DEFINITION?.minimumTier)}.`,
    });
    return null;
  }

  try {
    const runtime = await ensureWorkspaceRuntime({ ...workspace, ownerId });
    const installedPayload = await ocListInstalledSkills(runtime);
    const installedSkills = Array.isArray(installedPayload?.skills) ? installedPayload.skills : [];
    const skillInstalled = installedSkills.some((skill) => matchesSkillKey(skill, POLYMARKET_SKILL_KEY));

    if (!skillInstalled) {
      reply.code(403).send({
        error: 'Forbidden',
        message: 'Skill built-in Polymarket belum diinstall untuk workspace ini.',
        requiredSkill: POLYMARKET_SKILL_KEY,
      });
      return null;
    }

    const skillActive = await workspaceHasAssignedSkill(workspace.id, POLYMARKET_SKILL_KEY);
    if (!skillActive) {
      reply.code(403).send({
        error: 'Forbidden',
        message: 'Skill Polymarket sudah terinstall, tetapi belum aktif. Assign skill ini ke minimal satu agent untuk membuka dashboard Polymarket.',
        requiredSkill: POLYMARKET_SKILL_KEY,
      });
      return null;
    }
  } catch (error) {
    reply.code(502).send({
      error: 'Bad Gateway',
      message: 'Gagal memverifikasi skill Polymarket di runtime workspace.',
    });
    return null;
  }

  return workspace;
}

function cleanAddress(value) {
  const normalized = normalizeOptionalAddressInput(value);
  return normalized || null;
}

function serializeProfile(profile) {
  if (!profile) {
    return {
      accountAddress: null,
      apiAddress: null,
      funderAddress: null,
      signatureType: null,
      preferredReadAddress: null,
      trading: serializeTradingCredentials(null),
    };
  }

  const preferredReadAddress = profile.apiAddress || profile.funderAddress || profile.accountAddress || null;

  return {
    accountAddress: profile.accountAddress || null,
    apiAddress: profile.apiAddress || null,
    funderAddress: profile.funderAddress || null,
    signatureType: Number.isInteger(profile.signatureType) ? profile.signatureType : null,
    preferredReadAddress,
    trading: serializeTradingCredentials(profile),
  };
}

function toBoolean(value) {
  if (value === undefined) return undefined;
  return value === 'true';
}

export default async function polymarketRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/settings', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = workspaceQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const profile = await prisma.polymarketProfile.findUnique({
      where: { workspaceId: workspace.id },
    });

    return reply.send({
      workspaceId: workspace.id,
      tier: workspace.subTier,
      settings: serializeProfile(profile),
    });
  });

  fastify.put('/settings', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = settingsSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspaceId, accountAddress, apiAddress, funderAddress, signatureType } = parsed.data;
    const workspace = await assertPolymarketReadAccess(ownerId, workspaceId, reply);
    if (!workspace) return;

    const profile = await prisma.polymarketProfile.upsert({
      where: { workspaceId: workspace.id },
      update: {
        accountAddress: cleanAddress(accountAddress),
        apiAddress: cleanAddress(apiAddress),
        funderAddress: cleanAddress(funderAddress),
        signatureType: signatureType ?? null,
      },
      create: {
        workspaceId: workspace.id,
        accountAddress: cleanAddress(accountAddress),
        apiAddress: cleanAddress(apiAddress),
        funderAddress: cleanAddress(funderAddress),
        signatureType: signatureType ?? null,
      },
    });

    return reply.send({
      message: 'Polymarket settings berhasil disimpan',
      workspaceId: workspace.id,
      tier: workspace.subTier,
      settings: serializeProfile(profile),
    });
  });

  fastify.put('/credentials', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = credentialUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    let updateData;
    try {
      updateData = buildCredentialUpdateData(parsed.data);
    } catch (error) {
      return reply.code(400).send({ error: 'Validation error', message: error.message });
    }

    const profile = await prisma.polymarketProfile.upsert({
      where: { workspaceId: workspace.id },
      update: updateData,
      create: {
        workspaceId: workspace.id,
        ...updateData,
      },
    });

    return reply.send({
      message: 'Credential trading Polymarket berhasil disimpan secara terenkripsi',
      workspaceId: workspace.id,
      tier: workspace.subTier,
      settings: serializeProfile(profile),
    });
  });

  fastify.post('/credentials/derive', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = credentialDeriveSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const existingProfile = await prisma.polymarketProfile.findUnique({
      where: { workspaceId: workspace.id },
    });

    try {
      const result = await createOrDeriveTradingCredentials(existingProfile, {
        privateKey: parsed.data.privateKey,
        mode: parsed.data.mode || 'createOrDerive',
      });

      const securedCredentialData = buildCredentialUpdateData({
        privateKey: parsed.data.privateKey,
        apiKey: result.credentials.key,
        secret: result.credentials.secret,
        passphrase: result.credentials.passphrase,
      });

      const profile = await prisma.polymarketProfile.upsert({
        where: { workspaceId: workspace.id },
        update: {
          ...securedCredentialData,
          credentialsLastVerifiedAt: new Date(result.testResult.checkedAt),
          credentialsLastError: null,
        },
        create: {
          workspaceId: workspace.id,
          ...securedCredentialData,
          credentialsLastVerifiedAt: new Date(result.testResult.checkedAt),
          credentialsLastError: null,
        },
      });

      return reply.send({
        message: 'API credential Polymarket berhasil dibuat atau diturunkan lalu diuji ke endpoint authenticated read.',
        workspaceId: workspace.id,
        tier: workspace.subTier,
        settings: serializeProfile(profile),
        auth: result.testResult,
      });
    } catch (error) {
      const failedProfile = await prisma.polymarketProfile.upsert({
        where: { workspaceId: workspace.id },
        update: { credentialsLastError: error.message },
        create: {
          workspaceId: workspace.id,
          credentialsLastError: error.message,
        },
      });

      return reply.code(400).send({
        error: 'Bad Request',
        message: error.message,
        settings: serializeProfile(failedProfile),
      });
    }
  });

  fastify.post('/credentials/test', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = workspaceQuerySchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const profile = await prisma.polymarketProfile.findUnique({
      where: { workspaceId: workspace.id },
    });

    try {
      const auth = await testStoredTradingCredentials(profile);
      const updatedProfile = await prisma.polymarketProfile.update({
        where: { workspaceId: workspace.id },
        data: {
          credentialsLastVerifiedAt: new Date(auth.checkedAt),
          credentialsLastError: null,
        },
      });

      return reply.send({
        message: 'Authenticated read Polymarket berhasil. Credential L1/L2 valid untuk endpoint trading read-only.',
        workspaceId: workspace.id,
        tier: workspace.subTier,
        settings: serializeProfile(updatedProfile),
        auth,
      });
    } catch (error) {
      const failedProfile = await prisma.polymarketProfile.upsert({
        where: { workspaceId: workspace.id },
        update: { credentialsLastError: error.message },
        create: {
          workspaceId: workspace.id,
          credentialsLastError: error.message,
        },
      });

      return reply.code(400).send({
        error: 'Bad Request',
        message: error.message,
        settings: serializeProfile(failedProfile),
      });
    }
  });

  fastify.get('/trading/summary', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = tradingSummaryQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const profile = await prisma.polymarketProfile.findUnique({
      where: { workspaceId: workspace.id },
    });

    try {
      const summary = await getTradingSummary(profile, parsed.data);
      return reply.send({
        workspaceId: workspace.id,
        tier: workspace.subTier,
        requiresApproval: workspace.subTier === 'STARTER',
        summary,
      });
    } catch (error) {
      return reply.code(400).send({ error: 'Bad Request', message: error.message });
    }
  });

  fastify.get('/trading/open-orders', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = tradingSummaryQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const profile = await prisma.polymarketProfile.findUnique({
      where: { workspaceId: workspace.id },
    });

    try {
      const openOrders = await listTradingOpenOrders(profile, parsed.data);
      return reply.send({
        workspaceId: workspace.id,
        tier: workspace.subTier,
        openOrders,
      });
    } catch (error) {
      return reply.code(400).send({ error: 'Bad Request', message: error.message });
    }
  });

  fastify.get('/trading/audit', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = auditQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const audits = await prisma.polymarketTradeAudit.findMany({
      where: { workspaceId: workspace.id, ownerId },
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit || 20,
    });

    return reply.send({
      workspaceId: workspace.id,
      tier: workspace.subTier,
      audits: audits.map(serializeTradeAuditEntry),
    });
  });

  fastify.post('/trading/preview', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = orderIntentSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const profile = await prisma.polymarketProfile.findUnique({
      where: { workspaceId: workspace.id },
    });
    const requiresApproval = workspace.subTier === 'STARTER';

    try {
      const result = await previewManualTrade(profile, parsed.data, { requiresApproval });
      const audit = await createTradeAudit({
        workspaceId: workspace.id,
        ownerId,
        action: 'PREVIEW',
        status: 'SUCCESS',
        requestPayload: result.preview,
        responsePayload: result.preview.order,
        approvalRequired: requiresApproval,
      });

      return reply.send({
        workspaceId: workspace.id,
        tier: workspace.subTier,
        requiresApproval,
        preview: result.preview,
        audit,
      });
    } catch (error) {
      const audit = await createTradeAudit({
        workspaceId: workspace.id,
        ownerId,
        action: 'PREVIEW',
        status: 'FAILED',
        requestPayload: parsed.data,
        errorMessage: error.message,
        approvalRequired: requiresApproval,
      });

      return reply.code(400).send({
        error: 'Bad Request',
        message: error.message,
        audit,
      });
    }
  });

  fastify.post('/trading/orders', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = orderIntentSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const profile = await prisma.polymarketProfile.findUnique({
      where: { workspaceId: workspace.id },
    });
    const requiresApproval = workspace.subTier === 'STARTER';

    try {
      const result = await placeManualTrade(profile, parsed.data, { requiresApproval });
      const audit = await createTradeAudit({
        workspaceId: workspace.id,
        ownerId,
        action: 'PLACE_ORDER',
        status: 'SUCCESS',
        requestPayload: result.preview,
        responsePayload: result.response,
        approvalRequired: requiresApproval,
      });

      return reply.send({
        message: 'Order Polymarket berhasil dikirim.',
        workspaceId: workspace.id,
        tier: workspace.subTier,
        requiresApproval,
        preview: result.preview,
        order: result.response,
        audit,
      });
    } catch (error) {
      const audit = await createTradeAudit({
        workspaceId: workspace.id,
        ownerId,
        action: 'PLACE_ORDER',
        status: requiresApproval && !parsed.data.approvalConfirmed ? 'REJECTED' : 'FAILED',
        requestPayload: parsed.data,
        errorMessage: error.message,
        approvalRequired: requiresApproval,
      });

      return reply.code(400).send({
        error: 'Bad Request',
        message: error.message,
        audit,
      });
    }
  });

  fastify.post('/trading/orders/cancel', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = cancelOrderSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const profile = await prisma.polymarketProfile.findUnique({
      where: { workspaceId: workspace.id },
    });
    const requiresApproval = workspace.subTier === 'STARTER';

    try {
      const result = await cancelManualTrade(profile, parsed.data.orderId);
      const audit = await createTradeAudit({
        workspaceId: workspace.id,
        ownerId,
        action: 'CANCEL_ORDER',
        status: 'SUCCESS',
        requestPayload: parsed.data,
        responsePayload: result.response,
        approvalRequired: requiresApproval,
      });

      return reply.send({
        message: 'Order Polymarket berhasil dibatalkan.',
        workspaceId: workspace.id,
        tier: workspace.subTier,
        orderId: parsed.data.orderId,
        result: result.response,
        audit,
      });
    } catch (error) {
      const audit = await createTradeAudit({
        workspaceId: workspace.id,
        ownerId,
        action: 'CANCEL_ORDER',
        status: 'FAILED',
        requestPayload: parsed.data,
        errorMessage: error.message,
        approvalRequired: requiresApproval,
      });

      return reply.code(400).send({
        error: 'Bad Request',
        message: error.message,
        audit,
      });
    }
  });

  fastify.get('/markets', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = marketsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspaceId, ...query } = parsed.data;
    const workspace = await assertPolymarketReadAccess(ownerId, workspaceId, reply);
    if (!workspace) return;

    const markets = await listPolymarketMarkets({
      ...query,
      active: toBoolean(query.active),
      closed: toBoolean(query.closed),
      ascending: toBoolean(query.ascending),
      related_tags: toBoolean(query.related_tags),
    });

    return reply.send({
      workspaceId: workspace.id,
      tier: workspace.subTier,
      markets,
    });
  });

  fastify.get('/markets/slug/:slug', async (request, reply) => {
    const { ownerId } = request.user;
    const queryParsed = workspaceQuerySchema.safeParse(request.query);
    const paramsParsed = z.object({ slug: z.string().min(1).max(200) }).safeParse(request.params);

    if (!queryParsed.success || !paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, queryParsed.data.workspaceId, reply);
    if (!workspace) return;

    const market = await getPolymarketMarketBySlug(paramsParsed.data.slug);
    return reply.send({ workspaceId: workspace.id, tier: workspace.subTier, market });
  });

  fastify.get('/tags', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = workspaceQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const tags = await listPolymarketTags();
    return reply.send({ workspaceId: workspace.id, tier: workspace.subTier, tags });
  });

  fastify.get('/sports', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = workspaceQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, parsed.data.workspaceId, reply);
    if (!workspace) return;

    const sports = await listPolymarketSports();
    return reply.send({ workspaceId: workspace.id, tier: workspace.subTier, sports });
  });

  fastify.get('/orderbook/:tokenId', async (request, reply) => {
    const { ownerId } = request.user;
    const queryParsed = workspaceQuerySchema.safeParse(request.query);
    const paramsParsed = z.object({ tokenId: z.string().min(1).max(200) }).safeParse(request.params);

    if (!queryParsed.success || !paramsParsed.success) {
      return reply.code(400).send({ error: 'Validation error' });
    }

    const workspace = await assertPolymarketReadAccess(ownerId, queryParsed.data.workspaceId, reply);
    if (!workspace) return;

    const orderbook = await getPolymarketOrderBook(paramsParsed.data.tokenId);
    return reply.send({ workspaceId: workspace.id, tier: workspace.subTier, orderbook });
  });

  fastify.get('/positions', async (request, reply) => {
    const { ownerId } = request.user;
    const parsed = positionsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { workspaceId, address, ...query } = parsed.data;
    const workspace = await assertPolymarketReadAccess(ownerId, workspaceId, reply);
    if (!workspace) return;

    const profile = await prisma.polymarketProfile.findUnique({
      where: { workspaceId: workspace.id },
    });

    const resolvedAddress = address || profile?.apiAddress || profile?.funderAddress || profile?.accountAddress || null;
    if (!resolvedAddress) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Alamat Polymarket belum diset. Simpan dulu di settings Polymarket.',
      });
    }

    const positions = await listPolymarketPositions(resolvedAddress, query);
    return reply.send({
      workspaceId: workspace.id,
      tier: workspace.subTier,
      address: resolvedAddress,
      settings: serializeProfile(profile),
      positions,
    });
  });
}

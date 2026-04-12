import { z } from 'zod';

const ENV_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const AUTOPILOT_LIVE_EXECUTION_ENABLED = ENV_TRUE_VALUES.has(
  String(process.env.POLYMARKET_AUTOPILOT_LIVE_EXECUTION_ENABLED || '').trim().toLowerCase(),
);
export const AUTOPILOT_SCHEDULER_ENABLED = true;
export const POLYMARKET_AUTOPILOT_SKILL_KEY = 'polymarket-growth-autopilot';

export const AUTOPILOT_STRATEGY_TYPES = [
  'PRICE_THRESHOLD_REVERSION',
  'RANGE_MAKER',
  'EVENT_MOMENTUM',
];

const STRATEGY_TYPE_ENUM = z.enum(AUTOPILOT_STRATEGY_TYPES);
const SIDE_MODE_ENUM = z.enum(['BUY_ONLY', 'SELL_ONLY', 'BOTH']);
const REFERENCE_PRICE_SOURCE_ENUM = z.enum(['LAST_TRADE', 'BEST_BID', 'BEST_ASK']);

function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

function toBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return value;
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

const stringListSchema = z.preprocess(
  normalizeStringList,
  z.array(z.string().min(1).max(200)).max(100).default([]),
);

const booleanSchema = z.preprocess(toBoolean, z.boolean());
const positiveNumberSchema = z.preprocess(toNumber, z.number().positive());
const nonNegativeNumberSchema = z.preprocess(toNumber, z.number().nonnegative());
const positiveIntSchema = z.preprocess(toNumber, z.number().int().positive());

function positiveNumberMaxSchema(max) {
  return z.preprocess(toNumber, z.number().positive().max(max));
}

function positiveIntRangeSchema(min, max) {
  return z.preprocess(toNumber, z.number().int().positive().min(min).max(max));
}

const priceThresholdStrategySchema = z.object({
  sideMode: SIDE_MODE_ENUM,
  referencePriceSource: REFERENCE_PRICE_SOURCE_ENUM,
  buyBelowPrice: positiveNumberMaxSchema(1).optional(),
  sellAbovePrice: positiveNumberMaxSchema(1).optional(),
  orderSizeUsd: positiveNumberSchema,
  maxPositionUsd: positiveNumberSchema,
}).superRefine((value, context) => {
  if (value.sideMode !== 'SELL_ONLY' && !(Number(value.buyBelowPrice) > 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['buyBelowPrice'],
      message: 'buyBelowPrice wajib diisi untuk strategi BUY_ONLY atau BOTH.',
    });
  }

  if (value.sideMode !== 'BUY_ONLY' && !(Number(value.sellAbovePrice) > 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sellAbovePrice'],
      message: 'sellAbovePrice wajib diisi untuk strategi SELL_ONLY atau BOTH.',
    });
  }
});

const rangeMakerStrategySchema = z.object({
  sideMode: SIDE_MODE_ENUM,
  minPrice: positiveNumberMaxSchema(1),
  maxPrice: positiveNumberMaxSchema(1),
  levels: positiveIntRangeSchema(1, 10),
  orderSizeUsd: positiveNumberSchema,
  minSpreadBps: positiveNumberMaxSchema(5000).default(10),
}).superRefine((value, context) => {
  if (Number(value.minPrice) >= Number(value.maxPrice)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxPrice'],
      message: 'maxPrice harus lebih besar dari minPrice.',
    });
  }
});

const eventMomentumStrategySchema = z.object({
  sideMode: SIDE_MODE_ENUM,
  referenceWindowMinutes: positiveIntRangeSchema(1, 1440),
  triggerMoveBps: positiveNumberMaxSchema(20000),
  orderSizeUsd: positiveNumberSchema,
  maxHoldingMinutes: positiveIntRangeSchema(1, 10080),
});

const riskConfigSchema = z.object({
  maxOrderSizeUsd: positiveNumberSchema,
  maxExposurePerMarketUsd: positiveNumberSchema,
  maxTotalExposureUsd: positiveNumberSchema,
  maxOpenOrders: positiveIntRangeSchema(1, 1000),
  maxDailyLossUsd: positiveNumberSchema,
  maxDailyOrderCount: positiveIntRangeSchema(1, 1000),
  marketCooldownSeconds: positiveIntRangeSchema(1, 86400),
  cancelStaleAfterSeconds: positiveIntRangeSchema(1, 604800),
  maxSlippageBps: positiveNumberMaxSchema(10000),
  requirePositiveExpectedValue: booleanSchema.default(false),
});

const marketScopeSchema = z.object({
  allowedTags: stringListSchema.default([]),
  allowedSports: stringListSchema.default([]),
  allowedMarketSlugs: stringListSchema.default([]),
  blockedMarketSlugs: stringListSchema.default([]),
  maxMarketsPerRun: positiveIntRangeSchema(1, 100).default(10),
  minLiquidity: nonNegativeNumberSchema.default(0),
  minVolume24h: nonNegativeNumberSchema.default(0),
  excludeNegRisk: booleanSchema.default(true),
  excludeClosed: booleanSchema.default(true),
  excludeResolved: booleanSchema.default(true),
});

const executionConfigSchema = z.object({
  dryRun: booleanSchema.default(true),
  evaluationIntervalSeconds: positiveIntRangeSchema(60, 86400).default(300),
  maxRuntimeSeconds: positiveIntRangeSchema(10, 3600).default(120),
  cancelStaleOrders: booleanSchema.default(true),
});

export const autopilotConfigBodySchema = z.object({
  workspaceId: z.string().min(1),
  strategyType: STRATEGY_TYPE_ENUM,
  strategyConfig: z.unknown(),
  riskConfig: riskConfigSchema,
  marketScope: marketScopeSchema,
  executionConfig: executionConfigSchema,
});

export const autopilotWorkspaceBodySchema = z.object({
  workspaceId: z.string().min(1),
});

export const autopilotPauseBodySchema = autopilotWorkspaceBodySchema.extend({
  reason: z.string().min(1).max(500).optional(),
});

export const autopilotListQuerySchema = z.object({
  workspaceId: z.string().min(1),
  limit: z.preprocess(toNumber, z.number().int().min(1).max(100).optional()),
  runId: z.string().min(1).optional(),
});

function getStrategySchema(strategyType) {
  switch (strategyType) {
    case 'PRICE_THRESHOLD_REVERSION':
      return priceThresholdStrategySchema;
    case 'RANGE_MAKER':
      return rangeMakerStrategySchema;
    case 'EVENT_MOMENTUM':
      return eventMomentumStrategySchema;
    default:
      return null;
  }
}

export function validateAutopilotConfigPayload(payload, options = {}) {
  const baseParsed = autopilotConfigBodySchema.safeParse(payload);
  if (!baseParsed.success) {
    return {
      success: false,
      errors: baseParsed.error.flatten().fieldErrors,
    };
  }

  const strategySchema = getStrategySchema(baseParsed.data.strategyType);
  const strategyParsed = strategySchema.safeParse(baseParsed.data.strategyConfig);
  if (!strategyParsed.success) {
    return {
      success: false,
      errors: {
        strategyConfig: strategyParsed.error.issues.map((issue) => issue.message),
      },
    };
  }

  const normalized = {
    ...baseParsed.data,
    strategyConfig: strategyParsed.data,
  };

  const validationErrors = [];
  const { riskConfig, marketScope, executionConfig, strategyConfig } = normalized;

  const hasScopeWhitelist =
    marketScope.allowedTags.length > 0
    || marketScope.allowedSports.length > 0
    || marketScope.allowedMarketSlugs.length > 0;

  if (!hasScopeWhitelist) {
    validationErrors.push('Market scope minimal harus memiliki whitelist tag, sport, atau market slug.');
  }

  if (!AUTOPILOT_LIVE_EXECUTION_ENABLED && executionConfig.dryRun !== true) {
    validationErrors.push('Tahap ini hanya mendukung dryRun=true. Live execution belum diaktifkan.');
  }

  if (AUTOPILOT_LIVE_EXECUTION_ENABLED && executionConfig.dryRun !== true && normalized.strategyType !== 'PRICE_THRESHOLD_REVERSION') {
    validationErrors.push('Live execution saat ini baru didukung untuk strategy PRICE_THRESHOLD_REVERSION.');
  }

  if (Number(riskConfig.maxExposurePerMarketUsd) > Number(riskConfig.maxTotalExposureUsd)) {
    validationErrors.push('maxExposurePerMarketUsd tidak boleh lebih besar dari maxTotalExposureUsd.');
  }

  if (Number(strategyConfig.orderSizeUsd) > Number(riskConfig.maxOrderSizeUsd)) {
    validationErrors.push('strategyConfig.orderSizeUsd tidak boleh melebihi riskConfig.maxOrderSizeUsd.');
  }

  if (Number(riskConfig.cancelStaleAfterSeconds) < Number(riskConfig.marketCooldownSeconds)) {
    validationErrors.push('cancelStaleAfterSeconds tidak boleh lebih kecil dari marketCooldownSeconds.');
  }

  if (strategyConfig.maxPositionUsd && Number(strategyConfig.maxPositionUsd) > Number(riskConfig.maxExposurePerMarketUsd)) {
    validationErrors.push('strategyConfig.maxPositionUsd tidak boleh melebihi riskConfig.maxExposurePerMarketUsd.');
  }

  const success = validationErrors.length === 0;

  return {
    success,
    normalized,
    validationErrors,
    nextStatus: success ? 'READY' : 'DRAFT',
    lastValidationError: success ? null : validationErrors.join(' '),
    contract: {
      liveExecutionEnabled: AUTOPILOT_LIVE_EXECUTION_ENABLED,
      schedulerEnabled: AUTOPILOT_SCHEDULER_ENABLED,
    },
  };
}

export function serializeAutopilotConfig(config) {
  if (!config) return null;

  return {
    id: config.id,
    workspaceId: config.workspaceId,
    ownerId: config.ownerId,
    status: config.status,
    strategyType: config.strategyType,
    strategyConfig: config.strategyConfigJson || null,
    riskConfig: config.riskConfigJson || null,
    marketScope: config.marketScopeJson || null,
    executionConfig: config.executionConfigJson || null,
    lastValidatedAt: config.lastValidatedAt?.toISOString?.() || null,
    lastValidationError: config.lastValidationError || null,
    lastRunAt: config.lastRunAt?.toISOString?.() || null,
    pausedReason: config.pausedReason || null,
    emergencyStoppedAt: config.emergencyStoppedAt?.toISOString?.() || null,
    createdAt: config.createdAt?.toISOString?.() || null,
    updatedAt: config.updatedAt?.toISOString?.() || null,
    contract: {
      liveExecutionEnabled: AUTOPILOT_LIVE_EXECUTION_ENABLED,
      schedulerEnabled: AUTOPILOT_SCHEDULER_ENABLED,
    },
  };
}

export function serializeAutopilotRun(run) {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    configId: run.configId || null,
    status: run.status,
    startedAt: run.startedAt?.toISOString?.() || null,
    finishedAt: run.finishedAt?.toISOString?.() || null,
    snapshot: run.snapshotJson || null,
    summary: run.summaryJson || null,
    errorMessage: run.errorMessage || null,
    createdAt: run.createdAt?.toISOString?.() || null,
    updatedAt: run.updatedAt?.toISOString?.() || null,
  };
}

export function serializeAutopilotDecision(decision) {
  return {
    id: decision.id,
    runId: decision.runId || null,
    configId: decision.configId || null,
    workspaceId: decision.workspaceId,
    decisionType: decision.decisionType,
    status: decision.status,
    marketSlug: decision.marketSlug || null,
    tokenId: decision.tokenId || null,
    side: decision.side || null,
    payload: decision.payloadJson || null,
    guardrailResult: decision.guardrailResultJson || null,
    reasonCode: decision.reasonCode || null,
    executedAuditId: decision.executedAuditId || null,
    createdAt: decision.createdAt?.toISOString?.() || null,
    updatedAt: decision.updatedAt?.toISOString?.() || null,
  };
}

export function buildStoredAutopilotPayload(config) {
  if (!config) return null;

  return {
    workspaceId: config.workspaceId,
    strategyType: config.strategyType,
    strategyConfig: config.strategyConfigJson,
    riskConfig: config.riskConfigJson,
    marketScope: config.marketScopeJson,
    executionConfig: config.executionConfigJson,
  };
}
import prisma from './prisma.js';
import {
  getPolymarketMarketBySlug,
  getPolymarketOrderBook,
  listPolymarketPositions,
} from './polymarket-client.js';
import {
  AUTOPILOT_LIVE_EXECUTION_ENABLED,
} from './polymarket-autopilot.js';
import {
  cancelManualTrade,
  getTradingSummary,
  placeManualTrade,
} from './polymarket-trading.js';
import { createTradeAudit } from './polymarket-trade-audit.js';

function parseMaybeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getBestOrderbookPrice(levels, mode) {
  if (!Array.isArray(levels) || !levels.length) return null;

  return levels.reduce((best, level) => {
    const price = normalizeNumber(level?.price);
    if (price === null) return best;
    if (best === null) return price;
    return mode === 'min' ? Math.min(best, price) : Math.max(best, price);
  }, null);
}

function normalizeSummaryNumber(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.+-]/g, '');
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? numeric : 0;
  }
  return 0;
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return Boolean(value);
}

function resolvePreferredAddress(profile) {
  return profile?.apiAddress || profile?.funderAddress || profile?.accountAddress || null;
}

function normalizePosition(position) {
  const tokenId = position?.asset || position?.token_id || position?.conditionId || null;
  const size = normalizeSummaryNumber(position?.size || position?.balance || position?.amount);
  const avgPrice = normalizeNumber(position?.avg_price || position?.average_price);
  const currentValue = normalizeSummaryNumber(position?.current_value || position?.value);

  return {
    tokenId,
    size,
    avgPrice,
    currentValue,
  };
}

function normalizeOpenOrder(order) {
  const price = normalizeNumber(order?.price);
  const size = normalizeSummaryNumber(order?.originalSize || order?.size || order?.sizeMatched);
  const createdAt = order?.createdAt ? new Date(order.createdAt) : null;

  return {
    id: order?.id || null,
    market: order?.market || null,
    assetId: order?.assetId || null,
    side: order?.side || null,
    price,
    size,
    createdAt,
    raw: order,
  };
}

function buildGuardrailResult({
  blocked = false,
  skipped = false,
  reasonCode,
  signalTriggered = false,
  checks = {},
}) {
  return {
    blocked: Boolean(blocked),
    skipped: Boolean(skipped),
    signalTriggered: Boolean(signalTriggered),
    reasonCode,
    checks,
  };
}

function createDecision({
  workspaceId,
  configId,
  decisionType,
  status,
  marketSlug,
  tokenId,
  side,
  payload,
  guardrailResult,
  reasonCode,
}) {
  return {
    workspaceId,
    configId,
    decisionType,
    status,
    marketSlug: marketSlug || null,
    tokenId: tokenId || null,
    side: side || null,
    payloadJson: payload || null,
    guardrailResultJson: guardrailResult || null,
    reasonCode: reasonCode || null,
  };
}

function buildPositionIndex(positions) {
  const index = new Map();
  for (const rawPosition of positions) {
    const position = normalizePosition(rawPosition);
    if (!position.tokenId) continue;
    index.set(position.tokenId, position);
  }
  return index;
}

function getAllowanceValue(value) {
  if (!value) return 0;
  if (value.allowance !== undefined && value.allowance !== null) {
    return normalizeSummaryNumber(value.allowance);
  }
  if (value.allowances && typeof value.allowances === 'object') {
    return Object.values(value.allowances).reduce((max, item) => Math.max(max, normalizeSummaryNumber(item)), 0);
  }
  return 0;
}

function getEstimatedLossUsd(positions) {
  return positions.reduce((total, rawPosition) => {
    const position = normalizePosition(rawPosition);
    if (!position.avgPrice || !position.size || !position.currentValue) return total;
    const costBasis = position.avgPrice * position.size;
    const pnl = position.currentValue - costBasis;
    return pnl < 0 ? total + Math.abs(pnl) : total;
  }, 0);
}

function getOpenOrderNotional(order) {
  return (normalizeSummaryNumber(order?.size) || 0) * (normalizeNumber(order?.price) || 0);
}

function formatOrderInputFromDecision(decision) {
  const payload = decision.payloadJson || {};
  const targetPrice = normalizeNumber(payload.targetPrice);
  const orderSizeUsd = normalizeNumber(payload.orderSizeUsd);
  const size = targetPrice && orderSizeUsd ? orderSizeUsd / targetPrice : null;

  return {
    workspaceId: decision.workspaceId,
    marketSlug: decision.marketSlug,
    marketQuestion: payload.marketQuestion || null,
    outcomeLabel: payload.outcomeLabel || null,
    tokenId: decision.tokenId,
    side: decision.side,
    orderKind: payload.orderKind || 'limit',
    orderType: payload.orderType || 'GTC',
    price: targetPrice,
    size,
    postOnly: false,
  };
}

function isAutopilotLiveRun(config) {
  return AUTOPILOT_LIVE_EXECUTION_ENABLED && normalizeBoolean(config?.executionConfigJson?.dryRun, true) === false;
}

function buildAutopilotOwnedOrderSet(audits) {
  const activeOrders = new Set();

  for (const audit of audits) {
    if (audit.action === 'PLACE_ORDER' && audit.status === 'SUCCESS' && audit.responseOrderId) {
      activeOrders.add(String(audit.responseOrderId));
    }

    if (audit.action === 'CANCEL_ORDER' && audit.status === 'SUCCESS') {
      const cancelledOrderId = audit.requestJson?.orderId || audit.responseJson?.orderID || audit.responseJson?.orderId || null;
      if (cancelledOrderId) activeOrders.delete(String(cancelledOrderId));
    }
  }

  return activeOrders;
}

function getStartOfDayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function buildWorkspaceSnapshot(profile, config) {
  const preferredAddress = resolvePreferredAddress(profile);
  const [summary, positions] = await Promise.all([
    getTradingSummary(profile).catch((error) => ({ error: error.message })),
    preferredAddress
      ? listPolymarketPositions(preferredAddress, { limit: 100, offset: 0 }).catch((error) => ({ error: error.message }))
      : Promise.resolve([]),
  ]);

  return {
    preferredAddress,
    summary,
    positions,
    config: {
      strategyType: config.strategyType,
      strategyConfig: config.strategyConfigJson,
      riskConfig: config.riskConfigJson,
      marketScope: config.marketScopeJson,
      executionConfig: config.executionConfigJson,
    },
  };
}

async function evaluatePriceThresholdReversion({ workspaceId, config, snapshot }) {
  const strategyConfig = config.strategyConfigJson || {};
  const riskConfig = config.riskConfigJson || {};
  const marketScope = config.marketScopeJson || {};
  const openOrders = Array.isArray(snapshot.summary?.openOrders) ? snapshot.summary.openOrders : [];
  const openOrderCount = openOrders.length;
  const allowedSlugs = Array.isArray(marketScope.allowedMarketSlugs) ? marketScope.allowedMarketSlugs : [];
  const blockedSlugs = new Set(Array.isArray(marketScope.blockedMarketSlugs) ? marketScope.blockedMarketSlugs : []);
  const marketSlugs = allowedSlugs.slice(0, Number(marketScope.maxMarketsPerRun) || 10);
  const decisions = [];
  const marketsScanned = [];

  for (const slug of marketSlugs) {
    const market = await getPolymarketMarketBySlug(slug).catch((error) => ({ error: error.message }));
    if (market?.error) {
      decisions.push(createDecision({
        workspaceId,
        configId: config.id,
        decisionType: 'SKIP',
        status: 'FAILED',
        marketSlug: slug,
        guardrailResult: buildGuardrailResult({ skipped: true, reasonCode: 'FAILED_MARKET_LOOKUP' }),
        reasonCode: 'FAILED_MARKET_LOOKUP',
        payload: { error: market.error },
      }));
      continue;
    }

    marketsScanned.push(slug);

    const outcomes = parseMaybeArray(market.outcomes);
    const outcomePrices = parseMaybeArray(market.outcomePrices).map((value) => normalizeNumber(value));
    const clobTokenIds = parseMaybeArray(market.clobTokenIds);
    const primaryOutcome = outcomes[0] || 'Outcome';
    const primaryTokenId = clobTokenIds[0] || null;
    const currentPrice = outcomePrices[0];
    const liquidity = normalizeSummaryNumber(market.liquidityNum || market.liquidity);
    const volume24h = normalizeSummaryNumber(market.volume24hr || market.volume24hrClob);

    if (!primaryTokenId || currentPrice === null) {
      decisions.push(createDecision({
        workspaceId,
        configId: config.id,
        decisionType: 'SKIP',
        status: 'SKIPPED',
        marketSlug: slug,
        tokenId: primaryTokenId,
        payload: { outcome: primaryOutcome, currentPrice },
        guardrailResult: buildGuardrailResult({ skipped: true, reasonCode: 'SKIPPED_INCOMPLETE_MARKET_DATA' }),
        reasonCode: 'SKIPPED_INCOMPLETE_MARKET_DATA',
      }));
      continue;
    }

    const orderbook = await getPolymarketOrderBook(primaryTokenId).catch((error) => ({ error: error.message }));
    const negRisk = Boolean(orderbook?.neg_risk);
    const blockedByNegRisk = Boolean(marketScope.excludeNegRisk) && negRisk;
    const blockedByOpenOrderCap = openOrderCount >= Number(riskConfig.maxOpenOrders || 0);
    const blockedBySize = Number(strategyConfig.orderSizeUsd || 0) > Number(riskConfig.maxOrderSizeUsd || 0);
    const blockedByBlacklist = blockedSlugs.has(slug);
    const blockedByLiquidity = liquidity < Number(marketScope.minLiquidity || 0);
    const blockedByVolume = volume24h < Number(marketScope.minVolume24h || 0);
    const blockedByClosed = normalizeBoolean(marketScope.excludeClosed, true) && Boolean(market.closed);
    const blockedByResolved = normalizeBoolean(marketScope.excludeResolved, true) && Boolean(market.resolved);
    const checks = {
      negRisk,
      liquidity,
      volume24h,
      blockedByNegRisk,
      blockedByOpenOrderCap,
      blockedBySize,
      blockedByBlacklist,
      blockedByLiquidity,
      blockedByVolume,
      blockedByClosed,
      blockedByResolved,
      openOrderCount,
      currentPrice,
      buyBelowPrice: strategyConfig.buyBelowPrice ?? null,
      sellAbovePrice: strategyConfig.sellAbovePrice ?? null,
    };

    if (blockedByNegRisk || blockedByOpenOrderCap || blockedBySize || blockedByBlacklist || blockedByLiquidity || blockedByVolume || blockedByClosed || blockedByResolved) {
      let reasonCode = 'BLOCKED_GUARDRAIL';
      if (blockedByNegRisk) reasonCode = 'BLOCKED_NEG_RISK_MARKET';
      else if (blockedByOpenOrderCap) reasonCode = 'BLOCKED_MAX_OPEN_ORDERS';
      else if (blockedBySize) reasonCode = 'BLOCKED_MAX_ORDER_SIZE';
      else if (blockedByBlacklist) reasonCode = 'BLOCKED_MARKET_BLACKLISTED';
      else if (blockedByLiquidity) reasonCode = 'BLOCKED_MIN_LIQUIDITY';
      else if (blockedByVolume) reasonCode = 'BLOCKED_MIN_VOLUME_24H';
      else if (blockedByClosed) reasonCode = 'BLOCKED_MARKET_CLOSED';
      else if (blockedByResolved) reasonCode = 'BLOCKED_MARKET_RESOLVED';

      decisions.push(createDecision({
        workspaceId,
        configId: config.id,
        decisionType: 'SKIP',
        status: 'BLOCKED',
        marketSlug: slug,
        tokenId: primaryTokenId,
        payload: { outcome: primaryOutcome, currentPrice },
        guardrailResult: buildGuardrailResult({ blocked: true, reasonCode, checks }),
        reasonCode,
      }));
      continue;
    }

    let side = null;
    if (strategyConfig.sideMode !== 'SELL_ONLY' && currentPrice <= Number(strategyConfig.buyBelowPrice || 0)) {
      side = 'BUY';
    } else if (strategyConfig.sideMode !== 'BUY_ONLY' && currentPrice >= Number(strategyConfig.sellAbovePrice || 0)) {
      side = 'SELL';
    }

    if (!side) {
      decisions.push(createDecision({
        workspaceId,
        configId: config.id,
        decisionType: 'SKIP',
        status: 'SKIPPED',
        marketSlug: slug,
        tokenId: primaryTokenId,
        payload: { outcome: primaryOutcome, currentPrice },
        guardrailResult: buildGuardrailResult({ skipped: true, reasonCode: 'SKIPPED_SIGNAL_NOT_TRIGGERED', checks }),
        reasonCode: 'SKIPPED_SIGNAL_NOT_TRIGGERED',
      }));
      continue;
    }

    const targetPrice = side === 'BUY'
      ? Number(strategyConfig.buyBelowPrice || currentPrice)
      : Number(strategyConfig.sellAbovePrice || currentPrice);

    decisions.push(createDecision({
      workspaceId,
      configId: config.id,
      decisionType: 'PLACE_ORDER',
      status: 'PROPOSED',
      marketSlug: slug,
      tokenId: primaryTokenId,
      side,
      payload: {
        strategyType: config.strategyType,
        mode: isAutopilotLiveRun(config) ? 'LIVE' : 'DRY_RUN',
        marketQuestion: market.question || null,
        outcomeLabel: primaryOutcome,
        currentPrice,
        targetPrice,
        orderKind: 'limit',
        orderType: 'GTC',
        orderSizeUsd: Number(strategyConfig.orderSizeUsd || 0),
        liquidity,
        volume24h,
      },
      guardrailResult: buildGuardrailResult({ signalTriggered: true, reasonCode: 'PROPOSAL_READY', checks }),
      reasonCode: 'PROPOSAL_READY',
    }));
  }

  return {
    strategyEvaluated: 'PRICE_THRESHOLD_REVERSION',
    marketsScanned,
    decisions,
  };
}

async function evaluateStrategy({ workspaceId, config, snapshot }) {
  switch (config.strategyType) {
    case 'PRICE_THRESHOLD_REVERSION':
      return evaluatePriceThresholdReversion({ workspaceId, config, snapshot });
    case 'RANGE_MAKER':
    case 'EVENT_MOMENTUM':
    default:
      return {
        strategyEvaluated: config.strategyType,
        marketsScanned: [],
        decisions: [createDecision({
          workspaceId,
          configId: config.id,
          decisionType: 'SKIP',
          status: 'SKIPPED',
          guardrailResult: buildGuardrailResult({ skipped: true, reasonCode: 'STRATEGY_NOT_IMPLEMENTED_YET' }),
          reasonCode: 'STRATEGY_NOT_IMPLEMENTED_YET',
          payload: { strategyType: config.strategyType },
        })],
      };
  }
}

async function persistInitialDecisions(runId, decisions) {
  const persisted = [];
  for (const decision of decisions) {
    const created = await prisma.polymarketAutopilotDecision.create({
      data: {
        ...decision,
        runId,
      },
    });
    persisted.push(created);
  }
  return persisted;
}

function buildExecutionChecks({
  decision,
  config,
  snapshot,
  todayOrderCount,
  lastMarketAudit,
  matchingPosition,
  marketExposureUsd,
  totalExposureUsd,
  orderSizeUsd,
  targetPrice,
}) {
  const riskConfig = config.riskConfigJson || {};
  const strategyConfig = config.strategyConfigJson || {};
  const executionConfig = config.executionConfigJson || {};
  const collateralBalance = normalizeSummaryNumber(snapshot.summary?.collateral?.balance);
  const collateralAllowance = getAllowanceValue(snapshot.summary?.collateral);
  const conditionalAllowance = getAllowanceValue(snapshot.summary?.conditional);
  const estimatedLossUsd = getEstimatedLossUsd(Array.isArray(snapshot.positions) ? snapshot.positions : []);
  const bestAsk = getBestOrderbookPrice(snapshot.latestOrderBook?.asks, 'min');
  const bestBid = getBestOrderbookPrice(snapshot.latestOrderBook?.bids, 'max');

  let slippageBps = 0;
  if (decision.side === 'BUY' && bestAsk && targetPrice) {
    slippageBps = Math.abs(((targetPrice - bestAsk) / bestAsk) * 10000);
  } else if (decision.side === 'SELL' && bestBid && targetPrice) {
    slippageBps = Math.abs(((bestBid - targetPrice) / bestBid) * 10000);
  }

  const estimatedNewMarketExposure = decision.side === 'BUY'
    ? marketExposureUsd + orderSizeUsd
    : Math.max(0, marketExposureUsd - orderSizeUsd);
  const estimatedNewTotalExposure = decision.side === 'BUY'
    ? totalExposureUsd + orderSizeUsd
    : Math.max(0, totalExposureUsd - orderSizeUsd);
  const cooldownDeadline = lastMarketAudit
    ? new Date(lastMarketAudit.createdAt).getTime() + (Number(riskConfig.marketCooldownSeconds || 0) * 1000)
    : 0;
  const cooldownActive = cooldownDeadline > Date.now();

  let expectedEdgeUsd = 0;
  if (decision.side === 'BUY') {
    expectedEdgeUsd = Math.max(0, Number(strategyConfig.sellAbovePrice || targetPrice) - Number(targetPrice || 0)) * (targetPrice ? orderSizeUsd / targetPrice : 0);
  } else {
    expectedEdgeUsd = Math.max(0, Number(targetPrice || 0) - Number(strategyConfig.buyBelowPrice || 0)) * (targetPrice ? orderSizeUsd / targetPrice : 0);
  }

  return {
    collateralBalance,
    collateralAllowance,
    conditionalAllowance,
    estimatedLossUsd,
    todayOrderCount,
    estimatedNewMarketExposure,
    estimatedNewTotalExposure,
    cooldownActive,
    cooldownDeadline,
    slippageBps,
    expectedEdgeUsd,
    cancelStaleOrders: normalizeBoolean(executionConfig.cancelStaleOrders, true),
    matchingPosition,
  };
}

function determineExecutionBlockReason({ decision, checks, config, orderSizeUsd, shareSize }) {
  const riskConfig = config.riskConfigJson || {};

  if (orderSizeUsd > Number(riskConfig.maxOrderSizeUsd || 0)) return 'BLOCKED_MAX_ORDER_SIZE';
  if (checks.todayOrderCount >= Number(riskConfig.maxDailyOrderCount || 0)) return 'BLOCKED_MAX_DAILY_ORDER_COUNT';
  if (checks.estimatedLossUsd > Number(riskConfig.maxDailyLossUsd || 0)) return 'BLOCKED_MAX_DAILY_LOSS';
  if (checks.cooldownActive) return 'BLOCKED_MARKET_COOLDOWN';
  if (checks.slippageBps > Number(riskConfig.maxSlippageBps || 0)) return 'BLOCKED_MAX_SLIPPAGE';
  if (decision.side === 'BUY' && checks.collateralBalance < orderSizeUsd) return 'BLOCKED_INSUFFICIENT_COLLATERAL_BALANCE';
  if (decision.side === 'BUY' && checks.collateralAllowance > 0 && checks.collateralAllowance < orderSizeUsd) return 'BLOCKED_INSUFFICIENT_COLLATERAL_ALLOWANCE';
  if (decision.side === 'BUY' && checks.estimatedNewMarketExposure > Number(riskConfig.maxExposurePerMarketUsd || 0)) return 'BLOCKED_MAX_MARKET_EXPOSURE';
  if (decision.side === 'BUY' && checks.estimatedNewTotalExposure > Number(riskConfig.maxTotalExposureUsd || 0)) return 'BLOCKED_MAX_TOTAL_EXPOSURE';
  if (decision.side === 'SELL' && (!checks.matchingPosition || checks.matchingPosition.size <= 0)) return 'BLOCKED_NO_POSITION_TO_SELL';
  if (decision.side === 'SELL' && checks.matchingPosition && shareSize > checks.matchingPosition.size) return 'BLOCKED_SELL_SIZE_EXCEEDS_POSITION';
  if (decision.side === 'SELL' && checks.conditionalAllowance > 0 && shareSize > checks.conditionalAllowance) return 'BLOCKED_INSUFFICIENT_CONDITIONAL_ALLOWANCE';
  if ((config.riskConfigJson?.requirePositiveExpectedValue) && checks.expectedEdgeUsd <= 0) return 'BLOCKED_NON_POSITIVE_EXPECTED_VALUE';
  return null;
}

async function cancelAutopilotOrder({ workspaceId, ownerId, profile, configId, runId, marketSlug, order, reasonCode }) {
  const decision = await prisma.polymarketAutopilotDecision.create({
    data: {
      workspaceId,
      configId,
      runId,
      decisionType: 'CANCEL_ORDER',
      status: 'PROPOSED',
      marketSlug: marketSlug || order.market || null,
      tokenId: order.assetId || null,
      side: order.side || null,
      payloadJson: {
        orderId: order.id,
        marketSlug: marketSlug || order.market || null,
        tokenId: order.assetId || null,
      },
      guardrailResultJson: buildGuardrailResult({ signalTriggered: true, reasonCode }),
      reasonCode,
    },
  });

  try {
    const result = await cancelManualTrade(profile, order.id);
    const audit = await createTradeAudit({
      workspaceId,
      ownerId,
      source: 'AUTOPILOT',
      action: 'CANCEL_ORDER',
      status: 'SUCCESS',
      requestPayload: {
        workspaceId,
        orderId: order.id,
        marketSlug: marketSlug || order.market || null,
        tokenId: order.assetId || null,
      },
      responsePayload: result.response,
      runId,
      decisionId: decision.id,
      reasonCode,
    });

    return prisma.polymarketAutopilotDecision.update({
      where: { id: decision.id },
      data: {
        status: 'EXECUTED',
        executedAuditId: audit.id,
        payloadJson: {
          ...(decision.payloadJson || {}),
          cancelResult: result.response,
          auditId: audit.id,
        },
      },
    });
  } catch (error) {
    const audit = await createTradeAudit({
      workspaceId,
      ownerId,
      source: 'AUTOPILOT',
      action: 'CANCEL_ORDER',
      status: 'FAILED',
      requestPayload: {
        workspaceId,
        orderId: order.id,
        marketSlug: marketSlug || order.market || null,
        tokenId: order.assetId || null,
      },
      errorMessage: error.message,
      runId,
      decisionId: decision.id,
      reasonCode,
    });

    return prisma.polymarketAutopilotDecision.update({
      where: { id: decision.id },
      data: {
        status: 'FAILED',
        executedAuditId: audit.id,
        payloadJson: {
          ...(decision.payloadJson || {}),
          cancelError: error.message,
          auditId: audit.id,
        },
      },
    });
  }
}

async function executeLiveDecisions({ workspaceId, config, run, profile, snapshot, persistedDecisions }) {
  const todayStart = getStartOfDayUtc();
  const [todayOrderCount, recentAutopilotAudits, recentMarketAudits] = await Promise.all([
    prisma.polymarketTradeAudit.count({
      where: {
        workspaceId,
        source: 'AUTOPILOT',
        action: 'PLACE_ORDER',
        status: 'SUCCESS',
        createdAt: { gte: todayStart },
      },
    }),
    prisma.polymarketTradeAudit.findMany({
      where: {
        workspaceId,
        source: 'AUTOPILOT',
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    prisma.polymarketTradeAudit.findMany({
      where: {
        workspaceId,
        source: 'AUTOPILOT',
        createdAt: { gte: todayStart },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ]);

  const activeAutopilotOrderIds = buildAutopilotOwnedOrderSet(recentAutopilotAudits);
  const positions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
  const positionIndex = buildPositionIndex(positions);
  let currentOpenOrders = Array.isArray(snapshot.summary?.openOrders)
    ? snapshot.summary.openOrders.map(normalizeOpenOrder)
    : [];
  let executedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;

  for (const decision of persistedDecisions) {
    if (decision.decisionType !== 'PLACE_ORDER' || decision.status !== 'PROPOSED') continue;

    const input = formatOrderInputFromDecision(decision);
    const orderSizeUsd = normalizeNumber(decision.payloadJson?.orderSizeUsd) || 0;
    const targetPrice = normalizeNumber(input.price) || 0;
    const shareSize = normalizeNumber(input.size) || 0;
    const matchingPosition = positionIndex.get(decision.tokenId) || null;
    const marketOpenOrders = currentOpenOrders.filter((order) => order.assetId === decision.tokenId);
    const marketExposureUsd = (matchingPosition?.currentValue || 0) + marketOpenOrders.reduce((sum, order) => sum + getOpenOrderNotional(order), 0);
    const totalExposureUsd = Array.from(positionIndex.values()).reduce((sum, position) => sum + (position.currentValue || 0), 0)
      + currentOpenOrders.reduce((sum, order) => sum + getOpenOrderNotional(order), 0);

    const freshOrderBook = await getPolymarketOrderBook(decision.tokenId).catch(() => null);
    snapshot.latestOrderBook = freshOrderBook;
    const lastMarketAudit = recentMarketAudits.find((audit) => audit.marketSlug === decision.marketSlug && audit.action === 'PLACE_ORDER' && audit.status === 'SUCCESS');

    const checks = buildExecutionChecks({
      decision,
      config,
      snapshot,
      todayOrderCount: todayOrderCount + executedCount,
      lastMarketAudit,
      matchingPosition,
      marketExposureUsd,
      totalExposureUsd,
      orderSizeUsd,
      targetPrice,
    });

    const blockReason = determineExecutionBlockReason({
      decision,
      checks,
      config,
      orderSizeUsd,
      shareSize,
    });

    if (blockReason) {
      await prisma.polymarketAutopilotDecision.update({
        where: { id: decision.id },
        data: {
          status: 'BLOCKED',
          reasonCode: blockReason,
          guardrailResultJson: buildGuardrailResult({ blocked: true, reasonCode: blockReason, checks }),
        },
      });
      continue;
    }

    const staleThresholdMs = Number(config.riskConfigJson?.cancelStaleAfterSeconds || 0) * 1000;
    const conflictOrders = currentOpenOrders.filter((order) => {
      if (!order.id || !activeAutopilotOrderIds.has(String(order.id))) return false;
      if (order.assetId !== decision.tokenId) return false;
      const stale = staleThresholdMs > 0 && order.createdAt instanceof Date && (Date.now() - order.createdAt.getTime()) >= staleThresholdMs;
      const oppositeSide = order.side && order.side !== decision.side;
      return stale || oppositeSide;
    });

    for (const conflictOrder of conflictOrders) {
      const cancelResult = await cancelAutopilotOrder({
        workspaceId,
        ownerId: config.ownerId,
        profile,
        configId: config.id,
        runId: run.id,
        marketSlug: decision.marketSlug,
        order: conflictOrder,
        reasonCode: 'CANCEL_STALE_OR_CONFLICTING_ORDER',
      });

      if (cancelResult.status === 'EXECUTED') {
        cancelledCount += 1;
        currentOpenOrders = currentOpenOrders.filter((order) => order.id !== conflictOrder.id);
        activeAutopilotOrderIds.delete(String(conflictOrder.id));
      } else {
        failedCount += 1;
      }
    }

    try {
      const result = await placeManualTrade(profile, {
        ...input,
        approvalConfirmed: true,
      }, { requiresApproval: false });

      const audit = await createTradeAudit({
        workspaceId,
        ownerId: config.ownerId,
        source: 'AUTOPILOT',
        action: 'PLACE_ORDER',
        status: 'SUCCESS',
        requestPayload: result.preview,
        responsePayload: result.response,
        runId: run.id,
        decisionId: decision.id,
        reasonCode: decision.reasonCode,
      });

      await prisma.polymarketAutopilotDecision.update({
        where: { id: decision.id },
        data: {
          status: 'EXECUTED',
          executedAuditId: audit.id,
          payloadJson: {
            ...(decision.payloadJson || {}),
            preview: result.preview,
            executionResponse: result.response,
            auditId: audit.id,
          },
        },
      });

      executedCount += 1;
      activeAutopilotOrderIds.add(String(audit.responseOrderId || result.response?.orderID || result.response?.orderId || ''));
      currentOpenOrders.push(normalizeOpenOrder({
        id: audit.responseOrderId || result.response?.orderID || result.response?.orderId,
        market: decision.marketSlug,
        assetId: decision.tokenId,
        side: decision.side,
        price: input.price,
        originalSize: input.size,
        createdAt: new Date().toISOString(),
      }));
    } catch (error) {
      const audit = await createTradeAudit({
        workspaceId,
        ownerId: config.ownerId,
        source: 'AUTOPILOT',
        action: 'PLACE_ORDER',
        status: 'FAILED',
        requestPayload: input,
        errorMessage: error.message,
        runId: run.id,
        decisionId: decision.id,
        reasonCode: decision.reasonCode,
      });

      await prisma.polymarketAutopilotDecision.update({
        where: { id: decision.id },
        data: {
          status: 'FAILED',
          executedAuditId: audit.id,
          payloadJson: {
            ...(decision.payloadJson || {}),
            executionError: error.message,
            auditId: audit.id,
          },
        },
      });
      failedCount += 1;
    }
  }

  return {
    executedCount,
    failedCount,
    cancelledCount,
  };
}

function buildRunSummary({ evaluation, persistedDecisions, liveMode, liveResult }) {
  const proposedCount = persistedDecisions.filter((item) => item.status === 'PROPOSED').length;
  const blockedCount = persistedDecisions.filter((item) => item.status === 'BLOCKED').length;
  const skippedCount = persistedDecisions.filter((item) => item.status === 'SKIPPED').length;
  const failedCount = persistedDecisions.filter((item) => item.status === 'FAILED').length;
  const executedCount = persistedDecisions.filter((item) => item.status === 'EXECUTED' && item.decisionType === 'PLACE_ORDER').length;
  const cancelledCount = persistedDecisions.filter((item) => item.status === 'EXECUTED' && item.decisionType === 'CANCEL_ORDER').length;

  let status = 'COMPLETED_NO_ACTION';
  if (liveMode && (executedCount > 0 || cancelledCount > 0)) {
    status = 'COMPLETED';
  } else if (!liveMode && proposedCount > 0) {
    status = 'COMPLETED';
  } else if (failedCount > 0 && executedCount === 0 && proposedCount === 0) {
    status = 'FAILED';
  } else if (blockedCount > 0 && skippedCount === 0 && failedCount === 0 && executedCount === 0) {
    status = 'BLOCKED_BY_GUARDRAIL';
  }

  let message = 'Run autopilot selesai tanpa aksi.';
  if (liveMode) {
    if (executedCount > 0) {
      message = `Live autopilot mengeksekusi ${executedCount} order dan ${cancelledCount} cancel.`;
    } else if (failedCount > 0) {
      message = 'Live autopilot gagal mengeksekusi order yang dipilih.';
    } else if (blockedCount > 0) {
      message = 'Live autopilot diblokir guardrail sebelum eksekusi.';
    }
  } else if (proposedCount > 0) {
    message = 'Dry-run menghasilkan proposal aksi tanpa eksekusi live.';
  }

  return {
    status,
    summary: {
      strategyEvaluated: evaluation.strategyEvaluated,
      liveMode,
      marketsScanned: evaluation.marketsScanned,
      decisionCounts: {
        proposed: proposedCount,
        blocked: blockedCount,
        skipped: skippedCount,
        failed: failedCount,
        executed: executedCount,
        cancelled: cancelledCount,
      },
      execution: liveResult || null,
      message,
    },
  };
}

export async function runPolymarketAutopilotDryRun({ workspaceId, trigger = 'MANUAL', requestedBy = null }) {
  const config = await prisma.polymarketAutopilotConfig.findUnique({
    where: { workspaceId },
  });

  if (!config) {
    throw new Error('Config autopilot Polymarket belum dibuat.');
  }

  const liveMode = isAutopilotLiveRun(config);
  const now = new Date();
  const run = await prisma.polymarketAutopilotRun.create({
    data: {
      workspaceId,
      configId: config.id,
      status: 'RUNNING',
      startedAt: now,
      snapshotJson: {
        trigger,
        requestedBy,
        phase: liveMode ? 'live' : 'dry-run',
      },
    },
  });

  try {
    const profile = await prisma.polymarketProfile.findUnique({ where: { workspaceId } });
    const snapshot = await buildWorkspaceSnapshot(profile, config);
    const evaluation = await evaluateStrategy({ workspaceId, config, snapshot });
    const initialDecisions = await persistInitialDecisions(run.id, evaluation.decisions);

    let liveResult = null;
    if (liveMode) {
      liveResult = await executeLiveDecisions({
        workspaceId,
        config,
        run,
        profile,
        snapshot,
        persistedDecisions: initialDecisions,
      });
    }

    const persistedDecisions = await prisma.polymarketAutopilotDecision.findMany({
      where: { runId: run.id },
      orderBy: { createdAt: 'asc' },
    });

    const { status: nextStatus, summary } = buildRunSummary({
      evaluation,
      persistedDecisions,
      liveMode,
      liveResult,
    });

    const finishedAt = new Date();
    const updatedRun = await prisma.polymarketAutopilotRun.update({
      where: { id: run.id },
      data: {
        status: nextStatus,
        finishedAt,
        snapshotJson: {
          ...snapshot,
          trigger,
          requestedBy,
          phase: liveMode ? 'live' : 'dry-run',
        },
        summaryJson: summary,
      },
    });

    await prisma.polymarketAutopilotConfig.update({
      where: { workspaceId },
      data: { lastRunAt: finishedAt },
    });

    return {
      run: updatedRun,
      decisions: persistedDecisions,
    };
  } catch (error) {
    const failedRun = await prisma.polymarketAutopilotRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: error.message,
        summaryJson: {
          message: liveMode ? 'Live autopilot gagal.' : 'Dry-run autopilot gagal.',
          reasonCode: liveMode ? 'LIVE_RUN_FAILED' : 'DRY_RUN_FAILED',
        },
      },
    });

    return {
      run: failedRun,
      decisions: [],
      error,
    };
  }
}
import prisma from './prisma.js';
import { listPolymarketPositions } from './polymarket-client.js';
import { getTradingSummary } from './polymarket-trading.js';
import {
  recordPolymarketAutopilotHealthCheck,
  serializeAutopilotAlert,
  serializeAutopilotHealthCheck,
  syncPolymarketAutopilotReasonAlerts,
} from './polymarket-autopilot-monitoring.js';
import {
  AUTOPILOT_LIVE_EXECUTION_ENABLED,
  serializeAutopilotConfig,
  serializeAutopilotRun,
} from './polymarket-autopilot.js';

function resolvePreferredAddress(profile) {
  return profile?.apiAddress || profile?.funderAddress || profile?.accountAddress || null;
}

function summarizeOrder(order) {
  return {
    id: order?.id || null,
    market: order?.market || null,
    assetId: order?.assetId || null,
    side: order?.side || null,
    price: order?.price || null,
    originalSize: order?.originalSize || null,
    outcome: order?.outcome || null,
  };
}

function summarizePosition(position) {
  return {
    asset: position?.asset || position?.token_id || position?.conditionId || null,
    size: position?.size || position?.balance || position?.amount || null,
    avgPrice: position?.avg_price || position?.average_price || null,
    currentValue: position?.current_value || position?.value || null,
  };
}

function buildKnownOrderIdSet(audits) {
  const knownOrderIds = new Set();

  for (const audit of audits) {
    if (audit?.responseOrderId) knownOrderIds.add(audit.responseOrderId);
    const nestedOrderId = audit?.responseJson?.orderID || audit?.responseJson?.orderId || audit?.responseJson?.id;
    if (nestedOrderId) knownOrderIds.add(String(nestedOrderId));
  }

  return knownOrderIds;
}

function buildCriticalReason(code, details = {}) {
  return { severity: 'critical', code, details };
}

function buildWarningReason(code, details = {}) {
  return { severity: 'warning', code, details };
}

export async function reconcilePolymarketAutopilotWorkspace({
  workspaceId,
  autoStopOnCritical = true,
  trigger = 'INTERNAL',
}) {
  const [config, profile, latestRun, recentDecisions, recentAudits] = await Promise.all([
    prisma.polymarketAutopilotConfig.findUnique({ where: { workspaceId } }),
    prisma.polymarketProfile.findUnique({ where: { workspaceId } }),
    prisma.polymarketAutopilotRun.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.polymarketAutopilotDecision.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.polymarketTradeAudit.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  if (!config) {
    throw new Error('Config autopilot Polymarket belum dibuat.');
  }

  const checkedAt = new Date();
  const preferredAddress = resolvePreferredAddress(profile);
  const criticalReasons = [];
  const warningReasons = [];

  let tradingSummary = null;
  let positions = [];
  let exchangeError = null;
  let positionError = null;

  if (!profile?.encryptedPrivateKey || !profile?.encryptedApiKey || !profile?.encryptedApiSecret || !profile?.encryptedApiPassphrase) {
    criticalReasons.push(buildCriticalReason('CRITICAL_MISSING_TRADING_CREDENTIALS'));
  } else if (profile?.credentialsLastError) {
    criticalReasons.push(buildCriticalReason('CRITICAL_CREDENTIALS_LAST_ERROR', { message: profile.credentialsLastError }));
  } else if (!profile?.credentialsLastVerifiedAt) {
    criticalReasons.push(buildCriticalReason('CRITICAL_CREDENTIALS_UNVERIFIED'));
  } else {
    try {
      tradingSummary = await getTradingSummary(profile);
    } catch (error) {
      exchangeError = error.message;
      criticalReasons.push(buildCriticalReason('CRITICAL_TRADING_SUMMARY_FAILED', { message: error.message }));
    }
  }

  if (preferredAddress) {
    try {
      const rawPositions = await listPolymarketPositions(preferredAddress, { limit: 100, offset: 0 });
      positions = Array.isArray(rawPositions) ? rawPositions : [];
    } catch (error) {
      positionError = error.message;
      warningReasons.push(buildWarningReason('WARNING_POSITION_SYNC_FAILED', { message: error.message }));
    }
  } else {
    warningReasons.push(buildWarningReason('WARNING_PREFERRED_ADDRESS_MISSING'));
  }

  const openOrders = Array.isArray(tradingSummary?.openOrders) ? tradingSummary.openOrders : [];
  const successfulAudits = recentAudits.filter((audit) => audit.status === 'SUCCESS');
  const knownOrderIds = buildKnownOrderIdSet(successfulAudits);
  const unknownOpenOrders = openOrders.filter((order) => order?.id && !knownOrderIds.has(String(order.id)));
  const executedDecisionsWithoutAudit = recentDecisions.filter((decision) => decision.executedAuditId && !recentAudits.some((audit) => audit.id === decision.executedAuditId));
  const unexpectedExecutedDecisions = recentDecisions.filter((decision) => decision.status === 'EXECUTED');
  const pendingProposals = recentDecisions.filter((decision) => decision.status === 'PROPOSED' && !decision.executedAuditId);
  const maxOpenOrders = Number(config.riskConfigJson?.maxOpenOrders || 0);
  const failedAuditCount = recentAudits.filter((audit) => audit.status === 'FAILED').length;

  if (unknownOpenOrders.length > 0) {
    criticalReasons.push(buildCriticalReason('CRITICAL_UNKNOWN_OPEN_ORDERS', {
      count: unknownOpenOrders.length,
      orderIds: unknownOpenOrders.map((order) => order.id),
    }));
  }

  if (executedDecisionsWithoutAudit.length > 0) {
    criticalReasons.push(buildCriticalReason('CRITICAL_EXECUTED_DECISION_AUDIT_MISSING', {
      count: executedDecisionsWithoutAudit.length,
      decisionIds: executedDecisionsWithoutAudit.map((decision) => decision.id),
    }));
  }

  if (!AUTOPILOT_LIVE_EXECUTION_ENABLED && unexpectedExecutedDecisions.length > 0) {
    criticalReasons.push(buildCriticalReason('CRITICAL_UNEXPECTED_EXECUTED_DECISIONS', {
      count: unexpectedExecutedDecisions.length,
      decisionIds: unexpectedExecutedDecisions.map((decision) => decision.id),
    }));
  }

  if (latestRun?.status === 'FAILED') {
    warningReasons.push(buildWarningReason('WARNING_LATEST_RUN_FAILED', {
      runId: latestRun.id,
      message: latestRun.errorMessage || latestRun.summaryJson?.message || null,
    }));
  }

  if (maxOpenOrders > 0 && openOrders.length > maxOpenOrders) {
    warningReasons.push(buildWarningReason('WARNING_OPEN_ORDER_CAP_EXCEEDED', {
      openOrders: openOrders.length,
      maxOpenOrders,
    }));
  }

  if (pendingProposals.length > 0) {
    warningReasons.push(buildWarningReason('WARNING_PENDING_DRY_RUN_PROPOSALS', {
      count: pendingProposals.length,
    }));
  }

  if (failedAuditCount > 0) {
    warningReasons.push(buildWarningReason('WARNING_RECENT_FAILED_TRADE_AUDITS', {
      count: failedAuditCount,
    }));
  }

  const recommendedAction = criticalReasons.length > 0
    ? 'EMERGENCY_STOP'
    : warningReasons.length > 0
      ? 'REVIEW'
      : 'NONE';

  let configAfter = config;
  let emergencyStopApplied = false;

  if (autoStopOnCritical && criticalReasons.length > 0 && config.status === 'ACTIVE') {
    configAfter = await prisma.polymarketAutopilotConfig.update({
      where: { workspaceId },
      data: {
        status: 'EMERGENCY_STOP',
        pausedReason: `Triggered by reconciliation: ${criticalReasons.map((item) => item.code).join(', ')}`,
        emergencyStoppedAt: checkedAt,
      },
    });
    emergencyStopApplied = true;
  }

  const report = {
    liveExecutionEnabled: AUTOPILOT_LIVE_EXECUTION_ENABLED,
    preferredAddress,
    exchange: {
      summaryAvailable: Boolean(tradingSummary),
      summaryError: exchangeError,
      positionError,
      openOrderCount: openOrders.length,
      openOrders: unknownOpenOrders.slice(0, 10).map(summarizeOrder),
    },
    positions: {
      count: positions.length,
      sample: positions.slice(0, 5).map(summarizePosition),
    },
    audits: {
      totalRecent: recentAudits.length,
      successfulPlaceOrders: recentAudits.filter((audit) => audit.action === 'PLACE_ORDER' && audit.status === 'SUCCESS').length,
      successfulCancelOrders: recentAudits.filter((audit) => audit.action === 'CANCEL_ORDER' && audit.status === 'SUCCESS').length,
      failedActions: failedAuditCount,
    },
    decisions: {
      recentCount: recentDecisions.length,
      pendingProposalCount: pendingProposals.length,
      unexpectedExecutedCount: unexpectedExecutedDecisions.length,
      executedAuditMissingCount: executedDecisionsWithoutAudit.length,
    },
    drift: {
      criticalReasons,
      warningReasons,
    },
  };

  const [healthCheck, alertSnapshot] = await Promise.all([
    recordPolymarketAutopilotHealthCheck({
      workspaceId,
      configId: configAfter.id,
      trigger,
      recommendedAction,
      emergencyStopApplied,
      report,
      checkedAt,
    }),
    syncPolymarketAutopilotReasonAlerts({
      workspaceId,
      configId: configAfter.id,
      checkedAt,
      criticalReasons,
      warningReasons,
    }),
  ]);

  return {
    executed: true,
    workspaceId,
    trigger,
    checkedAt: checkedAt.toISOString(),
    recommendedAction,
    emergencyStopApplied,
    config: serializeAutopilotConfig(configAfter),
    latestRun: latestRun ? serializeAutopilotRun(latestRun) : null,
    healthCheck: serializeAutopilotHealthCheck(healthCheck),
    openAlerts: alertSnapshot.openAlerts.map(serializeAutopilotAlert),
    recentAlerts: alertSnapshot.recentAlerts.map(serializeAutopilotAlert),
    report,
  };
}
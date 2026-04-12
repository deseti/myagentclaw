import prisma from './prisma.js';
import { serializeAutopilotConfig, serializeAutopilotRun } from './polymarket-autopilot.js';

const RECONCILIATION_ALERT_SOURCE = 'RECONCILIATION';

const ALERT_CATALOG = {
  CRITICAL_MISSING_TRADING_CREDENTIALS: {
    title: 'Trading credentials missing',
    message: () => 'Autopilot tidak memiliki credential trading Polymarket yang lengkap.',
  },
  CRITICAL_CREDENTIALS_LAST_ERROR: {
    title: 'Credential verification failed',
    message: (details) => `Credential trading terakhir gagal diverifikasi: ${details?.message || 'unknown error'}`,
  },
  CRITICAL_CREDENTIALS_UNVERIFIED: {
    title: 'Trading credentials unverified',
    message: () => 'Credential trading sudah tersimpan, tetapi belum pernah lolos verifikasi terakhir.',
  },
  CRITICAL_TRADING_SUMMARY_FAILED: {
    title: 'Trading summary failed',
    message: (details) => `Gagal membaca trading summary Polymarket: ${details?.message || 'unknown error'}`,
  },
  CRITICAL_UNKNOWN_OPEN_ORDERS: {
    title: 'Unknown open orders detected',
    message: (details) => `Terdeteksi ${details?.count || 0} open order yang tidak cocok dengan audit internal.`,
  },
  CRITICAL_EXECUTED_DECISION_AUDIT_MISSING: {
    title: 'Executed decision missing audit',
    message: (details) => `Terdeteksi ${details?.count || 0} decision EXECUTED tanpa audit trading yang cocok.`,
  },
  CRITICAL_UNEXPECTED_EXECUTED_DECISIONS: {
    title: 'Unexpected executed decisions',
    message: (details) => `Dry-run menemukan ${details?.count || 0} decision EXECUTED padahal live execution masih nonaktif.`,
  },
  WARNING_POSITION_SYNC_FAILED: {
    title: 'Position sync failed',
    message: (details) => `Gagal menyinkronkan posisi Polymarket: ${details?.message || 'unknown error'}`,
  },
  WARNING_PREFERRED_ADDRESS_MISSING: {
    title: 'Preferred address missing',
    message: () => 'Workspace belum memiliki preferred address Polymarket untuk sinkronisasi posisi.',
  },
  WARNING_OPEN_ORDER_CAP_EXCEEDED: {
    title: 'Open order cap exceeded',
    message: (details) => `Jumlah open order ${details?.openOrders || 0} melebihi guardrail ${details?.maxOpenOrders || 0}.`,
  },
  WARNING_PENDING_DRY_RUN_PROPOSALS: {
    title: 'Pending dry-run proposals',
    message: (details) => `Masih ada ${details?.count || 0} proposal dry-run yang belum berubah menjadi audit apa pun.`,
  },
  WARNING_LATEST_RUN_FAILED: {
    title: 'Latest run failed',
    message: (details) => `Run autopilot terakhir gagal: ${details?.message || 'unknown error'}`,
  },
  WARNING_RECENT_FAILED_TRADE_AUDITS: {
    title: 'Recent trade audit failures',
    message: (details) => `Terdeteksi ${details?.count || 0} audit trading gagal pada riwayat terbaru.`,
  },
};

function buildAlertMessage(reason, severity) {
  const catalogEntry = ALERT_CATALOG[reason?.code] || null;
  const title = catalogEntry?.title || `${severity === 'CRITICAL' ? 'Critical' : 'Warning'} autopilot issue`;
  const message = catalogEntry?.message
    ? catalogEntry.message(reason?.details || {})
    : reason?.code || 'Unknown autopilot issue';

  return {
    title,
    message,
  };
}

export function serializeAutopilotAlert(alert) {
  if (!alert) return null;

  return {
    id: alert.id,
    workspaceId: alert.workspaceId,
    configId: alert.configId || null,
    severity: alert.severity,
    status: alert.status,
    source: alert.source,
    code: alert.code,
    title: alert.title,
    message: alert.message,
    details: alert.detailsJson || null,
    firstSeenAt: alert.firstSeenAt?.toISOString?.() || null,
    lastSeenAt: alert.lastSeenAt?.toISOString?.() || null,
    resolvedAt: alert.resolvedAt?.toISOString?.() || null,
    occurrenceCount: alert.occurrenceCount || 0,
    createdAt: alert.createdAt?.toISOString?.() || null,
    updatedAt: alert.updatedAt?.toISOString?.() || null,
  };
}

export function serializeAutopilotHealthCheck(check) {
  if (!check) return null;

  return {
    id: check.id,
    workspaceId: check.workspaceId,
    configId: check.configId || null,
    trigger: check.trigger,
    recommendedAction: check.recommendedAction,
    emergencyStopApplied: Boolean(check.emergencyStopApplied),
    report: check.reportJson || null,
    checkedAt: check.checkedAt?.toISOString?.() || null,
    createdAt: check.createdAt?.toISOString?.() || null,
    updatedAt: check.updatedAt?.toISOString?.() || null,
  };
}

export async function recordPolymarketAutopilotHealthCheck({
  workspaceId,
  configId = null,
  trigger,
  recommendedAction,
  emergencyStopApplied = false,
  report,
  checkedAt,
}) {
  return prisma.polymarketAutopilotHealthCheck.create({
    data: {
      workspaceId,
      configId,
      trigger,
      recommendedAction,
      emergencyStopApplied,
      reportJson: report,
      checkedAt,
    },
  });
}

export async function syncPolymarketAutopilotReasonAlerts({
  workspaceId,
  configId = null,
  checkedAt,
  criticalReasons = [],
  warningReasons = [],
  source = RECONCILIATION_ALERT_SOURCE,
}) {
  return prisma.$transaction(async (tx) => {
    const desiredIssues = [
      ...criticalReasons.map((reason) => ({ severity: 'CRITICAL', reason })),
      ...warningReasons.map((reason) => ({ severity: 'WARNING', reason })),
    ];

    const desiredKeys = new Set(
      desiredIssues.map(({ severity, reason }) => `${source}:${severity}:${reason.code}`),
    );

    const existingOpenAlerts = await tx.polymarketAutopilotAlert.findMany({
      where: {
        workspaceId,
        source,
        status: 'OPEN',
      },
    });

    for (const issue of desiredIssues) {
      const { severity, reason } = issue;
      const content = buildAlertMessage(reason, severity);
      const existing = existingOpenAlerts.find(
        (alert) => alert.code === reason.code && alert.severity === severity,
      );

      if (existing) {
        await tx.polymarketAutopilotAlert.update({
          where: { id: existing.id },
          data: {
            configId,
            title: content.title,
            message: content.message,
            detailsJson: reason.details || null,
            lastSeenAt: checkedAt,
            resolvedAt: null,
            occurrenceCount: { increment: 1 },
          },
        });
      } else {
        await tx.polymarketAutopilotAlert.create({
          data: {
            workspaceId,
            configId,
            severity,
            status: 'OPEN',
            source,
            code: reason.code,
            title: content.title,
            message: content.message,
            detailsJson: reason.details || null,
            firstSeenAt: checkedAt,
            lastSeenAt: checkedAt,
          },
        });
      }
    }

    for (const alert of existingOpenAlerts) {
      const key = `${alert.source}:${alert.severity}:${alert.code}`;
      if (desiredKeys.has(key)) continue;

      await tx.polymarketAutopilotAlert.update({
        where: { id: alert.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: checkedAt,
          lastSeenAt: checkedAt,
        },
      });
    }

    const [openAlerts, recentAlerts] = await Promise.all([
      tx.polymarketAutopilotAlert.findMany({
        where: {
          workspaceId,
          status: 'OPEN',
        },
        orderBy: [
          { lastSeenAt: 'desc' },
          { createdAt: 'desc' },
        ],
        take: 20,
      }),
      tx.polymarketAutopilotAlert.findMany({
        where: { workspaceId },
        orderBy: [
          { lastSeenAt: 'desc' },
          { createdAt: 'desc' },
        ],
        take: 20,
      }),
    ]);

    return {
      openAlerts,
      recentAlerts,
    };
  });
}

export async function getPolymarketAutopilotMonitoringSnapshot({ workspaceId }) {
  const failedRunWindowStart = new Date(Date.now() - (24 * 60 * 60 * 1000));

  const [config, latestRun, latestHealthCheck, openAlerts, recentAlerts, failedRunCount24h] = await Promise.all([
    prisma.polymarketAutopilotConfig.findUnique({ where: { workspaceId } }),
    prisma.polymarketAutopilotRun.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.polymarketAutopilotHealthCheck.findFirst({
      where: { workspaceId },
      orderBy: { checkedAt: 'desc' },
    }),
    prisma.polymarketAutopilotAlert.findMany({
      where: {
        workspaceId,
        status: 'OPEN',
      },
      orderBy: [
        { lastSeenAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 20,
    }),
    prisma.polymarketAutopilotAlert.findMany({
      where: { workspaceId },
      orderBy: [
        { lastSeenAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 20,
    }),
    prisma.polymarketAutopilotRun.count({
      where: {
        workspaceId,
        status: 'FAILED',
        createdAt: { gte: failedRunWindowStart },
      },
    }),
  ]);

  const openCriticalCount = openAlerts.filter((alert) => alert.severity === 'CRITICAL').length;
  const openWarningCount = openAlerts.filter((alert) => alert.severity === 'WARNING').length;

  return {
    workspaceId,
    config: serializeAutopilotConfig(config),
    latestRun: latestRun ? serializeAutopilotRun(latestRun) : null,
    latestHealthCheck: serializeAutopilotHealthCheck(latestHealthCheck),
    openAlerts: openAlerts.map(serializeAutopilotAlert),
    recentAlerts: recentAlerts.map(serializeAutopilotAlert),
    summary: {
      openAlertCount: openAlerts.length,
      openCriticalCount,
      openWarningCount,
      latestRecommendedAction: latestHealthCheck?.recommendedAction || 'NONE',
      latestCheckAt: latestHealthCheck?.checkedAt?.toISOString?.() || null,
      latestRunStatus: latestRun?.status || null,
      failedRunCount24h,
      emergencyStopActive: config?.status === 'EMERGENCY_STOP',
    },
  };
}

export { RECONCILIATION_ALERT_SOURCE };
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../lib/prisma.js';
import { runPolymarketAutopilotDryRun } from '../lib/polymarket-autopilot-engine.js';
import { reconcilePolymarketAutopilotWorkspace } from '../lib/polymarket-autopilot-reconciliation.js';
import { listWorkspaceIdsWithAssignedSkill } from '../lib/skill-activation.js';

const POLYMARKET_AUTOPILOT_SKILL_KEY = 'polymarket-growth-autopilot';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const polymarketAutopilotRunQueue = new Queue('polymarket-autopilot-run', { connection });

export async function enqueuePolymarketAutopilotRun({
  workspaceId,
  trigger = 'MANUAL',
  requestedBy = null,
  dedupeWindowMs = 60_000,
}) {
  const bucket = Math.floor(Date.now() / dedupeWindowMs);
  const normalizedTrigger = String(trigger || 'MANUAL').replace(/[^A-Za-z0-9_-]+/g, '-');
  return polymarketAutopilotRunQueue.add(
    'run-workspace',
    { workspaceId, trigger, requestedBy },
    {
      jobId: `polymarket-autopilot-${workspaceId}-${normalizedTrigger}-${bucket}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  );
}

const worker = new Worker(
  'polymarket-autopilot-run',
  async (job) => {
    const { workspaceId, trigger, requestedBy } = job.data;
    job.log(`Running Polymarket autopilot dry-run for workspace ${workspaceId}`);
    const result = await runPolymarketAutopilotDryRun({ workspaceId, trigger, requestedBy });

    let reconciliation = null;
    try {
      reconciliation = await reconcilePolymarketAutopilotWorkspace({
        workspaceId,
        trigger: `WORKER_${String(trigger || 'MANUAL').toUpperCase()}`,
        autoStopOnCritical: true,
      });
      job.log(`Reconciliation completed for workspace ${workspaceId} with action ${reconciliation.recommendedAction}`);
    } catch (error) {
      job.log(`Reconciliation failed for workspace ${workspaceId}: ${error.message}`);
    }

    if (result.error) {
      throw result.error;
    }

    return {
      runId: result.run.id,
      status: result.run.status,
      decisionCount: Array.isArray(result.decisions) ? result.decisions.length : 0,
      recommendedAction: reconciliation?.recommendedAction || 'UNKNOWN',
    };
  },
  {
    connection,
    concurrency: 1,
  },
);

worker.on('completed', (job, result) => {
  console.log(`[polymarket-autopilot-worker] Job ${job.id} completed:`, result);
});

worker.on('failed', (job, err) => {
  console.error(`[polymarket-autopilot-worker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[polymarket-autopilot-worker] Worker error:', err);
});

let schedulerBusy = false;

async function scheduleDueAutopilotRuns() {
  if (schedulerBusy) return;
  schedulerBusy = true;

  try {
    const configs = await prisma.polymarketAutopilotConfig.findMany({
      where: { status: 'ACTIVE' },
      select: {
        workspaceId: true,
        lastRunAt: true,
        executionConfigJson: true,
      },
      take: 50,
    });

    const activeWorkspaceIds = await listWorkspaceIdsWithAssignedSkill(
      configs.map((config) => config.workspaceId),
      POLYMARKET_AUTOPILOT_SKILL_KEY,
    );

    const now = Date.now();
    await Promise.all(configs.map(async (config) => {
      if (!activeWorkspaceIds.has(config.workspaceId)) {
        return;
      }

      const executionConfig = config.executionConfigJson || {};
      const intervalSeconds = Math.max(60, Number(executionConfig.evaluationIntervalSeconds || 300));
      const dueAt = config.lastRunAt ? new Date(config.lastRunAt).getTime() + (intervalSeconds * 1000) : 0;
      if (dueAt > now) return;

      await enqueuePolymarketAutopilotRun({
        workspaceId: config.workspaceId,
        trigger: 'SCHEDULER',
        requestedBy: 'scheduler',
      }).catch(() => {
        // ignore duplicate enqueue errors from jobId reuse window
      });
    }));
  } finally {
    schedulerBusy = false;
  }
}

const schedulerTimer = setInterval(() => {
  scheduleDueAutopilotRuns().catch((error) => {
    console.error('[polymarket-autopilot-worker] Scheduler error:', error.message);
  });
}, 60_000);

if (typeof schedulerTimer.unref === 'function') {
  schedulerTimer.unref();
}

console.log('[polymarket-autopilot-worker] Started and listening on polymarket-autopilot-run');

export default worker;
import { runAnalyticsDashboardWorkerTick } from '../services/analytics-dashboard.service.js';

const WORKER_INTERVAL_MS = 15 * 60 * 1000;

let workerBusy = false;

async function runTick() {
  if (workerBusy) {
    return;
  }

  workerBusy = true;

  try {
    const result = await runAnalyticsDashboardWorkerTick();
    console.info('[analytics-dashboard-worker] tick:complete', {
      workspaceCount: result.workspaceCount,
    });
  } catch (error) {
    console.error('[analytics-dashboard-worker] tick:error', { error: error.message });
  } finally {
    workerBusy = false;
  }
}

runTick().catch((error) => {
  console.error('[analytics-dashboard-worker] bootstrap:error', { error: error.message });
});

setInterval(() => {
  runTick().catch((error) => {
    console.error('[analytics-dashboard-worker] scheduler:error', { error: error.message });
  });
}, WORKER_INTERVAL_MS);

console.log('[analytics-dashboard-worker] Started and listening for analytics snapshot ticks');
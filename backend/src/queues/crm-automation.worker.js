import prisma from '../lib/prisma.js';
import { CRM_PIPELINE_SKILL_KEY } from '../lib/crm-pipeline.js';
import { listWorkspaceIdsWithAssignedSkill } from '../lib/skill-activation.js';
import { runCrmAutomationTick } from '../services/crm-automation.service.js';

const WORKER_INTERVAL_MS = 60_000;

async function findCandidateWorkspaceIds() {
  const rows = await prisma.crmCustomerPipelineEntry.findMany({
    where: {
      isArchived: false,
    },
    select: { workspaceId: true },
    distinct: ['workspaceId'],
  });

  return [...new Set(rows.map((row) => row.workspaceId).filter(Boolean))];
}

async function runTick() {
  const candidateWorkspaceIds = await findCandidateWorkspaceIds();
  if (candidateWorkspaceIds.length === 0) {
    return;
  }

  const activeWorkspaceIds = await listWorkspaceIdsWithAssignedSkill(candidateWorkspaceIds, CRM_PIPELINE_SKILL_KEY);
  if (activeWorkspaceIds.size === 0) {
    return;
  }

  await runCrmAutomationTick({
    workspaceIds: [...activeWorkspaceIds],
    now: new Date(),
  });
}

runTick().catch((error) => {
  console.error('[crm-automation-worker] bootstrap:error', { error: error.message });
});

setInterval(() => {
  runTick().catch((error) => {
    console.error('[crm-automation-worker] scheduler:error', { error: error.message });
  });
}, WORKER_INTERVAL_MS);

console.log('[crm-automation-worker] Started and listening for periodic CRM pipeline automation ticks');
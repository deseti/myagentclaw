import { BROADCAST_CAMPAIGN_SKILL_KEY } from '../lib/broadcast-campaign.js';
import { listWorkspaceIdsWithAssignedSkill } from '../lib/skill-activation.js';
import {
  dispatchBroadcastCampaign,
  listDueBroadcastCampaignIds,
} from '../services/broadcast-campaign.service.js';

const WORKER_INTERVAL_MS = 60_000;

let workerBusy = false;

async function runTick() {
  if (workerBusy) {
    return;
  }

  workerBusy = true;

  try {
    const dueCampaigns = await listDueBroadcastCampaignIds({ limit: 25 });
    if (dueCampaigns.length === 0) {
      return;
    }

    const activeWorkspaceIds = await listWorkspaceIdsWithAssignedSkill(
      dueCampaigns.map((campaign) => campaign.workspaceId),
      BROADCAST_CAMPAIGN_SKILL_KEY,
    );

    for (const campaign of dueCampaigns) {
      if (!activeWorkspaceIds.has(campaign.workspaceId)) {
        continue;
      }

      await dispatchBroadcastCampaign({ campaignId: campaign.id }).catch((error) => {
        console.error('[broadcast-campaign-worker] dispatch:error', {
          campaignId: campaign.id,
          workspaceId: campaign.workspaceId,
          error: error.message,
        });
      });
    }
  } finally {
    workerBusy = false;
  }
}

runTick().catch((error) => {
  console.error('[broadcast-campaign-worker] bootstrap:error', { error: error.message });
});

setInterval(() => {
  runTick().catch((error) => {
    console.error('[broadcast-campaign-worker] scheduler:error', { error: error.message });
  });
}, WORKER_INTERVAL_MS);

console.log('[broadcast-campaign-worker] Started and listening for scheduled broadcast campaign ticks');
/**
 * agent-provisioner.js
 *
 * Sinkronisasi state agent ke openclaw gateway.
 * Dipanggil saat agent di-toggle ACTIVE/INACTIVE atau di-delete.
 *
 * Arsitek: openclaw mengelola bot lifecycle via adapter API (port 4000).
 */

import prisma from '../lib/prisma.js';
import { buildGatewayAgentConfig } from './agent-config.js';
import { ocStartChannel, ocStopChannel } from './openclaw-client.js';
import { ensureRuntimeWhatsAppPluginInstalled, ensureWorkspaceRuntime, listCandidateAdapterUrls } from './runtime-manager.js';
import { CHANNEL_TYPES } from './channel-utils.js';

const DEFAULT_LLM_MODEL = process.env.DEFAULT_LLM_MODEL || 'openai-codex/gpt-5.4';

/**
 * Sync satu agent ke openclaw:
 * - ACTIVE  ? register semua CONNECTED channels ke openclaw
 * - INACTIVE ? unregister semua channels dari openclaw
 */
export async function syncAgentToGateway(agentId) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      workspace: { select: { id: true, name: true, ownerId: true, subTier: true } },
      channels: { where: { status: 'CONNECTED' } },
    },
  });

  if (!agent) return;

  const runtime = await ensureWorkspaceRuntime(agent.workspace);
  const cleanupTargets = listCandidateAdapterUrls(agent.workspace)
    .filter((adapterUrl) => adapterUrl !== runtime.adapterUrl)
    .map((adapterUrl) => ({ adapterUrl }));

  for (const ch of agent.channels) {
    if (ch.type === CHANNEL_TYPES.TELEGRAM && !ch.sessionData?.tokenHash) {
      console.warn(`[provisioner] skip telegram channel ${ch.id}: tokenHash missing`);
      continue;
    }

    const credentials = ch.type === CHANNEL_TYPES.TELEGRAM
      ? { botToken: Buffer.from(ch.sessionData.tokenHash, 'base64').toString() }
      : {};

    if (agent.status === 'ACTIVE') {
      if (ch.type === CHANNEL_TYPES.WHATSAPP) {
        try {
          await ensureRuntimeWhatsAppPluginInstalled(runtime);
        } catch (err) {
          console.warn(`[provisioner] whatsapp plugin ${ch.id}:`, err.message);
          continue;
        }
      }

      for (const target of cleanupTargets) {
        await ocStopChannel(ch.id, ch.type, target).catch(() => {});
      }

      await ocStartChannel(ch.id, ch.type, credentials, agentId, {
        ...buildGatewayAgentConfig(agent, {
          llmModel: agent.llmModel || DEFAULT_LLM_MODEL,
          botUsername: ch.sessionData?.botUsername || '',
          channelType: ch.type,
        }),
      }, runtime).catch((err) => console.warn(`[provisioner] startChannel ${ch.id}:`, err.message));
    } else {
      const targets = [runtime, ...cleanupTargets];
      for (const target of targets) {
        await ocStopChannel(ch.id, ch.type, target)
          .catch((err) => console.warn(`[provisioner] stopChannel ${ch.id}:`, err.message));
      }
    }
  }
}

/**
 * Hentikan semua bots untuk agent yang dihapus.
 */
export async function deprovisionAgent(agentId) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { workspace: { select: { id: true, ownerId: true, subTier: true } } },
  });

  const channels = await prisma.channel.findMany({
    where: { agentId, status: 'CONNECTED' },
    select: { id: true, type: true },
  });

  const targets = agent?.workspace
    ? listCandidateAdapterUrls(agent.workspace).map((adapterUrl) => ({ adapterUrl }))
    : [{}];

  for (const ch of channels) {
    for (const target of targets) {
      await ocStopChannel(ch.id, ch.type, target)
        .catch((err) => console.warn(`[provisioner] deprovisionAgent stopChannel ${ch.id}:`, err.message));
    }
  }
}

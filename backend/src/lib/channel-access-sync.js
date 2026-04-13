import prisma from './prisma.js';
import { stripCustomerPhonePrefix } from './channel-utils.js';
import { ocGrantChannelAccess } from './openclaw-client.js';
import { resolveChannelRuntime } from './runtime-manager.js';

export async function syncApprovedCustomerToChannel({ channelId, channelType, phoneNumber }) {
  if (!channelId || !channelType || !phoneNumber) {
    return { ok: false, skipped: true, reason: 'missing_input' };
  }

  const runtime = await resolveChannelRuntime(channelId).catch(() => ({}));
  await ocGrantChannelAccess({
    channelId,
    channelType,
    customerPhone: stripCustomerPhonePrefix(phoneNumber),
  }, runtime);

  return { ok: true, channelId };
}

export async function syncApprovedCustomerForAgent({ agentId, phoneNumber }) {
  if (!agentId || !phoneNumber) {
    return { ok: false, skipped: true, reason: 'missing_input' };
  }

  const channel = await prisma.channel.findFirst({
    where: {
      agentId,
      status: 'CONNECTED',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
    },
  });

  if (!channel?.id) {
    return { ok: false, skipped: true, reason: 'channel_not_connected' };
  }

  return syncApprovedCustomerToChannel({
    channelId: channel.id,
    channelType: channel.type,
    phoneNumber,
  });
}

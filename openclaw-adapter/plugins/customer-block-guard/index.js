import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || 'http://backend:3001';
const INTERNAL_KEY = process.env.INTERNAL_SECRET_KEY || '';

function normalizeTarget(channelId, value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';

  if (channelId === 'whatsapp') {
    return raw.replace(/^wa:/i, '').replace(/@(s\.whatsapp\.net|g\.us)$/i, '');
  }

  if (raw.startsWith('tg:')) {
    return raw.slice(3);
  }

  const scopedTopic = /^(-?\d+):(-?\d+)$/.exec(raw);
  if (scopedTopic) {
    return scopedTopic[1];
  }

  return raw;
}

async function isBlockedCustomer(accountId, customerPhone) {
  const url = new URL('/internal/message/status', BACKEND_URL);
  url.searchParams.set('channel_id', accountId);
  url.searchParams.set('customer_phone', customerPhone);

  const response = await fetch(url, {
    headers: {
      'x-internal-key': INTERNAL_KEY,
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`status lookup failed: ${response.status}`);
  }

  const data = await response.json().catch(() => ({}));
  return data?.customer?.isBlocked === true;
}

async function resolveInboundAccess(accountId, customerPhone, content) {
  const response = await fetch(new URL('/internal/message/access', BACKEND_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-key': INTERNAL_KEY,
    },
    body: JSON.stringify({
      channel_id: accountId,
      customer_phone: customerPhone,
      content,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`access lookup failed: ${response.status}`);
  }

  return response.json().catch(() => ({}));
}

async function shouldBlockTelegramCustomer(api, accountId, customerPhone, stage) {
  if (!accountId || !customerPhone) return false;

  api.logger.info?.(
    `customer-block-guard: checking ${stage} telegram account=${accountId} target=${customerPhone}`,
  );

  const blocked = await isBlockedCustomer(accountId, customerPhone);
  api.logger.info?.(
    `customer-block-guard: lookup result ${stage} account=${accountId} target=${customerPhone} blocked=${blocked}`,
  );
  return blocked;
}

export default definePluginEntry({
  id: 'customer-block-guard',
  name: 'Customer Block Guard',
  description: 'Cancels outbound Telegram or WhatsApp replies to blocked customers',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  register(api) {
    api.on('before_dispatch', async (event, ctx) => {
      if (!['telegram', 'whatsapp'].includes(ctx.channelId)) return;

      const accountId = typeof ctx.accountId === 'string' ? ctx.accountId.trim() : '';
      const senderId = normalizeTarget(ctx.channelId, ctx.senderId);
      if (!accountId || !senderId) return;

      try {
        const access = await resolveInboundAccess(accountId, senderId, event?.content || '');
        if (access?.decision === 'ALLOW') return;

        api.logger.info?.(
          `customer-block-guard: handled inbound ${ctx.channelId} dispatch for customer ${senderId} decision=${access?.decision || 'UNKNOWN'}`,
        );

        if (access?.replyText) {
          return { handled: true, text: access.replyText };
        }

        return { handled: true };
      } catch (error) {
        api.logger.warn?.(`customer-block-guard: before_dispatch lookup failed (${String(error)})`);
        return;
      }
    });

    api.on('message_sending', async (event, ctx) => {
      if (!['telegram', 'whatsapp'].includes(ctx.channelId)) return;

      const accountId = typeof ctx.accountId === 'string' ? ctx.accountId.trim() : '';
      const target = normalizeTarget(ctx.channelId, event.to);
      if (!accountId || !target) return;

      try {
        const blocked = await shouldBlockTelegramCustomer(api, accountId, target, 'message_sending');
        if (!blocked) return;

        api.logger.info?.(`customer-block-guard: cancelled outbound reply to blocked customer ${target}`);
        return { cancel: true };
      } catch (error) {
        api.logger.warn?.(`customer-block-guard: status lookup failed (${String(error)})`);
        return;
      }
    });
  },
});
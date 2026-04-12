import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || 'http://backend:3001';
const INTERNAL_KEY = process.env.INTERNAL_SECRET_KEY || '';
const QUOTA_EXHAUSTED_MSG =
  'Maaf, layanan kami sedang penuh untuk bulan ini. Silakan coba lagi bulan depan atau upgrade paket Anda.';
const SUSPENDED_MSG =
  'Maaf, layanan sementara tidak tersedia. Hubungi admin untuk informasi lebih lanjut.';

async function getChannelQuota(accountId) {
  const url = new URL(`/internal/quota/channel/${accountId}`, BACKEND_URL);

  const response = await fetch(url, {
    headers: {
      'x-internal-key': INTERNAL_KEY,
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`quota lookup failed: ${response.status}`);
  }

  return response.json();
}

export default definePluginEntry({
  id: 'quota-guard',
  name: 'Quota Guard',
  description: 'Blocks inbound Telegram or WhatsApp turns before the LLM runs when workspace quota is exhausted',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  register(api) {
    api.on('before_dispatch', async (_event, ctx) => {
      if (!['telegram', 'whatsapp'].includes(ctx.channelId)) return;

      const channelLabel = ctx.channelId;

      const accountId = typeof ctx.accountId === 'string' ? ctx.accountId.trim() : '';
      if (!accountId) return;

      try {
        const quota = await getChannelQuota(accountId);
        if (!quota) return;

        if (['SUSPENDED', 'EXPIRED'].includes(String(quota.subscription_status || '').toUpperCase())) {
          api.logger.info?.(`quota-guard: blocked ${channelLabel} dispatch for suspended workspace on channel ${accountId}`);
          return { handled: true, text: SUSPENDED_MSG };
        }

        if ((quota.quota_remaining ?? 0) > 0) return;

        api.logger.info?.(
          `quota-guard: blocked ${channelLabel} dispatch for exhausted quota on channel ${accountId}`,
        );
        return { handled: true, text: QUOTA_EXHAUSTED_MSG };
      } catch (error) {
        api.logger.warn?.(`quota-guard: quota lookup failed (${String(error)})`);
        return;
      }
    });
  },
});
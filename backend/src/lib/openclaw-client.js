/**
 * openclaw-client.js
 *
 * HTTP client untuk berkomunikasi dengan openclaw adapter API (port 4000).
 * Backend memanggil ini untuk register / unregister Telegram bots ke openclaw.
 *
 * openclaw adapter (gateway-manager.js) berjalan di container openclaw-adapter,
 * terpisah dari gateway resmi openclaw.
 */

const ADAPTER_URL = process.env.OPENCLAW_ADAPTER_URL || process.env.OPENCLAW_BASE_URL || 'http://openclaw-adapter:4000';
const ADAPTER_WHATSAPP_LINK_BASE = '/api/myagentclaw/whatsapp/link';

function resolveAdapterBaseUrl(runtime = {}) {
  return runtime?.adapterUrl || ADAPTER_URL;
}

async function adapterFetch(path, options = {}, runtime = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 15000));
  const url = `${resolveAdapterBaseUrl(runtime)}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`openclaw adapter ${options.method || 'GET'} ${path} -> ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Register bot Telegram baru ke openclaw.
 * openclaw auto hot-reload config dan mulai polling bot.
 */
export async function ocStartBot(channelId, botToken, agentId, agentConfig = {}, runtime = {}) {
  return ocStartChannel(channelId, 'TELEGRAM', { botToken }, agentId, agentConfig, runtime);
}

export async function ocStartChannel(channelId, channelType, credentials = {}, agentId, agentConfig = {}, runtime = {}) {
  return adapterFetch('/bots/start', {
    method: 'POST',
    body: JSON.stringify({ channelId, type: channelType, agentId, agentConfig, ...credentials }),
  }, runtime);
}

/**
 * Unregister bot dari openclaw.
 * openclaw hot-reload config dan berhenti polling.
 */
export async function ocStopBot(channelId, runtime = {}) {
  return ocStopChannel(channelId, 'TELEGRAM', runtime);
}

export async function ocStopChannel(channelId, channelType, runtime = {}, options = {}) {
  return adapterFetch('/bots/stop', {
    method: 'POST',
    body: JSON.stringify({
      channelId,
      type: channelType,
      removeRegistration: options.removeRegistration === true,
      reason: options.reason,
    }),
  }, runtime);
}

/**
 * List semua bots aktif di openclaw.
 */
export async function ocListBots(runtime = {}) {
  return ocListChannels(runtime);
}

export async function ocListChannels(runtime = {}) {
  return adapterFetch('/bots', {}, runtime);
}

export async function ocSendTelegramMessage(channelId, to, text, options = {}, runtime = {}) {
  return ocSendChannelMessage(channelId, 'TELEGRAM', to, text, options, runtime);
}

export async function ocSendChannelMessage(channelId, channelType, to, text, options = {}, runtime = {}) {
  return adapterFetch('/messages/send', {
    method: 'POST',
    body: JSON.stringify({
      channelId,
      channelType,
      agentId: runtime.agentId || options.agentId || undefined,
      to,
      text,
      replyToId: options.replyToId,
      threadId: options.threadId,
    }),
  }, runtime);
}

export async function ocGetWhatsAppLinkStatus(channelId, runtime = {}) {
  return adapterFetch(`${ADAPTER_WHATSAPP_LINK_BASE}/status`, {
    method: 'POST',
    body: JSON.stringify({ channelId }),
    timeoutMs: 10000,
  }, runtime);
}

export async function ocStartWhatsAppLink(channelId, options = {}, runtime = {}) {
  return adapterFetch(`${ADAPTER_WHATSAPP_LINK_BASE}/start`, {
    method: 'POST',
    body: JSON.stringify({
      channelId,
      agentId: options.agentId,
      force: options.force === true,
      forceFreshLogin: options.forceFreshLogin === true,
      authNamespace: options.authNamespace,
      runtimeSessionId: options.runtimeSessionId,
      adapterSessionId: options.adapterSessionId,
      previousAuthNamespace: options.previousAuthNamespace,
      previousRuntimeSessionId: options.previousRuntimeSessionId,
      previousAdapterSessionId: options.previousAdapterSessionId,
      previousAuthDir: options.previousAuthDir,
      timeoutMs: options.timeoutMs,
    }),
    timeoutMs: Math.max(10000, Number(options.timeoutMs || 30000) + 10000),
  }, runtime);
}

export async function ocWaitWhatsAppLink(channelId, options = {}, runtime = {}) {
  const requestedTimeoutMs = Math.max(1000, Number(options.timeoutMs || 120000));
  return adapterFetch(`${ADAPTER_WHATSAPP_LINK_BASE}/wait`, {
    method: 'POST',
    body: JSON.stringify({
      channelId,
      timeoutMs: requestedTimeoutMs,
    }),
    timeoutMs: requestedTimeoutMs + 10000,
  }, runtime);
}

export async function ocGenerateFollowupMessage(payload, runtime = {}) {
  return adapterFetch('/followups/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, runtime);
}

export async function ocGrantChannelAccess(payload, runtime = {}) {
  return adapterFetch('/channels/access/grant', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, runtime);
}

export async function ocListInstalledSkills(runtime = {}) {
  return adapterFetch('/skills/installed', {}, runtime);
}

export async function ocListBundledSkills(runtime = {}) {
  return adapterFetch('/skills/bundled', {}, runtime);
}

export async function ocInstallSkill(payload, runtime = {}) {
  return adapterFetch('/skills/install', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, runtime);
}

export async function ocInstallBundledSkill(payload, runtime = {}) {
  return adapterFetch('/skills/install-bundled', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, runtime);
}

export async function ocUninstallSkill({ slug }, runtime = {}) {
  return adapterFetch(`/skills/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  }, runtime);
}

/**
 * Legacy compatibility hook.
 *
 * Inbound AI handling sekarang dijalankan langsung oleh OpenClaw gateway resmi,
 * bukan oleh backend via direct call. Fungsi ini dipertahankan agar import lama
 * tidak membuat backend gagal start.
 */
export async function sendMessageToAgent() {
  throw new Error('Direct sendMessageToAgent is disabled. Inbound messaging is handled by the official OpenClaw gateway.');
}

/**
 * Validasi Telegram bot token langsung ke Telegram API.
 */
export async function validateTelegramBotToken(botToken) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
    signal: AbortSignal.timeout(10000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error('Token bot Telegram tidak valid atau tidak dapat dijangkau');
  }

  return {
    id: data.result.id,
    username: data.result.username,
    firstName: data.result.first_name,
  };
}

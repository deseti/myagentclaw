import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from 'openclaw/plugin-sdk/config-runtime';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const MAX_BODY_BYTES = 64 * 1024;
const WHATSAPP_PLUGIN_IDS = ['whatsapp', '@openclaw/whatsapp'];
const ROUTES = {
  start: '/api/myagentclaw/whatsapp/link/start',
  wait: '/api/myagentclaw/whatsapp/link/wait',
  status: '/api/myagentclaw/whatsapp/link/status',
};
const require = createRequire(import.meta.url);

let whatsappRuntimePromise = null;

function sanitizeQrPayload(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeQrPayload(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const copy = { ...value };
  if (typeof copy.qrDataUrl === 'string') {
    copy.qrDataUrl = `[base64:${copy.qrDataUrl.length}]`;
  }
  if (copy.rawRuntimePayload && typeof copy.rawRuntimePayload === 'object') {
    copy.rawRuntimePayload = sanitizeQrPayload(copy.rawRuntimePayload);
  }
  return copy;
}

function summarizeQrPayload(payload = {}) {
  const source = payload || {};
  return {
    runtimeStatus: source.runtimeStatus || null,
    linkState: source.linkState || null,
    qrDataUrlExists: typeof source.qrDataUrl === 'string' && source.qrDataUrl.length > 0,
    qrDataUrlLength: typeof source.qrDataUrl === 'string' ? source.qrDataUrl.length : 0,
    pairingCodeExists: typeof source.pairingCode === 'string' && source.pairingCode.length > 0,
    pairingPhoneNumber: source.pairingPhoneNumber || null,
    message: source.message || null,
    error: source.error || null,
  };
}

function logBridge(stage, details = {}) {
  console.log('[whatsapp-link-bridge]', stage, sanitizeQrPayload(details));
}

function resolveRuntimeStatuses(status = {}) {
  const explicitRuntimeStatus = typeof status.runtimeStatus === 'string'
    ? status.runtimeStatus.trim().toUpperCase()
    : '';
  const explicitLinkState = typeof status.linkState === 'string'
    ? status.linkState.trim().toUpperCase()
    : '';

  if (explicitRuntimeStatus) {
    return {
      runtimeStatus: explicitRuntimeStatus,
      linkState: explicitLinkState || explicitRuntimeStatus,
    };
  }
  if (status.connected) {
    return { runtimeStatus: 'CONNECTED', linkState: 'CONNECTED' };
  }
  if (status.sessionPersistedAt || status.socketConnectedAt) {
    return { runtimeStatus: 'WAITING_SOCKET_CONNECT', linkState: 'WAITING_SOCKET_CONNECT' };
  }
  if (status.qrScannedAt) {
    return { runtimeStatus: 'QR_SCANNED', linkState: 'QR_SCANNED' };
  }
  if (status.qrDataUrl || status.pairingCode) {
    return { runtimeStatus: 'WAITING_QR', linkState: 'WAITING_QR' };
  }
  if (status.forceQrTriggered) {
    return { runtimeStatus: 'CONNECTING', linkState: 'FORCE_NEW_QR' };
  }
  if (status.linked) {
    return { runtimeStatus: 'CONNECTING', linkState: 'RECONNECTING' };
  }
  return { runtimeStatus: 'DISCONNECTED', linkState: 'DISCONNECTED' };
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
  return true;
}

function normalizeTimeoutMs(value, fallback, max = 300000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(parsed), 1000), max);
}

async function readJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return {};
  }

  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;

    if (total > MAX_BODY_BYTES) {
      throw createHttpError(413, 'Payload terlalu besar');
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw createHttpError(400, 'Body JSON tidak valid');
  }
}

function readRequiredAccountId(body = {}) {
  const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
  if (!accountId) {
    throw createHttpError(400, 'accountId diperlukan');
  }
  return accountId;
}

function resolveWhatsAppInstallRecord(config) {
  const installs = config?.plugins?.installs || {};
  for (const pluginId of WHATSAPP_PLUGIN_IDS) {
    const record = installs?.[pluginId];
    if (record?.installPath) {
      return record;
    }
  }
  return null;
}

function resolveWhatsAppRuntimeCandidates() {
  const candidates = [];

  try {
    const configRuntimePath = require.resolve('openclaw/plugin-sdk/config-runtime');
    candidates.push(join(dirname(configRuntimePath), '..', 'extensions', 'whatsapp', 'runtime-api.js'));
  } catch {
    // Fall back to the standard OpenClaw container layout below.
  }

  candidates.push(join(process.cwd(), 'dist', 'extensions', 'whatsapp', 'runtime-api.js'));

  return [...new Set(candidates)];
}

async function loadWhatsAppRuntime(config) {
  const installRecord = resolveWhatsAppInstallRecord(config);
  const installPath = typeof installRecord?.installPath === 'string' ? installRecord.installPath.trim() : '';

  if (!installPath) {
    throw createHttpError(503, 'Plugin WhatsApp belum terinstall di runtime ini');
  }

  if (!whatsappRuntimePromise) {
    whatsappRuntimePromise = (async () => {
      let lastError = null;

      for (const candidate of resolveWhatsAppRuntimeCandidates()) {
        try {
          return await import(pathToFileURL(candidate).href);
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError || new Error(`runtime-api.js WhatsApp tidak ditemukan untuk installPath ${installPath}`);
    })();
  }

  try {
    return await whatsappRuntimePromise;
  } catch (error) {
    whatsappRuntimePromise = null;
    throw createHttpError(
      503,
      `Plugin WhatsApp terpasang tetapi gagal dimuat: ${error?.message || String(error)}`,
    );
  }
}

function resolveWhatsAppAccount(config, accountId) {
  const accountConfig = config?.channels?.whatsapp?.accounts?.[accountId];

  if (!accountConfig) {
    throw createHttpError(404, `Account WhatsApp ${accountId} tidak ditemukan di runtime ini`);
  }

  const authDir = typeof accountConfig.authDir === 'string' && accountConfig.authDir.trim()
    ? accountConfig.authDir.trim()
    : `accounts/whatsapp/${accountId}`;

  return {
    accountId,
    authDir,
    isLegacyAuthDir: Boolean(accountConfig?.isLegacyAuthDir),
    name: accountConfig.name || null,
  };
}

async function resolveWhatsAppAccountContext(accountId) {
  const config = loadConfig();
  const account = resolveWhatsAppAccount(config, accountId);
  const runtimeApi = await loadWhatsAppRuntime(config);
  return { runtimeApi, account };
}

async function buildStatus(accountId) {
  const { runtimeApi, account } = await resolveWhatsAppAccountContext(accountId);
  const linked = await runtimeApi.webAuthExists(account.authDir);
  const self = linked
    ? runtimeApi.readWebSelfId(account.authDir)
    : { e164: null, jid: null, lid: null };
  const loginSnapshot = typeof runtimeApi.getActiveWebLoginSnapshot === 'function'
    ? await runtimeApi.getActiveWebLoginSnapshot(account.accountId).catch(() => null)
    : null;

  const status = {
    accountId: account.accountId,
    linked,
    connected: Boolean(runtimeApi.getActiveWebListener(account.accountId) || loginSnapshot?.connected),
    linkedName: account.name || null,
    linkedPhone: self.e164 || null,
    lastConnectedAt: null,
    message: loginSnapshot?.message || null,
    qrDataUrl: loginSnapshot?.qrDataUrl || null,
    qrExpiresAt: loginSnapshot?.qrExpiresAt || null,
    pairingCode: loginSnapshot?.pairingCode || null,
    pairingPhoneNumber: loginSnapshot?.pairingPhoneNumber || null,
    pairingInstructions: loginSnapshot?.pairingInstructions || null,
    lastError: loginSnapshot?.error || null,
    lastErrorCode: loginSnapshot?.code || null,
    loginFailureReason: loginSnapshot?.loginFailureReason || null,
    qrScannedAt: loginSnapshot?.qrScannedAt || null,
    browserConnectedAt: loginSnapshot?.browserConnectedAt || null,
    socketConnectedAt: loginSnapshot?.socketConnectedAt || null,
    authStateLoadedAt: loginSnapshot?.authStateLoadedAt || null,
    sessionPersistedAt: loginSnapshot?.sessionPersistedAt || null,
    lastDisconnectReason: loginSnapshot?.lastDisconnectReason || null,
    browserClosedUnexpectedly: loginSnapshot?.browserClosedUnexpectedly === true,
    whatsappSocketState: loginSnapshot?.whatsappSocketState || null,
    puppeteerBrowserState: loginSnapshot?.puppeteerBrowserState || null,
    lastSocketError: loginSnapshot?.lastSocketError || null,
    lastConnectionUpdate: loginSnapshot?.lastConnectionUpdate || null,
    lastDisconnectRaw: loginSnapshot?.lastDisconnectRaw || null,
    lastSocketErrorRaw: loginSnapshot?.lastSocketErrorRaw || null,
    restartAttempted: loginSnapshot?.restartAttempted === true,
    reconnectStartedAt: loginSnapshot?.reconnectStartedAt || null,
    reconnectElapsedMs: Number.isFinite(Number(loginSnapshot?.reconnectElapsedMs))
      ? Number(loginSnapshot.reconnectElapsedMs)
      : null,
    restoreAttemptCount: Number.isFinite(Number(loginSnapshot?.restoreAttemptCount))
      ? Number(loginSnapshot.restoreAttemptCount)
      : null,
    lastRestoreError: loginSnapshot?.lastRestoreError || null,
    forceQrTriggered: loginSnapshot?.forceQrTriggered === true,
    qrGenerationStartedAt: loginSnapshot?.qrGenerationStartedAt || null,
    rawRuntimePayload: sanitizeQrPayload(loginSnapshot),
  };

  const resolvedStatuses = resolveRuntimeStatuses({
    ...status,
    runtimeStatus: loginSnapshot?.runtimeStatus || null,
    linkState: loginSnapshot?.linkState || null,
  });

  return {
    ...status,
    runtimeStatus: loginSnapshot?.runtimeStatus || resolvedStatuses.runtimeStatus,
    linkState: loginSnapshot?.linkState || resolvedStatuses.linkState,
  };
}

async function handleStatus(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed', message: 'Gunakan POST' });
    }

    const body = await readJsonBody(req);
    const accountId = readRequiredAccountId(body);
    const status = await buildStatus(accountId);
    logBridge('status', {
      accountId,
      summary: summarizeQrPayload(status),
      rawRuntimePayload: status.rawRuntimePayload || null,
    });
    return sendJson(res, 200, status);
  } catch (error) {
    logBridge('status:error', { message: error?.message || String(error), statusCode: error?.statusCode || 500 });
    return sendJson(res, error?.statusCode || 500, {
      error: error?.statusCode ? 'Bad Request' : 'Internal Error',
      message: error?.message || 'Gagal membaca status WhatsApp',
    });
  }
}

async function handleStart(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed', message: 'Gunakan POST' });
    }

    const body = await readJsonBody(req);
    const accountId = readRequiredAccountId(body);
    const { runtimeApi, account } = await resolveWhatsAppAccountContext(accountId);
    logBridge('start:request', {
      accountId,
      force: body.force === true,
      timeoutMs: normalizeTimeoutMs(body.timeoutMs, 30000),
    });

    if (body.force === true && typeof runtimeApi.logoutWeb === 'function') {
      await runtimeApi.logoutWeb({
        authDir: account.authDir,
        isLegacyAuthDir: account.isLegacyAuthDir === true,
      });
    }

    const result = await runtimeApi.startWebLoginWithQr({
      accountId,
      force: body.force === true,
      timeoutMs: normalizeTimeoutMs(body.timeoutMs, 30000),
    });

    const status = await buildStatus(accountId);
    const responsePayload = {
      ...status,
      ...result,
      rawRuntimePayload: sanitizeQrPayload({
        ...(status.rawRuntimePayload || {}),
        ...(result || {}),
      }),
    };

    logBridge('start:response', {
      accountId,
      summary: summarizeQrPayload(responsePayload),
      rawRuntimePayload: responsePayload.rawRuntimePayload,
      status: summarizeQrPayload(status),
    });

    return sendJson(res, 200, responsePayload);
  } catch (error) {
    logBridge('start:error', { message: error?.message || String(error), statusCode: error?.statusCode || 500 });
    return sendJson(res, error?.statusCode || 500, {
      error: error?.statusCode ? 'Bad Request' : 'Internal Error',
      message: error?.message || 'Gagal memulai QR login WhatsApp',
    });
  }
}

async function handleWait(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed', message: 'Gunakan POST' });
    }

    const body = await readJsonBody(req);
    const accountId = readRequiredAccountId(body);
    const { runtimeApi } = await resolveWhatsAppAccountContext(accountId);
    logBridge('wait:request', {
      accountId,
      timeoutMs: normalizeTimeoutMs(body.timeoutMs, 120000),
    });
    const result = await runtimeApi.waitForWebLogin({
      accountId,
      timeoutMs: normalizeTimeoutMs(body.timeoutMs, 120000),
    });

    const status = await buildStatus(accountId);
    const responsePayload = {
      ...status,
      ...result,
      rawRuntimePayload: sanitizeQrPayload({
        ...(status.rawRuntimePayload || {}),
        ...(result || {}),
      }),
    };

    logBridge('wait:response', {
      accountId,
      summary: summarizeQrPayload(responsePayload),
      rawRuntimePayload: responsePayload.rawRuntimePayload,
      status: summarizeQrPayload(status),
    });

    return sendJson(res, 200, responsePayload);
  } catch (error) {
    logBridge('wait:error', { message: error?.message || String(error), statusCode: error?.statusCode || 500 });
    return sendJson(res, error?.statusCode || 500, {
      error: error?.statusCode ? 'Bad Request' : 'Internal Error',
      message: error?.message || 'Gagal menunggu QR login WhatsApp',
    });
  }
}

export default definePluginEntry({
  id: 'whatsapp-link-bridge',
  name: 'WhatsApp Link Bridge',
  description: 'Gateway-authenticated in-process WhatsApp QR bridge for myagentclaw',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  register(api) {
    api.registerHttpRoute({ path: ROUTES.status, auth: 'gateway', handler: handleStatus });
    api.registerHttpRoute({ path: ROUTES.start, auth: 'gateway', handler: handleStart });
    api.registerHttpRoute({ path: ROUTES.wait, auth: 'gateway', handler: handleWait });
  },
});
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { clearRuntimeConfigSnapshot, loadConfig } from 'openclaw/plugin-sdk/config-runtime';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const MAX_BODY_BYTES = 64 * 1024;
const FRESH_LOGIN_CONFIG_SYNC_TIMEOUT_MS = 5000;
const FRESH_LOGIN_CONFIG_SYNC_POLL_MS = 200;
const WHATSAPP_PLUGIN_IDS = ['whatsapp', '@openclaw/whatsapp'];
const START_ROUTE_ALIASES = Object.freeze([
  '/api/myagentclaw/whatsapp/link/start',
  '/api/whatsapp/link/start',
  '/channels/whatsapp/link/start',
  '/api/link/start',
]);
const WAIT_ROUTE_ALIASES = Object.freeze([
  '/api/myagentclaw/whatsapp/link/wait',
  '/api/whatsapp/link/wait',
  '/channels/whatsapp/link/wait',
  '/api/link/wait',
]);
const STATUS_ROUTE_ALIASES = Object.freeze([
  '/api/myagentclaw/whatsapp/link/status',
  '/api/whatsapp/link/status',
  '/channels/whatsapp/link/status',
  '/api/link/status',
]);
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

function resolveRequestPath(req) {
  try {
    return new URL(req?.url || '/', 'http://localhost').pathname;
  } catch {
    return String(req?.url || '/').split('?')[0] || '/';
  }
}

function logRouteHit(req) {
  const path = resolveRequestPath(req);
  logBridge(`Route hit: ${path}`, { path, method: req?.method || 'GET' });
  return path;
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
  const accountId = typeof body.accountId === 'string'
    ? body.accountId.trim()
    : typeof body.channelId === 'string'
      ? body.channelId.trim()
      : '';
  if (!accountId) {
    throw createHttpError(400, 'accountId diperlukan');
  }
  return accountId;
}

function readOptionalString(body = {}, key) {
  const value = body?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFreshAuthNamespace(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

function resolveFreshAuthDir(authNamespace) {
  const normalized = normalizeFreshAuthNamespace(authNamespace);
  return normalized ? `auth/${normalized}` : '';
}

function createDetailedHttpError(statusCode, message, details = null) {
  const error = createHttpError(statusCode, message);
  if (details) {
    error.details = sanitizeQrPayload(details);
  }
  return error;
}

function validateFreshLoginPayload({
  agentId,
  channelId,
  authNamespace,
  runtimeSessionId,
  adapterSessionId,
  previousAuthNamespace,
  previousRuntimeSessionId,
  previousAdapterSessionId,
}) {
  if (!agentId) {
    throw createDetailedHttpError(400, 'agentId diperlukan untuk fresh login', { channelId: channelId || null });
  }

  if (!channelId) {
    throw createDetailedHttpError(400, 'channelId diperlukan untuk fresh login', { agentId });
  }

  if (!authNamespace || !runtimeSessionId || !adapterSessionId) {
    throw createDetailedHttpError(409, 'Fresh login harus memakai authNamespace, runtimeSessionId, dan adapterSessionId baru.', {
      agentId,
      channelId,
      authNamespace: authNamespace || null,
      runtimeSessionId: runtimeSessionId || null,
      adapterSessionId: adapterSessionId || null,
    });
  }

  if (
    authNamespace === previousAuthNamespace
    || runtimeSessionId === previousRuntimeSessionId
    || adapterSessionId === previousAdapterSessionId
  ) {
    throw createDetailedHttpError(409, 'Fresh login masih memakai state lama.', {
      agentId,
      channelId,
      authNamespace,
      runtimeSessionId,
      adapterSessionId,
      previousAuthNamespace: previousAuthNamespace || null,
      previousRuntimeSessionId: previousRuntimeSessionId || null,
      previousAdapterSessionId: previousAdapterSessionId || null,
    });
  }
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

async function resolveWhatsAppAccountContext(accountId, options = {}) {
  const expectedAuthDir = resolveFreshAuthDir(options.authNamespace);
  const shouldRetry = options.forceFreshLogin === true || options.forceRefreshConfig === true;
  const deadline = Date.now() + FRESH_LOGIN_CONFIG_SYNC_TIMEOUT_MS;
  let lastError = null;

  while (true) {
    try {
      if (options.forceRefreshConfig === true || options.forceFreshLogin === true) {
        clearRuntimeConfigSnapshot();
      }

      const config = loadConfig();
      const account = resolveWhatsAppAccount(config, accountId);
      const runtimeApi = await loadWhatsAppRuntime(config);
      const authMatches = !expectedAuthDir || account.authDir === expectedAuthDir;

      if (authMatches) {
        return { runtimeApi, account };
      }

      lastError = createDetailedHttpError(409, 'Fresh login runtime config belum sinkron.', {
        accountId,
        expectedAuthDir: expectedAuthDir || null,
        observedAuthDir: account.authDir || null,
        runtimeSessionId: options.runtimeSessionId || null,
        adapterSessionId: options.adapterSessionId || null,
      });
    } catch (error) {
      lastError = error;
    }

    if (!shouldRetry || Date.now() >= deadline) {
      throw lastError;
    }

    await waitMs(FRESH_LOGIN_CONFIG_SYNC_POLL_MS);
  }
}

async function buildStatus(accountId, options = {}) {
  const { runtimeApi, account } = await resolveWhatsAppAccountContext(accountId, options);
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

async function recoverFreshLoginStatus(accountId, responsePayload, options = {}) {
  let nextPayload = responsePayload;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const hasArtifact = Boolean(nextPayload?.qrDataUrl || nextPayload?.pairingCode);
    const errorText = String(nextPayload?.lastError || nextPayload?.message || '').trim();

    if (hasArtifact || !/not found/i.test(errorText)) {
      return nextPayload;
    }

    logBridge('fresh-login:status-retry-after-not-found', {
      accountId,
      attempt: attempt + 1,
      errorText,
    });

    await waitMs(FRESH_LOGIN_CONFIG_SYNC_POLL_MS);
    const status = await buildStatus(accountId, {
      ...options,
      forceFreshLogin: true,
      forceRefreshConfig: true,
    });

    nextPayload = {
      ...nextPayload,
      ...status,
      rawRuntimePayload: sanitizeQrPayload({
        ...(status.rawRuntimePayload || {}),
        ...(nextPayload.rawRuntimePayload || {}),
      }),
    };
  }

  return nextPayload;
}

async function handleStatus(req, res) {
  try {
    const routePath = logRouteHit(req);
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed', message: 'Gunakan POST' });
    }

    const body = await readJsonBody(req);
    const accountId = readRequiredAccountId(body);
    const status = await buildStatus(accountId);
    logBridge('status', {
      routePath,
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
  let accountId = null;
  let agentId = null;
  let channelId = null;
  let runtimeSessionId = null;
  let adapterSessionId = null;
  let forceFreshLogin = false;

  try {
    const routePath = logRouteHit(req);
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed', message: 'Gunakan POST' });
    }

    const body = await readJsonBody(req);
    accountId = readRequiredAccountId(body);
    forceFreshLogin = body.forceFreshLogin === true;
    channelId = readOptionalString(body, 'channelId') || accountId;
    agentId = readOptionalString(body, 'agentId') || null;
    const previousAuthDir = readOptionalString(body, 'previousAuthDir');
    const previousAuthNamespace = readOptionalString(body, 'previousAuthNamespace');
    const authNamespace = readOptionalString(body, 'authNamespace');
    runtimeSessionId = readOptionalString(body, 'runtimeSessionId');
    adapterSessionId = readOptionalString(body, 'adapterSessionId');
    const previousRuntimeSessionId = readOptionalString(body, 'previousRuntimeSessionId');
    const previousAdapterSessionId = readOptionalString(body, 'previousAdapterSessionId');

    if (forceFreshLogin) {
      console.log('[Fresh Login] Incoming payload', {
        agentId,
        channelId,
        runtimeSessionId: runtimeSessionId || null,
        adapterSessionId: adapterSessionId || null,
        forceFreshLogin,
      });
      validateFreshLoginPayload({
        agentId,
        channelId,
        authNamespace,
        runtimeSessionId,
        adapterSessionId,
        previousAuthNamespace,
        previousRuntimeSessionId,
        previousAdapterSessionId,
      });
      console.log('[Fresh Login] Step 3: Remove old auth');
      console.log('[Fresh Login] Step 5: Build new auth folder', {
        channelId,
        authNamespace,
        authDir: resolveFreshAuthDir(authNamespace) || null,
      });
    }

    const contextOptions = forceFreshLogin
      ? {
          forceFreshLogin: true,
          forceRefreshConfig: true,
          authNamespace,
          runtimeSessionId,
          adapterSessionId,
        }
      : {};
    const { runtimeApi, account } = await resolveWhatsAppAccountContext(accountId, contextOptions);

    if (forceFreshLogin) {
      logBridge('Fresh login handler entered', {
        routePath,
        accountId,
        channelId,
        agentId,
      });
    }

    if (forceFreshLogin) {
      logBridge('fresh-login:requested', {
        routePath,
        accountId,
        channelId,
        agentId,
        previousAuthNamespace: previousAuthNamespace || null,
        previousAuthDir: previousAuthDir || null,
        previousRuntimeSessionId: previousRuntimeSessionId || null,
        previousAdapterSessionId: previousAdapterSessionId || null,
        authNamespace: authNamespace || null,
        runtimeSessionId: runtimeSessionId || null,
        adapterSessionId: adapterSessionId || null,
      });
      logBridge('fresh-login:config-ready', {
        routePath,
        accountId,
        authDir: account.authDir,
        authNamespace: authNamespace || null,
        runtimeSessionId: runtimeSessionId || null,
        adapterSessionId: adapterSessionId || null,
      });
    }

    logBridge('start:request', {
      accountId,
      force: body.force === true || forceFreshLogin,
      forceFreshLogin,
      timeoutMs: normalizeTimeoutMs(body.timeoutMs, 30000),
    });

    if (forceFreshLogin && previousAuthDir && typeof runtimeApi.logoutWeb === 'function') {
      await runtimeApi.logoutWeb({
        authDir: previousAuthDir,
        isLegacyAuthDir: false,
      }).catch(() => null);
      logBridge('Existing auth removed', {
        accountId,
        previousAuthNamespace: previousAuthNamespace || null,
        previousAuthDir,
      });
    }

    if (forceFreshLogin) {
      logBridge('Existing runtime removed', {
        routePath,
        accountId,
        previousRuntimeSessionId: previousRuntimeSessionId || null,
        previousAdapterSessionId: previousAdapterSessionId || null,
      });
    }

    if ((body.force === true || forceFreshLogin) && typeof runtimeApi.logoutWeb === 'function') {
      await runtimeApi.logoutWeb({
        authDir: account.authDir,
        isLegacyAuthDir: account.isLegacyAuthDir === true,
      });
    }

    if (forceFreshLogin) {
      logBridge('New namespace generated', {
        routePath,
        accountId,
        authNamespace: authNamespace || account.authDir,
        runtimeSessionId: runtimeSessionId || null,
        adapterSessionId: adapterSessionId || null,
      });
      console.log('[Fresh Login] Step 7: Start QR generation');
      logBridge('QR generation started', {
        routePath,
        accountId,
        authNamespace: authNamespace || account.authDir,
        runtimeSessionId: runtimeSessionId || null,
        adapterSessionId: adapterSessionId || null,
      });
    }

    const result = await runtimeApi.startWebLoginWithQr({
      accountId,
      force: body.force === true || forceFreshLogin,
      timeoutMs: normalizeTimeoutMs(body.timeoutMs, 30000),
    });

    const status = await buildStatus(accountId, contextOptions);
    let responsePayload = {
      ...status,
      ...result,
      rawRuntimePayload: sanitizeQrPayload({
        ...(status.rawRuntimePayload || {}),
        ...(result || {}),
      }),
    };

    if (forceFreshLogin) {
      responsePayload = await recoverFreshLoginStatus(accountId, responsePayload, contextOptions);
    }

    logBridge('start:response', {
      routePath,
      accountId,
      forceFreshLogin,
      summary: summarizeQrPayload(responsePayload),
      rawRuntimePayload: responsePayload.rawRuntimePayload,
      status: summarizeQrPayload(status),
    });

    if (forceFreshLogin && (responsePayload?.qrDataUrl || responsePayload?.pairingCode)) {
      logBridge('QR generated successfully', {
        routePath,
        accountId,
        authNamespace: authNamespace || account.authDir,
        summary: summarizeQrPayload(responsePayload),
      });
    }

    if (forceFreshLogin) {
      console.log('[Fresh Login] Step 8: Return QR payload');
    }

    return sendJson(res, 200, responsePayload);
  } catch (error) {
    if (forceFreshLogin) {
      console.error('[Fresh Login] Failed', {
        message: error?.message || String(error),
        stack: error?.stack || null,
        agentId,
        channelId,
        runtimeSessionId,
        adapterSessionId,
      });
    }
    logBridge('start:error', { message: error?.message || String(error), statusCode: error?.statusCode || 500 });
    return sendJson(res, error?.statusCode || 500, {
      error: error?.statusCode ? 'Bad Request' : 'Internal Error',
      message: error?.message || 'Gagal memulai QR login WhatsApp',
      details: error?.details || null,
    });
  }
}

async function handleWait(req, res) {
  try {
    const routePath = logRouteHit(req);
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method Not Allowed', message: 'Gunakan POST' });
    }

    const body = await readJsonBody(req);
    const accountId = readRequiredAccountId(body);
    const { runtimeApi } = await resolveWhatsAppAccountContext(accountId);
    logBridge('wait:request', {
      routePath,
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
      routePath,
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
    for (const path of STATUS_ROUTE_ALIASES) {
      api.registerHttpRoute({ path, auth: 'gateway', handler: handleStatus });
    }
    for (const path of START_ROUTE_ALIASES) {
      api.registerHttpRoute({ path, auth: 'gateway', handler: handleStart });
    }
    for (const path of WAIT_ROUTE_ALIASES) {
      api.registerHttpRoute({ path, auth: 'gateway', handler: handleWait });
    }
  },
});
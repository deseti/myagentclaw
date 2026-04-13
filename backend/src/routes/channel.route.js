import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { buildGatewayAgentConfig as buildGatewayConfig } from '../lib/agent-config.js';
import {
  ocGetWhatsAppLinkStatus,
  ocListChannels,
  ocStartWhatsAppLink,
  ocStartChannel,
  ocStopChannel,
  ocWaitWhatsAppLink,
  ocStartBot,
  validateTelegramBotToken,
} from '../lib/openclaw-client.js';
import { ensureRuntimeWhatsAppPluginInstalled, ensureWorkspaceRuntime, listCandidateAdapterUrls } from '../lib/runtime-manager.js';
import {
  CHANNEL_TYPES,
  channelUsesBotToken,
  channelUsesQrLogin,
  getChannelLabel,
  normalizeChannelType,
} from '../lib/channel-utils.js';

const connectSchema = z.discriminatedUnion('type', [
  z.object({
    agentId: z.string().min(1),
    type: z.literal(CHANNEL_TYPES.TELEGRAM),
    botToken: z.string().min(20),
  }),
  z.object({
    agentId: z.string().min(1),
    type: z.literal(CHANNEL_TYPES.WHATSAPP),
  }),
]);

const whatsappLinkSchema = z.object({
  force: z.boolean().optional(),
  forceFreshLogin: z.boolean().optional(),
  agentId: z.string().min(1).optional(),
});

const RESTORE_SESSION_TIMEOUT_MS = 10000;
const AUTO_FORCE_NEW_QR_AFTER_MS = 15000;
const FORCE_START_TIMEOUT_MS = 45000;
const RESTORE_SESSION_MESSAGE = 'Mencoba mengaktifkan sesi WhatsApp lama.';
const FORCE_NEW_QR_MESSAGE = 'Restore session terlalu lama, sistem membuat QR baru...';
const MANUAL_FRESH_LOGIN_MESSAGE = 'Memulai login WhatsApp baru khusus agent ini.';

function normalizeLinkState(value) {
  return String(value || '').trim().toUpperCase();
}

function elapsedMsSince(timestamp) {
  if (!timestamp) {
    return 0;
  }

  const startedAt = new Date(timestamp);
  if (Number.isNaN(startedAt.getTime())) {
    return 0;
  }

  return Math.max(0, Date.now() - startedAt.getTime());
}

function hasUsableWhatsAppArtifact(payload = {}) {
  const runtimeStatus = normalizeLinkState(payload?.runtimeStatus);
  const linkState = normalizeLinkState(payload?.linkState);
  const progressStates = ['WAITING_QR', 'QR_SCANNED', 'AUTH_LOADING', 'SESSION_SAVING', 'WAITING_SOCKET_CONNECT', 'CONNECTED'];

  return Boolean(
    payload?.connected
    || payload?.qrDataUrl
    || payload?.pairingCode
    || payload?.qrScannedAt
    || payload?.sessionPersistedAt
    || payload?.socketConnectedAt
    || progressStates.includes(runtimeStatus)
    || progressStates.includes(linkState)
  );
}

function buildWhatsAppDebugState(channel, patch = {}) {
  const sessionData = channel?.sessionData || {};
  const reconnectStartedAt = patch.reconnectStartedAt !== undefined
    ? patch.reconnectStartedAt
    : sessionData.reconnectStartedAt || null;
  const qrGenerationStartedAt = patch.qrGenerationStartedAt !== undefined
    ? patch.qrGenerationStartedAt
    : sessionData.qrGenerationStartedAt || null;

  return {
    reconnectStartedAt,
    reconnectElapsedMs: patch.reconnectElapsedMs !== undefined
      ? patch.reconnectElapsedMs
      : elapsedMsSince(reconnectStartedAt),
    restoreAttemptCount: patch.restoreAttemptCount !== undefined
      ? Number(patch.restoreAttemptCount || 0)
      : Number(sessionData.restoreAttemptCount || 0),
    lastRestoreError: patch.lastRestoreError !== undefined
      ? patch.lastRestoreError
      : sessionData.lastRestoreError || null,
    forceQrTriggered: patch.forceQrTriggered !== undefined
      ? patch.forceQrTriggered === true
      : sessionData.forceQrTriggered === true,
    qrGenerationStartedAt,
  };
}

function normalizeWhatsAppSessionSegment(value, fallback = 'unassigned') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function buildWhatsAppSessionIdentity(channel = {}) {
  const agentId = String(channel?.agentId || channel?.agent?.id || '').trim();
  const agentSegment = normalizeWhatsAppSessionSegment(agentId);

  return {
    loginOwnerAgentId: agentId || null,
    authNamespace: `agent-${agentSegment}/whatsapp`,
    runtimeSessionId: `runtime-agent-${agentSegment}-whatsapp`,
    adapterSessionId: `adapter-agent-${agentSegment}-whatsapp`,
  };
}

function resolveWhatsAppAuthDir(authNamespace) {
  const normalized = String(authNamespace || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');

  return normalized ? `auth/${normalized}` : null;
}

function buildWhatsAppGatewayAgentConfig(channel, agent) {
  const sessionData = buildMergedSessionData(channel, {});
  const sessionIdentity = buildWhatsAppSessionIdentity(channel);

  return buildGatewayAgentConfig(agent, {
    channelType: CHANNEL_TYPES.WHATSAPP,
    whatsappAuthNamespace: sessionData.authNamespace || sessionIdentity.authNamespace,
    runtimeSessionId: sessionData.runtimeSessionId || sessionIdentity.runtimeSessionId,
    adapterSessionId: sessionData.adapterSessionId || sessionIdentity.adapterSessionId,
  });
}

function buildPreviousWhatsAppSessionState(channel = {}) {
  const sessionData = channel?.sessionData || {};

  return {
    previousAuthNamespace: typeof sessionData.authNamespace === 'string' && sessionData.authNamespace.trim()
      ? sessionData.authNamespace.trim()
      : null,
    previousRuntimeSessionId: typeof sessionData.runtimeSessionId === 'string' && sessionData.runtimeSessionId.trim()
      ? sessionData.runtimeSessionId.trim()
      : null,
    previousAdapterSessionId: typeof sessionData.adapterSessionId === 'string' && sessionData.adapterSessionId.trim()
      ? sessionData.adapterSessionId.trim()
      : null,
  };
}

function createFreshWhatsAppSessionIdentity(channel = {}) {
  const baseIdentity = buildWhatsAppSessionIdentity(channel);
  const agentId = baseIdentity.loginOwnerAgentId || String(channel?.agentId || channel?.agent?.id || '').trim();
  const agentSegment = normalizeWhatsAppSessionSegment(agentId);
  const freshRuntimeSessionId = randomUUID();
  const freshAdapterSessionId = randomUUID();
  const freshAuthNamespace = `agent-${agentSegment}-whatsapp-${Date.now()}`;

  return {
    loginOwnerAgentId: agentId || null,
    authNamespace: freshAuthNamespace,
    runtimeSessionId: freshRuntimeSessionId,
    adapterSessionId: freshAdapterSessionId,
  };
}

async function prepareFreshWhatsAppLoginChannel(channel, logger = console) {
  const previousState = buildPreviousWhatsAppSessionState(channel);
  const nextIdentity = createFreshWhatsAppSessionIdentity(channel);
  const requestedAt = new Date().toISOString();
  const nextAuthDir = resolveWhatsAppAuthDir(nextIdentity.authNamespace);

  console.log('[Fresh Login] Step 4: Generate new namespace', {
    agentId: channel.agentId,
    channelId: channel.id,
    authNamespace: nextIdentity.authNamespace,
    runtimeSessionId: nextIdentity.runtimeSessionId,
    adapterSessionId: nextIdentity.adapterSessionId,
  });
  console.log('[Fresh Login] Step 5: Build new auth folder', {
    agentId: channel.agentId,
    channelId: channel.id,
    authNamespace: nextIdentity.authNamespace,
    authDir: nextAuthDir,
  });

  logger.info({
    channelId: channel.id,
    agentId: channel.agentId,
    ...previousState,
  }, 'Fresh login requested');

  const updated = await prisma.channel.update({
    where: { id: channel.id },
    data: {
      status: 'CONNECTING',
      sessionData: buildMergedSessionData(channel, {
        ...nextIdentity,
        connected: false,
        linkState: 'FORCE_NEW_QR',
        loginStrategy: 'FRESH',
        statusMessage: MANUAL_FRESH_LOGIN_MESSAGE,
        lastLinkMessage: MANUAL_FRESH_LOGIN_MESSAGE,
        lastError: null,
        lastErrorCode: null,
        qrIssuedAt: null,
        qrDataUrl: null,
        qrExpiresAt: null,
        pairingCode: null,
        pairingPhoneNumber: null,
        pairingInstructions: null,
        adapterError: null,
        reconnectStartedAt: requestedAt,
        reconnectElapsedMs: 0,
        restoreAttemptCount: Math.max(1, Number(channel.sessionData?.restoreAttemptCount || 0) + 1),
        lastRestoreError: 'Fresh login diminta manual.',
        forceQrTriggered: true,
        qrGenerationStartedAt: requestedAt,
        rawRuntimePayload: sanitizeQrPayload({
          freshLoginRequestedAt: requestedAt,
          ...previousState,
          newAuthNamespace: nextIdentity.authNamespace,
          newRuntimeSessionId: nextIdentity.runtimeSessionId,
          newAdapterSessionId: nextIdentity.adapterSessionId,
        }),
      }),
    },
  });

  logger.info({
    channelId: channel.id,
    agentId: channel.agentId,
    ...previousState,
    authNamespace: nextIdentity.authNamespace,
    runtimeSessionId: nextIdentity.runtimeSessionId,
    adapterSessionId: nextIdentity.adapterSessionId,
  }, 'New auth namespace created');

  return { updated, previousState };
}

function shouldAutoForceNewQr(channel, snapshot = null) {
  if (hasUsableWhatsAppArtifact(snapshot)) {
    return false;
  }

  const sessionData = channel?.sessionData || {};
  const runtimeStatus = normalizeLinkState(snapshot?.runtimeStatus);
  const linkState = normalizeLinkState(snapshot?.linkState || sessionData.linkState);
  const isReconnectState = runtimeStatus === 'CONNECTING'
    || ['RECONNECTING', 'FORCE_NEW_QR', 'WAITING_QR', 'CONNECTING', ''].includes(linkState);

  if (!isReconnectState) {
    return false;
  }

  if (sessionData.forceQrTriggered === true) {
    return elapsedMsSince(sessionData.qrGenerationStartedAt) >= FORCE_START_TIMEOUT_MS;
  }

  if (!sessionData.reconnectStartedAt) {
    return linkState === 'RECONNECTING';
  }

  return elapsedMsSince(sessionData.reconnectStartedAt) >= AUTO_FORCE_NEW_QR_AFTER_MS;
}

function parseAdapterTransportError(error) {
  const message = String(error?.message || error || 'Gateway request gagal');
  const match = message.match(/->\s*(\d+):\s*([\s\S]*)$/);
  const statusCode = match ? Number(match[1]) : 502;
  const rawBody = match ? match[2] : message;

  try {
    const payload = JSON.parse(rawBody);
    if (payload && typeof payload === 'object') {
      return {
        statusCode: Number.isFinite(statusCode) ? statusCode : 502,
        payload,
        rawBody,
      };
    }
  } catch {
    // fall through
  }

  return {
    statusCode: Number.isFinite(statusCode) ? statusCode : 502,
    payload: {
      error: 'Bad Gateway',
      message: rawBody || message,
    },
    rawBody,
  };
}

function classifyWhatsAppTransportFailure(error) {
  const failure = error?.payload ? error : parseAdapterTransportError(error);
  const joinedText = [
    failure.payload?.code,
    failure.payload?.error,
    failure.payload?.message,
    failure.rawBody,
  ].filter(Boolean).join(' ');
  const text = joinedText.toLowerCase();

  if ((/qr/.test(text) && /(expired|kedaluwarsa)/.test(text)) || /code expired/.test(text)) {
    return {
      ...failure,
      code: 'QR_EXPIRED',
      linkState: 'QR_EXPIRED',
      channelStatus: 'CONNECTING',
      userMessage: 'QR WhatsApp sudah kedaluwarsa. Buat QR baru untuk login ulang.',
      shouldRetryWithForce: true,
      isExpectedState: true,
    };
  }

  if (/(timed out|timeout|still waiting|waiting for qr|waiting.*scan|scan qr|belum dipindai|belum discan)/.test(text)) {
    return {
      ...failure,
      code: 'WAITING_QR',
      linkState: 'WAITING_QR',
      channelStatus: 'CONNECTING',
      userMessage: 'QR WhatsApp masih menunggu dipindai. Scan QR lalu cek status lagi.',
      shouldRetryWithForce: false,
      isExpectedState: true,
    };
  }

  if (/(not linked|pairing required|session.*(invalid|expired|missing)|login required|requires qr|relogin|logged out|unauthorized|forbidden)/.test(text)) {
    return {
      ...failure,
      code: 'SESSION_INVALID',
      linkState: 'SESSION_INVALID',
      channelStatus: 'CONNECTING',
      userMessage: 'Sesi WhatsApp lama tidak valid. Scan QR baru untuk login ulang.',
      shouldRetryWithForce: true,
      isExpectedState: true,
    };
  }

  return {
    ...failure,
    code: 'ADAPTER_ERROR',
    linkState: 'FAILED',
    channelStatus: 'DISCONNECTED',
    userMessage: failure.payload?.message || 'Gagal berkomunikasi dengan runtime WhatsApp.',
    shouldRetryWithForce: false,
    isExpectedState: false,
  };
}

function buildMergedSessionData(channel, patch = {}) {
  return {
    ...(channel?.type === CHANNEL_TYPES.WHATSAPP ? buildWhatsAppSessionIdentity(channel) : {}),
    ...(channel.sessionData || {}),
    ...patch,
  };
}

function resolveChannelRuntimeStatus(channel, agentStatus = 'ACTIVE') {
  const linkState = normalizeLinkState(channel?.sessionData?.linkState);

  if (channel?.status === 'CONNECTED') {
    return agentStatus === 'ACTIVE' ? 'CONNECTED' : 'PAUSED';
  }

  if (['QR_SCANNED', 'AUTH_LOADING', 'SESSION_SAVING', 'WAITING_SOCKET_CONNECT'].includes(linkState)) return linkState;
  if (linkState === 'WAITING_QR') return 'WAITING_QR';
  if (linkState === 'RECONNECTING') return 'RECONNECTING';
  if (linkState === 'QR_EXPIRED') return 'QR_EXPIRED';
  if (linkState === 'SESSION_INVALID') return 'REQUIRES_QR';
  if (linkState === 'LOGIN_FAILED') return 'LOGIN_FAILED';
  if (linkState === 'FAILED') return 'ERROR';

  if (channel?.status === 'CONNECTING') {
    return 'CONNECTING';
  }

  return 'DISCONNECTED';
}

function buildGatewayAgentConfig(agent, extra = {}) {
  return buildGatewayConfig(agent, extra);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  if (copy.channel && typeof copy.channel === 'object') {
    copy.channel = sanitizeQrPayload(copy.channel);
  }
  if (copy.rawRuntimePayload && typeof copy.rawRuntimePayload === 'object') {
    copy.rawRuntimePayload = sanitizeQrPayload(copy.rawRuntimePayload);
  }
  return copy;
}

function summarizeWhatsAppPayload(payload = {}) {
  const source = payload || {};
  const channel = source.channel || {};
  const qrDataUrl = source.qrDataUrl || channel.qrDataUrl || null;
  const pairingCode = source.pairingCode || channel.pairingCode || null;

  return {
    runtimeStatus: source.runtimeStatus || channel.runtimeStatus || null,
    linkState: source.linkState || channel.linkState || null,
    qrDataUrlPresent: Boolean(qrDataUrl),
    qrDataUrlLength: typeof qrDataUrl === 'string' ? qrDataUrl.length : 0,
    pairingCodePresent: Boolean(pairingCode),
    pairingPhoneNumber: source.pairingPhoneNumber || channel.pairingPhoneNumber || null,
    lastError: source.lastError || channel.lastError || null,
    adapterError: source.adapterError || channel.adapterError || null,
    message: source.message || channel.statusMessage || null,
    code: source.code || channel.lastErrorCode || null,
  };
}

function logWhatsAppDebug(logger, stage, channelId, payload = {}, extra = {}) {
  logger.info({
    channelId,
    ...extra,
    summary: summarizeWhatsAppPayload(payload),
    rawPayload: sanitizeQrPayload(payload?.rawRuntimePayload || payload),
  }, `WhatsApp debug: ${stage}`);
}

function missingQrState(runtimePayload = {}, currentLinkState = 'RECONNECTING') {
  const runtimeStatus = normalizeLinkState(runtimePayload?.runtimeStatus);
  const normalizedCurrentLinkState = normalizeLinkState(currentLinkState);
  const progressStates = ['QR_SCANNED', 'AUTH_LOADING', 'SESSION_SAVING', 'WAITING_SOCKET_CONNECT'];

  if (runtimeStatus === 'CONNECTED') {
    return 'CONNECTED';
  }
  if (runtimeStatus === 'LOGIN_FAILED') {
    return 'LOGIN_FAILED';
  }
  if (progressStates.includes(runtimeStatus)) {
    return runtimeStatus;
  }
  if (runtimeStatus === 'WAITING_QR' || runtimePayload?.qrDataUrl || runtimePayload?.pairingCode) {
    return 'WAITING_QR';
  }

  if (runtimePayload?.forceQrTriggered || normalizedCurrentLinkState === 'FORCE_NEW_QR') {
    return 'FORCE_NEW_QR';
  }

  if (progressStates.includes(normalizedCurrentLinkState)) {
    return normalizedCurrentLinkState;
  }

  if (normalizedCurrentLinkState === 'LOGIN_FAILED') {
    return 'LOGIN_FAILED';
  }

  if (normalizedCurrentLinkState === 'WAITING_QR') {
    return 'WAITING_QR';
  }

  if (runtimePayload?.linked || ['RECONNECTING', 'QR_EXPIRED'].includes(normalizedCurrentLinkState)) {
    return 'RECONNECTING';
  }

  return 'WAITING_QR';
}

function buildChannelPayload(channel, overrides = {}) {
  const { sessionData: overrideSessionData, includeQr = false, ...restOverrides } = overrides;
  const sessionData = buildMergedSessionData(channel, overrideSessionData || {});
  const status = restOverrides.status || channel.status;
  const agentStatus = restOverrides.agentStatus || channel.agent?.status || restOverrides.agentStatus || 'ACTIVE';
  const sessionIdentity = channel?.type === CHANNEL_TYPES.WHATSAPP ? buildWhatsAppSessionIdentity(channel) : null;
  const runtimeStatus = restOverrides.runtimeStatus || resolveChannelRuntimeStatus({
    ...channel,
    status,
    sessionData,
  }, agentStatus);

  return {
    id: channel.id,
    agentId: channel.agentId || channel.agent?.id || null,
    type: channel.type,
    status,
    ...('botUsername' in sessionData ? { botUsername: sessionData.botUsername || null } : {}),
    ...('botName' in sessionData ? { botName: sessionData.botName || null } : {}),
    ...('linkedPhone' in sessionData ? { linkedPhone: sessionData.linkedPhone || null } : {}),
    ...('linkedName' in sessionData ? { linkedName: sessionData.linkedName || null } : {}),
    ...(includeQr ? {
      qrDataUrl: sessionData.qrDataUrl || null,
      qrExpiresAt: sessionData.qrExpiresAt || null,
      pairingCode: sessionData.pairingCode || null,
      pairingPhoneNumber: sessionData.pairingPhoneNumber || null,
      pairingInstructions: sessionData.pairingInstructions || null,
      adapterError: sessionData.adapterError || null,
      rawRuntimePayload: sessionData.rawRuntimePayload || null,
      qrScannedAt: sessionData.qrScannedAt || null,
      browserConnectedAt: sessionData.browserConnectedAt || null,
      socketConnectedAt: sessionData.socketConnectedAt || null,
      authStateLoadedAt: sessionData.authStateLoadedAt || null,
      sessionPersistedAt: sessionData.sessionPersistedAt || null,
      lastDisconnectReason: sessionData.lastDisconnectReason || null,
      loginFailureReason: sessionData.loginFailureReason || null,
      browserClosedUnexpectedly: sessionData.browserClosedUnexpectedly === true,
      whatsappSocketState: sessionData.whatsappSocketState || null,
      puppeteerBrowserState: sessionData.puppeteerBrowserState || null,
      lastSocketError: sessionData.lastSocketError || null,
      lastConnectionUpdate: sessionData.lastConnectionUpdate || null,
    } : {}),
    linked: sessionData.linked ?? null,
    connected: sessionData.connected ?? null,
    linkState: sessionData.linkState || null,
    ...(sessionIdentity ? {
      loginOwnerAgentId: sessionData.loginOwnerAgentId || sessionIdentity.loginOwnerAgentId,
      authNamespace: sessionData.authNamespace || sessionIdentity.authNamespace,
      runtimeSessionId: sessionData.runtimeSessionId || sessionIdentity.runtimeSessionId,
      adapterSessionId: sessionData.adapterSessionId || sessionIdentity.adapterSessionId,
      loginStrategy: sessionData.loginStrategy || null,
    } : {}),
    lastError: sessionData.lastError || null,
    lastErrorCode: sessionData.lastErrorCode || null,
    lastLinkMessage: sessionData.lastLinkMessage || null,
    reconnectStartedAt: sessionData.reconnectStartedAt || null,
    reconnectElapsedMs: Number.isFinite(Number(sessionData.reconnectElapsedMs))
      ? Number(sessionData.reconnectElapsedMs)
      : elapsedMsSince(sessionData.reconnectStartedAt),
    restoreAttemptCount: Number(sessionData.restoreAttemptCount || 0),
    lastRestoreError: sessionData.lastRestoreError || null,
    forceQrTriggered: sessionData.forceQrTriggered === true,
    qrGenerationStartedAt: sessionData.qrGenerationStartedAt || null,
    statusMessage: restOverrides.statusMessage || sessionData.statusMessage || sessionData.lastLinkMessage || sessionData.lastError || null,
    qrIssuedAt: sessionData.qrIssuedAt || null,
    qrExpiresAt: sessionData.qrExpiresAt || null,
    agentStatus,
    runtimeStatus,
    isPolling: restOverrides.isPolling ?? runtimeStatus === 'CONNECTED',
    ...restOverrides,
  };
}

function emitChannelUpdate(io, channel, agentStatus = 'ACTIVE', action = 'updated') {
  if (!io || !channel?.workspaceId) {
    return;
  }

  io.to(`workspace:${channel.workspaceId}`).emit('channel.updated', {
    action,
    workspaceId: channel.workspaceId,
    channel: buildChannelPayload(channel, { agentStatus, includeQr: true }),
  });
}

async function getWhatsAppAccountSnapshot(runtime, accountId) {
  return ocGetWhatsAppLinkStatus(accountId, runtime);
}

async function waitForWhatsAppAccountSnapshot(runtime, accountId, attempts = 3, delayMs = 1200) {
  let latest = null;

  for (let index = 0; index < attempts; index += 1) {
    latest = await getWhatsAppAccountSnapshot(runtime, accountId).catch(() => latest);
    if (hasUsableWhatsAppArtifact(latest)) {
      return latest;
    }
    if (index < attempts - 1) {
      await sleep(delayMs);
    }
  }

  return latest;
}

async function persistWhatsAppFailureState(channel, classification, extraSessionData = {}) {
  const normalizedLinkState = String(classification.linkState || 'FAILED').trim().toUpperCase();
  const shouldClearQr = ['QR_EXPIRED', 'SESSION_INVALID', 'FAILED'].includes(normalizedLinkState);
  const shouldClearPairing = shouldClearQr || normalizedLinkState === 'FAILED';
  const sessionData = buildMergedSessionData(channel, {
    ...extraSessionData,
    connected: false,
    linkState: classification.linkState || 'FAILED',
    statusMessage: classification.userMessage,
    lastError: classification.userMessage,
    lastErrorCode: classification.code,
  });

  if (shouldClearQr) {
    sessionData.qrDataUrl = null;
    sessionData.qrExpiresAt = null;
  } else {
    sessionData.qrDataUrl = extraSessionData.qrDataUrl !== undefined
      ? extraSessionData.qrDataUrl
      : channel.sessionData?.qrDataUrl || null;
    sessionData.qrExpiresAt = extraSessionData.qrExpiresAt !== undefined
      ? extraSessionData.qrExpiresAt
      : channel.sessionData?.qrExpiresAt || null;
  }

  if (shouldClearPairing) {
    sessionData.pairingCode = null;
    sessionData.pairingPhoneNumber = null;
    sessionData.pairingInstructions = null;
  } else {
    sessionData.pairingCode = extraSessionData.pairingCode !== undefined
      ? extraSessionData.pairingCode
      : channel.sessionData?.pairingCode || null;
    sessionData.pairingPhoneNumber = extraSessionData.pairingPhoneNumber !== undefined
      ? extraSessionData.pairingPhoneNumber
      : channel.sessionData?.pairingPhoneNumber || null;
    sessionData.pairingInstructions = extraSessionData.pairingInstructions !== undefined
      ? extraSessionData.pairingInstructions
      : channel.sessionData?.pairingInstructions || null;
  }

  sessionData.adapterError = extraSessionData.adapterError !== undefined
    ? extraSessionData.adapterError
    : channel.sessionData?.adapterError || null;
  sessionData.rawRuntimePayload = extraSessionData.rawRuntimePayload !== undefined
    ? sanitizeQrPayload(extraSessionData.rawRuntimePayload)
    : channel.sessionData?.rawRuntimePayload || null;

  return prisma.channel.update({
    where: { id: channel.id },
    data: {
      status: classification.channelStatus || 'DISCONNECTED',
      sessionData,
    },
  });
}

async function prepareForceNewQrChannel(channel, reason, options = {}) {
  const reconnectStartedAt = channel.sessionData?.reconnectStartedAt || new Date().toISOString();
  const debugState = buildWhatsAppDebugState(channel, {
    reconnectStartedAt,
    reconnectElapsedMs: elapsedMsSince(reconnectStartedAt),
    restoreAttemptCount: Math.max(1, Number(channel.sessionData?.restoreAttemptCount || 0)),
    lastRestoreError: reason,
    forceQrTriggered: true,
    qrGenerationStartedAt: new Date().toISOString(),
  });

  return prisma.channel.update({
    where: { id: channel.id },
    data: {
      status: 'CONNECTING',
      sessionData: buildMergedSessionData(channel, {
        ...debugState,
        connected: false,
        linkState: 'FORCE_NEW_QR',
        statusMessage: options.message || FORCE_NEW_QR_MESSAGE,
        lastLinkMessage: options.message || FORCE_NEW_QR_MESSAGE,
        lastError: null,
        lastErrorCode: null,
        qrIssuedAt: null,
        qrDataUrl: null,
        qrExpiresAt: null,
        pairingCode: null,
        pairingPhoneNumber: null,
        pairingInstructions: null,
        adapterError: null,
        rawRuntimePayload: sanitizeQrPayload(
          options.rawRuntimePayload !== undefined
            ? options.rawRuntimePayload
            : { message: reason },
        ),
      }),
    },
  });
}

async function persistWhatsAppChannelState(channel, runtime, extraSessionData = {}) {
  const snapshot = await waitForWhatsAppAccountSnapshot(runtime, channel.id);
  const isConnected = snapshot?.connected === true;
  const debugState = buildWhatsAppDebugState(channel, extraSessionData);
  const nextStatus = isConnected ? 'CONNECTED' : extraSessionData.status || 'CONNECTING';
  const nextLinkState = isConnected
    ? 'CONNECTED'
    : extraSessionData.linkState || missingQrState({
        ...snapshot,
        forceQrTriggered: debugState.forceQrTriggered,
      }, channel.sessionData?.linkState || 'RECONNECTING');
  const nextStatusMessage = isConnected
    ? 'WhatsApp berhasil terhubung dan siap dipakai.'
    : extraSessionData.statusMessage
      || extraSessionData.lastLinkMessage
      || (nextLinkState === 'FORCE_NEW_QR' ? FORCE_NEW_QR_MESSAGE : null)
      || extraSessionData.lastError
      || channel.sessionData?.statusMessage
      || null;
  const nextSessionData = buildMergedSessionData(channel, {
    ...debugState,
    ...extraSessionData,
    linked: snapshot?.linked ?? channel.sessionData?.linked ?? false,
    connected: isConnected,
    linkedName: snapshot?.linkedName || channel.sessionData?.linkedName || null,
    linkedPhone: snapshot?.linkedPhone || channel.sessionData?.linkedPhone || null,
    lastConnectedAt: snapshot?.lastConnectedAt || channel.sessionData?.lastConnectedAt || null,
    linkState: nextLinkState,
    statusMessage: nextStatusMessage,
    lastError: isConnected
      ? null
      : (extraSessionData.lastError !== undefined
        ? extraSessionData.lastError
        : nextLinkState === 'FORCE_NEW_QR'
        ? null
        : channel.sessionData?.lastError || null),
    lastErrorCode: isConnected
      ? null
      : (extraSessionData.lastErrorCode !== undefined
        ? extraSessionData.lastErrorCode
        : nextLinkState === 'FORCE_NEW_QR'
        ? null
        : channel.sessionData?.lastErrorCode || null),
    qrIssuedAt: isConnected ? null : (extraSessionData.qrIssuedAt !== undefined ? extraSessionData.qrIssuedAt : channel.sessionData?.qrIssuedAt || null),
    qrDataUrl: isConnected
      ? null
      : (extraSessionData.qrDataUrl !== undefined
        ? extraSessionData.qrDataUrl
        : snapshot?.qrDataUrl || channel.sessionData?.qrDataUrl || null),
    qrExpiresAt: isConnected
      ? null
      : (extraSessionData.qrExpiresAt !== undefined
        ? extraSessionData.qrExpiresAt
        : snapshot?.qrExpiresAt || channel.sessionData?.qrExpiresAt || null),
    pairingCode: isConnected
      ? null
      : (extraSessionData.pairingCode !== undefined
        ? extraSessionData.pairingCode
        : snapshot?.pairingCode || channel.sessionData?.pairingCode || null),
    pairingPhoneNumber: isConnected
      ? null
      : (extraSessionData.pairingPhoneNumber !== undefined
        ? extraSessionData.pairingPhoneNumber
        : snapshot?.pairingPhoneNumber || channel.sessionData?.pairingPhoneNumber || null),
    pairingInstructions: isConnected
      ? null
      : (extraSessionData.pairingInstructions !== undefined
        ? extraSessionData.pairingInstructions
        : snapshot?.pairingInstructions || channel.sessionData?.pairingInstructions || null),
    adapterError: isConnected
      ? null
      : (extraSessionData.adapterError !== undefined
        ? extraSessionData.adapterError
        : snapshot?.adapterError || channel.sessionData?.adapterError || null),
    qrScannedAt: isConnected
      ? null
      : (extraSessionData.qrScannedAt !== undefined
        ? extraSessionData.qrScannedAt
        : snapshot?.qrScannedAt || channel.sessionData?.qrScannedAt || null),
    browserConnectedAt: isConnected
      ? null
      : (extraSessionData.browserConnectedAt !== undefined
        ? extraSessionData.browserConnectedAt
        : snapshot?.browserConnectedAt || channel.sessionData?.browserConnectedAt || null),
    socketConnectedAt: isConnected
      ? null
      : (extraSessionData.socketConnectedAt !== undefined
        ? extraSessionData.socketConnectedAt
        : snapshot?.socketConnectedAt || channel.sessionData?.socketConnectedAt || null),
    authStateLoadedAt: isConnected
      ? null
      : (extraSessionData.authStateLoadedAt !== undefined
        ? extraSessionData.authStateLoadedAt
        : snapshot?.authStateLoadedAt || channel.sessionData?.authStateLoadedAt || null),
    sessionPersistedAt: isConnected
      ? null
      : (extraSessionData.sessionPersistedAt !== undefined
        ? extraSessionData.sessionPersistedAt
        : snapshot?.sessionPersistedAt || channel.sessionData?.sessionPersistedAt || null),
    lastDisconnectReason: isConnected
      ? null
      : (extraSessionData.lastDisconnectReason !== undefined
        ? extraSessionData.lastDisconnectReason
        : snapshot?.lastDisconnectReason || channel.sessionData?.lastDisconnectReason || null),
    loginFailureReason: isConnected
      ? null
      : (extraSessionData.loginFailureReason !== undefined
        ? extraSessionData.loginFailureReason
        : snapshot?.loginFailureReason || channel.sessionData?.loginFailureReason || null),
    browserClosedUnexpectedly: isConnected
      ? false
      : (extraSessionData.browserClosedUnexpectedly !== undefined
        ? extraSessionData.browserClosedUnexpectedly === true
        : snapshot?.browserClosedUnexpectedly === true || channel.sessionData?.browserClosedUnexpectedly === true),
    whatsappSocketState: isConnected
      ? null
      : (extraSessionData.whatsappSocketState !== undefined
        ? extraSessionData.whatsappSocketState
        : snapshot?.whatsappSocketState || channel.sessionData?.whatsappSocketState || null),
    puppeteerBrowserState: isConnected
      ? null
      : (extraSessionData.puppeteerBrowserState !== undefined
        ? extraSessionData.puppeteerBrowserState
        : snapshot?.puppeteerBrowserState || channel.sessionData?.puppeteerBrowserState || null),
    lastSocketError: isConnected
      ? null
      : (extraSessionData.lastSocketError !== undefined
        ? extraSessionData.lastSocketError
        : snapshot?.lastSocketError || channel.sessionData?.lastSocketError || null),
    lastConnectionUpdate: isConnected
      ? null
      : (extraSessionData.lastConnectionUpdate !== undefined
        ? extraSessionData.lastConnectionUpdate
        : snapshot?.lastConnectionUpdate || channel.sessionData?.lastConnectionUpdate || null),
    rawRuntimePayload: isConnected
      ? null
      : (extraSessionData.rawRuntimePayload !== undefined
        ? sanitizeQrPayload(extraSessionData.rawRuntimePayload)
        : sanitizeQrPayload(snapshot?.rawRuntimePayload || snapshot || channel.sessionData?.rawRuntimePayload || null)),
    reconnectStartedAt: debugState.reconnectStartedAt,
    reconnectElapsedMs: debugState.reconnectElapsedMs,
    restoreAttemptCount: debugState.restoreAttemptCount,
    lastRestoreError: isConnected ? null : debugState.lastRestoreError,
    forceQrTriggered: isConnected ? false : debugState.forceQrTriggered,
    qrGenerationStartedAt: isConnected ? null : debugState.qrGenerationStartedAt,
  });
  const updated = await prisma.channel.update({
    where: { id: channel.id },
    data: {
      status: nextStatus,
      sessionData: nextSessionData,
    },
  });

  return { updated, snapshot };
}

async function ensureWhatsAppLinkedState(channel, agent, runtime, force = false, logger = console, options = {}) {
  await ensureRuntimeWhatsAppPluginInstalled(runtime);

  let workingChannel = channel;
  const reconnectStartedAt = workingChannel.sessionData?.reconnectStartedAt || new Date().toISOString();
  const buildLinkStartOptions = (forceLogin) => {
    const nextOptions = {
      agentId: agent.id,
      force: forceLogin,
      forceFreshLogin: options.forceFreshLogin === true,
      authNamespace: workingChannel.sessionData?.authNamespace || buildWhatsAppSessionIdentity(workingChannel).authNamespace,
      runtimeSessionId: workingChannel.sessionData?.runtimeSessionId || buildWhatsAppSessionIdentity(workingChannel).runtimeSessionId,
      adapterSessionId: workingChannel.sessionData?.adapterSessionId || buildWhatsAppSessionIdentity(workingChannel).adapterSessionId,
      previousAuthNamespace: options.previousAuthNamespace || null,
      previousRuntimeSessionId: options.previousRuntimeSessionId || null,
      previousAdapterSessionId: options.previousAdapterSessionId || null,
      previousAuthDir: resolveWhatsAppAuthDir(options.previousAuthNamespace),
      timeoutMs: forceLogin ? FORCE_START_TIMEOUT_MS : RESTORE_SESSION_TIMEOUT_MS,
    };

    if (options.forceFreshLogin === true) {
      if (!nextOptions.authNamespace || !nextOptions.runtimeSessionId || !nextOptions.adapterSessionId) {
        const error = new Error('Fresh login membutuhkan authNamespace, runtimeSessionId, dan adapterSessionId baru.');
        error.statusCode = 409;
        throw error;
      }

      if (
        nextOptions.authNamespace === nextOptions.previousAuthNamespace
        || nextOptions.runtimeSessionId === nextOptions.previousRuntimeSessionId
        || nextOptions.adapterSessionId === nextOptions.previousAdapterSessionId
      ) {
        const error = new Error('Fresh login masih memakai state runtime lama.');
        error.statusCode = 409;
        throw error;
      }
    }

    return nextOptions;
  };

  if (!workingChannel.sessionData?.reconnectStartedAt) {
    workingChannel = await prisma.channel.update({
      where: { id: channel.id },
      data: {
        status: 'CONNECTING',
        sessionData: buildMergedSessionData(channel, {
          ...buildWhatsAppDebugState(channel, {
            reconnectStartedAt,
            reconnectElapsedMs: 0,
            restoreAttemptCount: Math.max(1, Number(channel.sessionData?.restoreAttemptCount || 0)),
            lastRestoreError: null,
            forceQrTriggered: false,
            qrGenerationStartedAt: null,
          }),
          connected: false,
          linkState: 'RECONNECTING',
          statusMessage: channel.sessionData?.statusMessage || RESTORE_SESSION_MESSAGE,
          lastLinkMessage: channel.sessionData?.lastLinkMessage || RESTORE_SESSION_MESSAGE,
        }),
      },
    });
  }

  if (options.forceFreshLogin === true) {
    console.log('[Fresh Login] Step 6: Create runtime session', {
      agentId: agent.id,
      channelId: channel.id,
      authNamespace: workingChannel.sessionData?.authNamespace || null,
      runtimeSessionId: workingChannel.sessionData?.runtimeSessionId || null,
      adapterSessionId: workingChannel.sessionData?.adapterSessionId || null,
    });
  }

  await ocStartChannel(
    channel.id,
    CHANNEL_TYPES.WHATSAPP,
    {},
    channel.agentId,
    buildWhatsAppGatewayAgentConfig(workingChannel, agent),
    runtime,
  );

  const initialSnapshot = await waitForWhatsAppAccountSnapshot(runtime, channel.id, 2, 800).catch(() => null);
  if (initialSnapshot?.connected) {
    logWhatsAppDebug(logger, 'pre-start-snapshot-connected', channel.id, initialSnapshot, { force });
    const { updated } = await persistWhatsAppChannelState(workingChannel, runtime, {
      reconnectStartedAt,
      reconnectElapsedMs: elapsedMsSince(reconnectStartedAt),
      statusMessage: 'WhatsApp berhasil terhubung dan siap dipakai.',
      lastLinkMessage: 'WhatsApp berhasil terhubung dan siap dipakai.',
      linkState: 'CONNECTED',
      lastError: null,
      lastErrorCode: null,
      lastRestoreError: null,
      forceQrTriggered: false,
      qrGenerationStartedAt: null,
      adapterError: null,
      rawRuntimePayload: sanitizeQrPayload(initialSnapshot),
    });

    return {
      channel: updated,
      snapshot: initialSnapshot,
      loginResult: {
        ...initialSnapshot,
        connected: true,
        message: 'WhatsApp berhasil terhubung dan siap dipakai.',
      },
    };
  }

  if (!force && hasUsableWhatsAppArtifact(initialSnapshot)) {
    logWhatsAppDebug(logger, 'pre-start-snapshot-qr-ready', channel.id, initialSnapshot, { force });
    const qrReadyMessage = initialSnapshot?.message || 'Scan QR WhatsApp untuk menyelesaikan koneksi.';
    const { updated, snapshot } = await persistWhatsAppChannelState(workingChannel, runtime, {
      reconnectStartedAt,
      reconnectElapsedMs: elapsedMsSince(reconnectStartedAt),
      lastLinkMessage: qrReadyMessage,
      statusMessage: qrReadyMessage,
      linkState: 'WAITING_QR',
      lastError: null,
      lastErrorCode: null,
      qrDataUrl: initialSnapshot?.qrDataUrl || null,
      qrIssuedAt: initialSnapshot?.qrDataUrl ? new Date().toISOString() : workingChannel.sessionData?.qrIssuedAt || null,
      qrExpiresAt: initialSnapshot?.qrExpiresAt || workingChannel.sessionData?.qrExpiresAt || null,
      pairingCode: initialSnapshot?.pairingCode || null,
      pairingPhoneNumber: initialSnapshot?.pairingPhoneNumber || null,
      pairingInstructions: initialSnapshot?.pairingInstructions || null,
      adapterError: initialSnapshot?.adapterError || null,
      rawRuntimePayload: sanitizeQrPayload(initialSnapshot?.rawRuntimePayload || initialSnapshot),
    });

    return {
      channel: updated,
      snapshot,
      loginResult: {
        ...initialSnapshot,
        message: qrReadyMessage,
      },
    };
  }

  let loginResult = null;
  let usedForceFallback = force;
  let forceReason = options.forceReason || null;
  const forceMessage = options.forceMessage || FORCE_NEW_QR_MESSAGE;
  let preparedForceFallback = false;

  if (!force) {
    const restoreAttempts = Math.max(4, Math.ceil(RESTORE_SESSION_TIMEOUT_MS / 2000));
    const restoreSnapshot = await waitForWhatsAppAccountSnapshot(runtime, channel.id, restoreAttempts, 2000).catch(() => null);

    if (restoreSnapshot?.connected) {
      const { updated } = await persistWhatsAppChannelState(workingChannel, runtime, {
        reconnectStartedAt,
        reconnectElapsedMs: elapsedMsSince(reconnectStartedAt),
        statusMessage: 'WhatsApp berhasil diaktifkan kembali.',
        lastLinkMessage: 'WhatsApp berhasil diaktifkan kembali.',
        linkState: 'CONNECTED',
        lastError: null,
        lastErrorCode: null,
        lastRestoreError: null,
        forceQrTriggered: false,
        qrGenerationStartedAt: null,
        rawRuntimePayload: sanitizeQrPayload(restoreSnapshot?.rawRuntimePayload || restoreSnapshot),
      });

      return {
        channel: updated,
        snapshot: restoreSnapshot,
        loginResult: {
          ...restoreSnapshot,
          connected: true,
          message: 'WhatsApp berhasil diaktifkan kembali.',
        },
      };
    }

    if (hasUsableWhatsAppArtifact(restoreSnapshot)) {
      const qrReadyMessage = restoreSnapshot?.message || 'Scan QR WhatsApp untuk menyelesaikan koneksi.';
      const { updated, snapshot } = await persistWhatsAppChannelState(workingChannel, runtime, {
        reconnectStartedAt,
        reconnectElapsedMs: elapsedMsSince(reconnectStartedAt),
        lastLinkMessage: qrReadyMessage,
        statusMessage: qrReadyMessage,
        linkState: 'WAITING_QR',
        lastError: null,
        lastErrorCode: null,
        qrDataUrl: restoreSnapshot?.qrDataUrl || null,
        qrIssuedAt: restoreSnapshot?.qrDataUrl ? new Date().toISOString() : workingChannel.sessionData?.qrIssuedAt || null,
        qrExpiresAt: restoreSnapshot?.qrExpiresAt || workingChannel.sessionData?.qrExpiresAt || null,
        pairingCode: restoreSnapshot?.pairingCode || null,
        pairingPhoneNumber: restoreSnapshot?.pairingPhoneNumber || null,
        pairingInstructions: restoreSnapshot?.pairingInstructions || null,
        adapterError: restoreSnapshot?.adapterError || null,
        rawRuntimePayload: sanitizeQrPayload(restoreSnapshot?.rawRuntimePayload || restoreSnapshot),
      });

      return {
        channel: updated,
        snapshot,
        loginResult: {
          ...restoreSnapshot,
          message: qrReadyMessage,
        },
      };
    }

    forceReason = forceReason || restoreSnapshot?.lastError || restoreSnapshot?.message || 'Restore session terlalu lama tanpa progress.';
    logger.warn({
      channelId: channel.id,
      reconnectElapsedMs: elapsedMsSince(reconnectStartedAt),
      forceReason,
    }, 'WhatsApp restore stalled; forcing a new QR');
    workingChannel = await prepareForceNewQrChannel(workingChannel, forceReason, {
      message: forceMessage,
      rawRuntimePayload: restoreSnapshot?.rawRuntimePayload || restoreSnapshot || null,
    });
    force = true;
    usedForceFallback = true;
    preparedForceFallback = true;
  }

  if (force && !preparedForceFallback) {
    forceReason = forceReason || workingChannel.sessionData?.lastRestoreError || 'QR WhatsApp baru dipaksa.';
    workingChannel = await prepareForceNewQrChannel(workingChannel, forceReason, {
      message: forceMessage,
      rawRuntimePayload: options.seedSnapshot?.rawRuntimePayload || options.seedSnapshot || workingChannel.sessionData?.rawRuntimePayload || null,
    });
  }

  try {
    loginResult = await ocStartWhatsAppLink(channel.id, buildLinkStartOptions(force), runtime);
    logWhatsAppDebug(logger, 'adapter-start-response', channel.id, loginResult, { force, usedForceFallback });
  } catch (error) {
    const classified = classifyWhatsAppTransportFailure(error);

    logger.warn({
      channelId: channel.id,
      force,
      code: classified.code,
      statusCode: classified.statusCode,
      message: classified.userMessage,
    }, 'WhatsApp link start failed');

    if (!force && classified.shouldRetryWithForce) {
      usedForceFallback = true;
      forceReason = classified.userMessage;
      workingChannel = await prepareForceNewQrChannel(workingChannel, forceReason, {
        message: forceMessage,
        rawRuntimePayload: sanitizeQrPayload(classified.payload?.rawRuntimePayload || classified.payload || { message: error?.message || String(error) }),
      });
      loginResult = await ocStartWhatsAppLink(channel.id, buildLinkStartOptions(true), runtime);
      logWhatsAppDebug(logger, 'adapter-start-force-response', channel.id, loginResult, { force: true, reason: classified.code });
    } else {
      const updatedChannel = await persistWhatsAppFailureState(workingChannel, classified, {
        reconnectStartedAt: workingChannel.sessionData?.reconnectStartedAt || reconnectStartedAt,
        reconnectElapsedMs: elapsedMsSince(workingChannel.sessionData?.reconnectStartedAt || reconnectStartedAt),
        restoreAttemptCount: Math.max(1, Number(workingChannel.sessionData?.restoreAttemptCount || 0)),
        lastRestoreError: forceReason || classified.userMessage,
        forceQrTriggered: force || workingChannel.sessionData?.forceQrTriggered === true,
        qrGenerationStartedAt: workingChannel.sessionData?.qrGenerationStartedAt || null,
        lastLinkMessage: classified.userMessage,
        adapterError: classified.payload?.adapterError || error?.message || null,
        rawRuntimePayload: sanitizeQrPayload(classified.payload?.rawRuntimePayload || classified.payload || { message: error?.message || String(error) }),
      });
      const enrichedError = new Error(classified.userMessage);
      enrichedError.statusCode = classified.statusCode;
      enrichedError.payload = {
        error: classified.payload?.error || 'Bad Gateway',
        message: classified.userMessage,
        code: classified.code,
        adapterError: classified.payload?.adapterError || error?.message || null,
        rawRuntimePayload: sanitizeQrPayload(classified.payload?.rawRuntimePayload || classified.payload || { message: error?.message || String(error) }),
        channel: buildChannelPayload(updatedChannel, { agentStatus: agent.status, includeQr: true }),
      };
      throw enrichedError;
    }
  }

  if (!hasUsableWhatsAppArtifact(loginResult)) {
    const statusProbe = await waitForWhatsAppAccountSnapshot(runtime, channel.id, 3, 1500).catch(() => null);
    logWhatsAppDebug(logger, 'adapter-status-probe-after-start', channel.id, statusProbe || {}, { force, usedForceFallback });

    if (hasUsableWhatsAppArtifact(statusProbe)) {
      loginResult = {
        ...loginResult,
        ...statusProbe,
        message: loginResult?.message || statusProbe?.message || null,
      };
    } else if (!usedForceFallback) {
      usedForceFallback = true;
      forceReason = forceReason || 'Restore session terlalu lama tanpa progress.';
      workingChannel = await prepareForceNewQrChannel(workingChannel, forceReason, {
        message: forceMessage,
        rawRuntimePayload: sanitizeQrPayload(statusProbe?.rawRuntimePayload || statusProbe || loginResult || null),
      });

      const forcedResult = await ocStartWhatsAppLink(channel.id, buildLinkStartOptions(true), runtime);
      logWhatsAppDebug(logger, 'adapter-force-after-missing-qr', channel.id, forcedResult, { reason: 'missing_qr_after_restore' });

      const forcedStatusProbe = await waitForWhatsAppAccountSnapshot(runtime, channel.id, 3, 1500).catch(() => null);
      logWhatsAppDebug(logger, 'adapter-status-probe-after-force', channel.id, forcedStatusProbe || {}, { force: true });

      loginResult = {
        ...forcedResult,
        ...(forcedStatusProbe || {}),
        message: forcedResult?.message || forcedStatusProbe?.message || null,
      };
    }
  }

  const missingQrMessage = 'Runtime connected but QR data not returned.';
  const hasLoginArtifact = hasUsableWhatsAppArtifact(loginResult);
  const normalizedLinkState = loginResult?.connected
    ? 'CONNECTED'
    : hasLoginArtifact
      ? missingQrState(loginResult, workingChannel.sessionData?.linkState || 'RECONNECTING')
      : ((workingChannel.sessionData?.forceQrTriggered === true || usedForceFallback)
          ? 'FORCE_NEW_QR'
          : missingQrState(loginResult, workingChannel.sessionData?.linkState || 'RECONNECTING'));
  const nextMessage = loginResult?.message
    || (normalizedLinkState === 'FORCE_NEW_QR'
      ? forceMessage
      : hasLoginArtifact
        ? 'Scan QR WhatsApp untuk menyelesaikan koneksi.'
        : missingQrMessage);

  const { updated, snapshot } = await persistWhatsAppChannelState(workingChannel, runtime, {
    reconnectStartedAt: workingChannel.sessionData?.reconnectStartedAt || reconnectStartedAt,
    reconnectElapsedMs: elapsedMsSince(workingChannel.sessionData?.reconnectStartedAt || reconnectStartedAt),
    restoreAttemptCount: Math.max(1, Number(workingChannel.sessionData?.restoreAttemptCount || 0)),
    lastRestoreError: usedForceFallback ? (forceReason || workingChannel.sessionData?.lastRestoreError || null) : workingChannel.sessionData?.lastRestoreError || null,
    forceQrTriggered: usedForceFallback || workingChannel.sessionData?.forceQrTriggered === true,
    qrGenerationStartedAt: workingChannel.sessionData?.qrGenerationStartedAt || null,
    lastLinkMessage: nextMessage,
    statusMessage: nextMessage,
    linkState: normalizedLinkState,
    lastError: normalizedLinkState === 'FORCE_NEW_QR' || hasLoginArtifact ? null : missingQrMessage,
    lastErrorCode: normalizedLinkState === 'FORCE_NEW_QR' || hasLoginArtifact ? null : 'QR_DATA_MISSING',
    qrDataUrl: loginResult?.qrDataUrl || null,
    qrIssuedAt: loginResult?.qrDataUrl ? new Date().toISOString() : workingChannel.sessionData?.qrIssuedAt || null,
    qrExpiresAt: loginResult?.qrExpiresAt || workingChannel.sessionData?.qrExpiresAt || null,
    pairingCode: loginResult?.pairingCode || null,
    pairingPhoneNumber: loginResult?.pairingPhoneNumber || null,
    pairingInstructions: loginResult?.pairingInstructions || null,
    adapterError: loginResult?.adapterError || null,
    qrScannedAt: loginResult?.qrScannedAt || null,
    browserConnectedAt: loginResult?.browserConnectedAt || null,
    socketConnectedAt: loginResult?.socketConnectedAt || null,
    authStateLoadedAt: loginResult?.authStateLoadedAt || null,
    sessionPersistedAt: loginResult?.sessionPersistedAt || null,
    lastDisconnectReason: loginResult?.lastDisconnectReason || null,
    loginFailureReason: loginResult?.loginFailureReason || null,
    browserClosedUnexpectedly: loginResult?.browserClosedUnexpectedly === true,
    whatsappSocketState: loginResult?.whatsappSocketState || null,
    puppeteerBrowserState: loginResult?.puppeteerBrowserState || null,
    lastSocketError: loginResult?.lastSocketError || null,
    lastConnectionUpdate: loginResult?.lastConnectionUpdate || null,
    rawRuntimePayload: sanitizeQrPayload(loginResult?.rawRuntimePayload || loginResult),
  });

  logWhatsAppDebug(logger, 'persisted-link-state', channel.id, {
    ...loginResult,
    channel: buildChannelPayload(updated, { agentStatus: agent.status, includeQr: true }),
  }, {
    force,
    usedForceFallback,
    snapshot: sanitizeQrPayload(snapshot),
  });

  return { channel: updated, snapshot, loginResult };
}

export default async function channelRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  async function disconnectChannel(channel, logger = fastify.log) {
    const targets = listCandidateAdapterUrls(channel.workspace).map((adapterUrl) => ({ adapterUrl }));

    for (const target of targets) {
      await ocStopChannel(channel.id, channel.type, target)
        .catch((err) => logger.warn({ err: err.message, channelId: channel.id }, 'ocStopChannel warning'));
    }

    return prisma.channel.update({
      where: { id: channel.id },
      data: {
        status: 'DISCONNECTED',
        sessionData: buildMergedSessionData(channel, {
          connected: false,
          linkState: 'DISCONNECTED',
          statusMessage: 'Channel sedang tidak aktif.',
        }),
      },
    });
  }

  async function assertOwnsAgent(ownerId, agentId, reply) {
    const agent = await prisma.agent.findFirst({
      where: { id: agentId, workspace: { ownerId } },
      include: { workspace: { select: { id: true, name: true, ownerId: true, subTier: true } } },
    });
    if (!agent) {
      reply.code(404).send({ error: 'Not Found', message: 'Agent tidak ditemukan' });
      return null;
    }
    return agent;
  }

  // GET /api/channels?agentId=xxx
  fastify.get('/', async (request, reply) => {
    const { ownerId } = request.user;
    const { agentId } = request.query;
    if (!agentId) return reply.code(400).send({ error: 'agentId diperlukan' });

    const agent = await assertOwnsAgent(ownerId, agentId, reply);
    if (!agent) return;

    const channels = await prisma.channel.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      channels: channels.map((ch) => buildChannelPayload(ch, { agentStatus: agent.status })),
    });
  });

  // POST /api/channels - connect Telegram or WhatsApp channel
  fastify.post('/', async (request, reply) => {
    const { ownerId } = request.user;

    const parsed = connectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { agentId, type, botToken } = parsed.data;
    const normalizedType = normalizeChannelType(type);

    const agent = await assertOwnsAgent(ownerId, agentId, reply);
    if (!agent) return;

    if (agent.status !== 'ACTIVE') {
      return reply.code(409).send({ error: 'Conflict', message: 'Aktifkan agent terlebih dahulu sebelum connect channel' });
    }

    const activeChannel = await prisma.channel.findFirst({
      where: {
        agentId,
        status: { not: 'DISCONNECTED' },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (activeChannel) {
      return reply.code(409).send({
        error: 'Conflict',
        message: `Agent sudah punya channel ${getChannelLabel(activeChannel.type)} aktif. Disconnect dulu.`,
      });
    }

    const existing = await prisma.channel.findFirst({ where: { agentId, type: normalizedType } });

    let botInfo = null;
    if (channelUsesBotToken(normalizedType)) {
      try {
        botInfo = await validateTelegramBotToken(botToken);
      } catch {
        return reply.code(400).send({ error: 'Bad Request', message: 'Token bot Telegram tidak valid' });
      }

      const tokenInUse = await prisma.channel.findFirst({
        where: {
          type: CHANNEL_TYPES.TELEGRAM,
          status: { not: 'DISCONNECTED' },
          sessionData: { path: ['botUsername'], equals: botInfo.username },
          ...(existing ? { id: { not: existing.id } } : {}),
        },
      });
      if (tokenInUse) {
        return reply.code(409).send({ error: 'Conflict', message: `@${botInfo.username} sudah terhubung ke agent lain` });
      }
    }

    const channelPayload = {
      workspaceId: agent.workspaceId,
      agentId,
      type: normalizedType,
      status: 'CONNECTING',
      sessionData: channelUsesBotToken(normalizedType)
        ? {
          botId: botInfo.id,
          botUsername: botInfo.username,
          botName: botInfo.firstName,
          tokenHash: Buffer.from(botToken).toString('base64'),
        }
        : {
          ...buildWhatsAppSessionIdentity({ agentId }),
          linked: false,
          connected: false,
          linkState: 'CONNECTING',
          loginStrategy: 'RECONNECT',
          statusMessage: 'Menyiapkan sesi WhatsApp khusus agent ini.',
          lastError: null,
          lastErrorCode: null,
          lastLinkMessage: null,
          linkedName: existing?.sessionData?.linkedName || null,
          linkedPhone: existing?.sessionData?.linkedPhone || null,
        },
    };

    const channel = existing
      ? await prisma.channel.update({
        where: { id: existing.id },
        data: channelPayload,
      })
      : await prisma.channel.create({ data: channelPayload });

    fastify.log.info({
      channelId: channel.id,
      workspaceId: channel.workspaceId,
      agentId,
      type: normalizedType,
      reusedExistingChannel: Boolean(existing),
    }, 'Connecting channel');

    try {
      const runtime = await ensureWorkspaceRuntime(agent.workspace);
      const cleanupTargets = listCandidateAdapterUrls(agent.workspace)
        .filter((adapterUrl) => adapterUrl !== runtime.adapterUrl)
        .map((adapterUrl) => ({ adapterUrl }));

      for (const target of cleanupTargets) {
        await ocStopChannel(channel.id, normalizedType, target).catch(() => {});
      }

      if (channelUsesBotToken(normalizedType)) {
        await ocStartBot(channel.id, botToken, agentId, buildGatewayAgentConfig(agent, {
          botUsername: botInfo.username,
          channelType: normalizedType,
        }), runtime);

        const updatedChannel = await prisma.channel.update({
          where: { id: channel.id },
          data: { status: 'CONNECTED' },
        });

        emitChannelUpdate(fastify.io, updatedChannel, agent.status, 'connected');

        return reply.code(201).send({
          message: `@${botInfo.username} berhasil terhubung via openclaw`,
          channel: buildChannelPayload(updatedChannel, {
            type: CHANNEL_TYPES.TELEGRAM,
            status: 'CONNECTED',
            botUsername: botInfo.username,
            botName: botInfo.firstName,
            agentStatus: agent.status,
          }),
        });
      }

      const { channel: updatedChannel, loginResult, snapshot } = await ensureWhatsAppLinkedState(channel, agent, runtime, false, fastify.log);

      emitChannelUpdate(fastify.io, updatedChannel, agent.status, snapshot?.connected ? 'connected' : 'updated');

      return reply.code(201).send({
        message: loginResult?.message || 'Scan QR WhatsApp untuk menyelesaikan koneksi',
        qrDataUrl: loginResult?.qrDataUrl || null,
        channel: buildChannelPayload(updatedChannel, {
          agentStatus: agent.status,
          linked: snapshot?.linked ?? false,
          connected: snapshot?.connected ?? false,
          includeQr: true,
        }),
      });
    } catch (err) {
      const classified = normalizedType === CHANNEL_TYPES.WHATSAPP ? classifyWhatsAppTransportFailure(err) : null;
      const failedChannel = await prisma.channel.update({
        where: { id: channel.id },
        data: normalizedType === CHANNEL_TYPES.WHATSAPP
          ? {
              status: classified?.channelStatus || 'DISCONNECTED',
              sessionData: buildMergedSessionData(channel, {
                connected: false,
                linkState: classified?.linkState || 'FAILED',
                statusMessage: classified?.userMessage || 'Gagal memulai koneksi WhatsApp.',
                lastError: classified?.userMessage || 'Gagal memulai koneksi WhatsApp.',
                lastErrorCode: classified?.code || 'ADAPTER_ERROR',
                adapterError: err?.payload?.adapterError || err?.message || null,
                rawRuntimePayload: sanitizeQrPayload(err?.payload?.rawRuntimePayload || err?.payload || { message: err?.message || String(err) }),
              }),
            }
          : { status: 'DISCONNECTED' },
      }).catch(() => {});

      if (failedChannel) {
        emitChannelUpdate(fastify.io, failedChannel, agent.status, 'updated');
      }

      fastify.log.error({
        err: err.message,
        channelId: channel.id,
        type: normalizedType,
        code: classified?.code,
        adapterPayload: sanitizeQrPayload(err?.payload || null),
      }, 'Failed to register channel to openclaw');

      if (err?.payload) {
        return reply.code(err.statusCode || 502).send(err.payload);
      }

      return reply.code(classified?.statusCode || 500).send({
        error: 'Internal Error',
        message: channelUsesQrLogin(normalizedType)
          ? classified?.userMessage || 'Gagal memulai koneksi WhatsApp. Coba lagi beberapa saat.'
          : 'Gagal menjalankan bot. Cek token dan coba lagi.',
        code: classified?.code,
        channel: failedChannel ? buildChannelPayload(failedChannel, { agentStatus: agent.status, includeQr: true }) : undefined,
      });
    }
  });

  fastify.post('/:id/reconnect', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;
    const parsed = whatsappLinkSchema.safeParse(request.body || {});

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const channel = await prisma.channel.findFirst({
      where: { id, agent: { workspace: { ownerId } } },
      include: {
        agent: {
          include: {
            workspace: { select: { id: true, name: true, ownerId: true, subTier: true } },
          },
        },
      },
    });

    if (!channel) {
      return reply.code(404).send({ error: 'Not Found', message: 'Channel tidak ditemukan' });
    }

    if (channel.status === 'CONNECTED') {
      return reply.send({
        message: channel.agent.status === 'ACTIVE'
          ? 'Channel sudah aktif'
          : 'Channel sudah terhubung, aktifkan agent untuk menerima chat',
      });
    }

    if (channel.agent.status !== 'ACTIVE') {
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Aktifkan agent terlebih dahulu sebelum mengaktifkan kembali channel',
      });
    }

    if (parsed.data.agentId && parsed.data.agentId !== channel.agentId) {
      return reply.code(409).send({ error: 'Conflict', message: 'Channel tidak cocok dengan agent yang dipilih' });
    }

    const forceFreshLogin = channel.type === CHANNEL_TYPES.WHATSAPP
      && (parsed.data.forceFreshLogin === true || parsed.data.force === true);
    const reconnectMessage = forceFreshLogin ? MANUAL_FRESH_LOGIN_MESSAGE : RESTORE_SESSION_MESSAGE;
    let freshLoginState = null;

    const reconnectingChannel = channel.type === CHANNEL_TYPES.WHATSAPP
      ? forceFreshLogin
        ? ((freshLoginState = await prepareFreshWhatsAppLoginChannel(channel, fastify.log)), freshLoginState.updated)
        : await prisma.channel.update({
            where: { id: channel.id },
            data: {
              status: 'CONNECTING',
              sessionData: buildMergedSessionData(channel, {
                connected: false,
                linkState: 'RECONNECTING',
                loginStrategy: 'RECONNECT',
                statusMessage: reconnectMessage,
                lastLinkMessage: reconnectMessage,
                lastError: null,
                lastErrorCode: null,
                qrIssuedAt: null,
                qrDataUrl: null,
                qrExpiresAt: null,
                pairingCode: null,
                pairingPhoneNumber: null,
                pairingInstructions: null,
                adapterError: null,
                rawRuntimePayload: null,
                reconnectStartedAt: new Date().toISOString(),
                reconnectElapsedMs: 0,
                restoreAttemptCount: Math.max(1, Number(channel.sessionData?.restoreAttemptCount || 0) + 1),
                lastRestoreError: null,
                forceQrTriggered: false,
                qrGenerationStartedAt: null,
              }),
            },
          })
      : channel;

    if (channel.type === CHANNEL_TYPES.WHATSAPP) {
      emitChannelUpdate(fastify.io, reconnectingChannel, channel.agent.status, 'updated');
    }

    try {
      fastify.log.info({ channelId: channel.id, type: channel.type, workspaceId: channel.workspaceId }, 'Reconnecting channel');
      const runtime = await ensureWorkspaceRuntime(channel.agent.workspace);
      const cleanupTargets = listCandidateAdapterUrls(channel.agent.workspace)
        .filter((adapterUrl) => adapterUrl !== runtime.adapterUrl)
        .map((adapterUrl) => ({ adapterUrl }));

      if (forceFreshLogin) {
        await ocStopChannel(channel.id, channel.type, runtime).catch(() => {});
        fastify.log.info({
          channelId: channel.id,
          agentId: channel.agentId,
          previousRuntimeSessionId: freshLoginState?.previousState?.previousRuntimeSessionId || null,
          previousAdapterSessionId: freshLoginState?.previousState?.previousAdapterSessionId || null,
        }, 'Old runtime removed');
      }

      for (const target of cleanupTargets) {
        await ocStopChannel(channel.id, channel.type, target).catch(() => {});
      }

      if (channelUsesBotToken(channel.type)) {
        const tokenHash = channel.sessionData?.tokenHash;
        if (!tokenHash) {
          return reply.code(409).send({
            error: 'Conflict',
            message: 'Token bot tidak tersimpan. Hubungkan ulang channel dengan token baru.',
          });
        }

        const botToken = Buffer.from(tokenHash, 'base64').toString();
        await ocStartBot(
          channel.id,
          botToken,
          channel.agentId,
          buildGatewayAgentConfig(channel.agent, {
            botUsername: channel.sessionData?.botUsername || '',
            channelType: channel.type,
          }),
          runtime,
        );

        const updatedChannel = await prisma.channel.update({
          where: { id: channel.id },
          data: { status: 'CONNECTED' },
        });

        emitChannelUpdate(fastify.io, updatedChannel, channel.agent.status, 'connected');

        return reply.send({
          message: 'Channel berhasil diaktifkan kembali',
          channel: buildChannelPayload(updatedChannel, { agentStatus: channel.agent.status }),
        });
      }
      const { channel: updatedChannel, loginResult, snapshot: linkSnapshot } = await ensureWhatsAppLinkedState(
        reconnectingChannel,
        channel.agent,
        runtime,
        forceFreshLogin,
        fastify.log,
        forceFreshLogin
          ? {
              forceFreshLogin: true,
              forceReason: 'Fresh login diminta manual.',
              forceMessage: MANUAL_FRESH_LOGIN_MESSAGE,
              ...freshLoginState.previousState,
            }
          : {},
      );

      logWhatsAppDebug(fastify.log, 'route-reconnect-response', channel.id, {
        ...loginResult,
        channel: buildChannelPayload(updatedChannel, {
          agentStatus: channel.agent.status,
          linked: linkSnapshot?.linked ?? false,
          connected: linkSnapshot?.connected ?? false,
          includeQr: true,
        }),
      }, { route: 'reconnect' });

      emitChannelUpdate(fastify.io, updatedChannel, channel.agent.status, linkSnapshot?.connected ? 'connected' : 'updated');

      return reply.send({
        message: loginResult?.message || 'Scan QR WhatsApp untuk menyelesaikan koneksi',
        qrDataUrl: loginResult?.qrDataUrl || null,
        channel: buildChannelPayload(updatedChannel, {
          agentStatus: channel.agent.status,
          linked: linkSnapshot?.linked ?? false,
          connected: linkSnapshot?.connected ?? false,
          includeQr: true,
        }),
      });
    } catch (err) {
      const classified = channel.type === CHANNEL_TYPES.WHATSAPP ? classifyWhatsAppTransportFailure(err) : null;
      const failedChannel = channel.type === CHANNEL_TYPES.WHATSAPP
        ? await persistWhatsAppFailureState(reconnectingChannel, classified || classifyWhatsAppTransportFailure(err), {
            lastLinkMessage: classified?.userMessage || 'Gagal mengaktifkan kembali sesi WhatsApp.',
            adapterError: err?.payload?.adapterError || err?.message || null,
            rawRuntimePayload: sanitizeQrPayload(err?.payload?.rawRuntimePayload || err?.payload || { message: err?.message || String(err) }),
          }).catch(() => null)
        : null;

      if (failedChannel) {
        emitChannelUpdate(fastify.io, failedChannel, channel.agent.status, 'updated');
      }

      fastify.log.error({
        err: err.message,
        channelId: channel.id,
        code: classified?.code,
        adapterPayload: sanitizeQrPayload(err?.payload || null),
      }, 'Failed to reconnect channel ke openclaw');

      if (err?.payload) {
        return reply.code(err.statusCode || 502).send(err.payload);
      }

      return reply.code(classified?.statusCode || 500).send({
        error: 'Internal Error',
        message: channelUsesQrLogin(channel.type)
          ? classified?.userMessage || 'Gagal mengaktifkan kembali channel WhatsApp. Coba mulai ulang QR login.'
          : 'Gagal mengaktifkan kembali channel. Coba hubungkan ulang dengan token baru.',
        code: classified?.code,
        channel: failedChannel ? buildChannelPayload(failedChannel, { agentStatus: channel.agent.status, includeQr: true }) : undefined,
      });
    }
  });

  fastify.post('/:id/link/start', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;
    const parsed = whatsappLinkSchema.safeParse(request.body || {});

    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    if (parsed.data.forceFreshLogin === true) {
      console.log('[Fresh Login] Step 1: Find channel');
    }

    const channel = await prisma.channel.findFirst({
      where: { id, agent: { workspace: { ownerId } } },
      include: {
        agent: {
          include: {
            workspace: { select: { id: true, name: true, ownerId: true, subTier: true } },
          },
        },
      },
    });

    if (!channel) {
      return reply.code(404).send({ error: 'Not Found', message: 'Channel tidak ditemukan' });
    }

    if (parsed.data.agentId && parsed.data.agentId !== channel.agentId) {
      return reply.code(409).send({ error: 'Conflict', message: 'Channel tidak cocok dengan agent yang dipilih' });
    }

    if (channel.type !== CHANNEL_TYPES.WHATSAPP) {
      return reply.code(409).send({ error: 'Conflict', message: 'QR login hanya tersedia untuk channel WhatsApp' });
    }

    if (channel.agent.status !== 'ACTIVE') {
      return reply.code(409).send({ error: 'Conflict', message: 'Aktifkan agent terlebih dahulu sebelum memulai login WhatsApp' });
    }

    if (channel.status === 'DISCONNECTED') {
      return reply.code(409).send({ error: 'Conflict', message: 'Channel sedang disconnected. Gunakan reconnect terlebih dahulu.' });
    }

    const forceFreshLogin = parsed.data.forceFreshLogin === true;
    const shouldForceStart = forceFreshLogin || Boolean(parsed.data.force);
    let workingChannel = channel;
    let freshLoginState = null;

    try {
      fastify.log.info({ channelId: channel.id, force: Boolean(parsed.data.force), forceFreshLogin }, 'Starting WhatsApp link flow');
      const runtime = await ensureWorkspaceRuntime(channel.agent.workspace);

      if (forceFreshLogin) {
        console.log('[Fresh Login] Step 2: Remove old runtime');
        await ocStopChannel(channel.id, channel.type, runtime).catch(() => {});
        fastify.log.info({
          channelId: channel.id,
          agentId: channel.agentId,
          previousRuntimeSessionId: workingChannel.sessionData?.runtimeSessionId || null,
          previousAdapterSessionId: workingChannel.sessionData?.adapterSessionId || null,
        }, 'Old runtime removed');

        freshLoginState = await prepareFreshWhatsAppLoginChannel(channel, fastify.log);
        workingChannel = freshLoginState.updated;
        emitChannelUpdate(fastify.io, workingChannel, channel.agent.status, 'updated');
      }

      const { channel: updatedChannel, loginResult, snapshot } = await ensureWhatsAppLinkedState(
        workingChannel,
        channel.agent,
        runtime,
        shouldForceStart,
        fastify.log,
        forceFreshLogin
          ? {
              forceFreshLogin: true,
              forceReason: 'Fresh login diminta manual.',
              forceMessage: MANUAL_FRESH_LOGIN_MESSAGE,
              ...freshLoginState.previousState,
            }
          : {},
      );

      logWhatsAppDebug(fastify.log, 'route-link-start-response', channel.id, {
        ...loginResult,
        channel: buildChannelPayload(updatedChannel, {
          agentStatus: channel.agent.status,
          linked: snapshot?.linked ?? false,
          connected: snapshot?.connected ?? false,
          includeQr: true,
        }),
      }, { route: 'link/start' });

      emitChannelUpdate(fastify.io, updatedChannel, channel.agent.status, snapshot?.connected ? 'connected' : 'updated');

      return reply.send({
        message: loginResult?.message || 'Scan QR WhatsApp untuk menyelesaikan koneksi',
        qrDataUrl: loginResult?.qrDataUrl || null,
        channel: buildChannelPayload(updatedChannel, {
          agentStatus: channel.agent.status,
          linked: snapshot?.linked ?? false,
          connected: snapshot?.connected ?? false,
          includeQr: true,
        }),
      });
    } catch (err) {
      if (forceFreshLogin) {
        console.error('[Fresh Login] Failed', {
          message: err?.message || String(err),
          stack: err?.stack || null,
          agentId: channel.agentId,
          channelId: channel.id,
          runtimeSessionId: workingChannel.sessionData?.runtimeSessionId || null,
          adapterSessionId: workingChannel.sessionData?.adapterSessionId || null,
        });
      }

      const classified = classifyWhatsAppTransportFailure(err);
      const failedChannel = await persistWhatsAppFailureState(workingChannel, classified, {
        lastLinkMessage: classified.userMessage,
        adapterError: err?.payload?.adapterError || err?.message || null,
        rawRuntimePayload: sanitizeQrPayload(err?.payload?.rawRuntimePayload || err?.payload || { message: err?.message || String(err) }),
      }).catch(() => null);

      if (failedChannel) {
        emitChannelUpdate(fastify.io, failedChannel, channel.agent.status, 'updated');
      }

      fastify.log.error({ err: err.message, channelId: channel.id, code: classified.code, adapterPayload: sanitizeQrPayload(err?.payload || null) }, 'Failed to start WhatsApp link');

      if (err?.payload) {
        return reply.code(err.statusCode || 502).send(err.payload);
      }

      return reply.code(classified.statusCode || 500).send({
        error: 'Internal Error',
        message: classified.userMessage || 'Gagal memulai QR login WhatsApp. Coba lagi beberapa saat.',
        code: classified.code,
        channel: failedChannel ? buildChannelPayload(failedChannel, { agentStatus: channel.agent.status, includeQr: true }) : undefined,
      });
    }
  });

  fastify.get('/:id/link/status', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const channel = await prisma.channel.findFirst({
      where: { id, agent: { workspace: { ownerId } } },
      include: {
        agent: {
          include: {
            workspace: { select: { id: true, name: true, ownerId: true, subTier: true } },
          },
        },
      },
    });

    if (!channel) {
      return reply.code(404).send({ error: 'Not Found', message: 'Channel tidak ditemukan' });
    }

    if (channel.type !== CHANNEL_TYPES.WHATSAPP) {
      return reply.code(409).send({ error: 'Conflict', message: 'Status QR hanya tersedia untuk channel WhatsApp' });
    }

    try {
      fastify.log.info({ channelId: channel.id }, 'Waiting for WhatsApp link completion');
      const runtime = await ensureWorkspaceRuntime(channel.agent.workspace);
      const currentSnapshot = await getWhatsAppAccountSnapshot(runtime, channel.id).catch(() => null);

      if (shouldAutoForceNewQr(channel, currentSnapshot)) {
        const forceReason = currentSnapshot?.lastError
          || currentSnapshot?.message
          || channel.sessionData?.lastRestoreError
          || 'Restore session terlalu lama tanpa progress.';

        const { channel: updatedChannel, loginResult, snapshot } = await ensureWhatsAppLinkedState(
          channel,
          channel.agent,
          runtime,
          true,
          fastify.log,
          {
            forceReason,
            forceMessage: FORCE_NEW_QR_MESSAGE,
            seedSnapshot: currentSnapshot,
          },
        );

        emitChannelUpdate(fastify.io, updatedChannel, channel.agent.status, snapshot?.connected ? 'connected' : 'updated');

        return reply.send({
          message: loginResult?.message || FORCE_NEW_QR_MESSAGE,
          connected: Boolean(snapshot?.connected),
          channel: buildChannelPayload(updatedChannel, { agentStatus: channel.agent.status, includeQr: true }),
        });
      }

      const { updated, snapshot } = await persistWhatsAppChannelState(channel, runtime, {
        linkState: channel.sessionData?.linkState || 'WAITING_QR',
        statusMessage: normalizeLinkState(channel.sessionData?.linkState) === 'FORCE_NEW_QR'
          ? FORCE_NEW_QR_MESSAGE
          : channel.sessionData?.statusMessage || 'Status login WhatsApp diperbarui.',
        reconnectElapsedMs: elapsedMsSince(channel.sessionData?.reconnectStartedAt),
      });

      logWhatsAppDebug(fastify.log, 'route-link-status-response', channel.id, {
        channel: buildChannelPayload(updated, { agentStatus: channel.agent.status, includeQr: true }),
        rawRuntimePayload: updated.sessionData?.rawRuntimePayload || null,
      }, { route: 'link/status', snapshot: sanitizeQrPayload(snapshot) });

      emitChannelUpdate(fastify.io, updated, channel.agent.status, snapshot?.connected ? 'connected' : 'updated');

      return reply.send({
        message: snapshot?.connected
          ? 'WhatsApp sudah terhubung.'
          : updated.sessionData?.statusMessage || 'Status login WhatsApp diperbarui.',
        connected: Boolean(snapshot?.connected),
        channel: buildChannelPayload(updated, { agentStatus: channel.agent.status, includeQr: true }),
      });
    } catch (err) {
      const classified = classifyWhatsAppTransportFailure(err);
      const failedChannel = await persistWhatsAppFailureState(channel, classified, {
        lastLinkMessage: classified.userMessage,
        adapterError: err?.payload?.adapterError || err?.message || null,
        rawRuntimePayload: sanitizeQrPayload(err?.payload?.rawRuntimePayload || err?.payload || { message: err?.message || String(err) }),
      }).catch(() => null);

      if (failedChannel) {
        emitChannelUpdate(fastify.io, failedChannel, channel.agent.status, 'updated');
      }

      if (classified.isExpectedState) {
        return reply.send({
          message: classified.userMessage,
          connected: false,
          code: classified.code,
          channel: failedChannel ? buildChannelPayload(failedChannel, { agentStatus: channel.agent.status, includeQr: true }) : undefined,
        });
      }

      fastify.log.error({ err: err.message, channelId: channel.id, code: classified.code, adapterPayload: sanitizeQrPayload(err?.payload || null) }, 'Failed to get WhatsApp link status');
      return reply.code(classified.statusCode || 500).send({
        error: 'Internal Error',
        message: classified.userMessage || 'Gagal memeriksa status login WhatsApp.',
        code: classified.code,
        channel: failedChannel ? buildChannelPayload(failedChannel, { agentStatus: channel.agent.status, includeQr: true }) : undefined,
      });
    }
  });

  fastify.post('/:id/link/wait', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const channel = await prisma.channel.findFirst({
      where: { id, agent: { workspace: { ownerId } } },
      include: {
        agent: {
          include: {
            workspace: { select: { id: true, name: true, ownerId: true, subTier: true } },
          },
        },
      },
    });

    if (!channel) {
      return reply.code(404).send({ error: 'Not Found', message: 'Channel tidak ditemukan' });
    }

    if (channel.type !== CHANNEL_TYPES.WHATSAPP) {
      return reply.code(409).send({ error: 'Conflict', message: 'QR login hanya tersedia untuk channel WhatsApp' });
    }

    try {
      const runtime = await ensureWorkspaceRuntime(channel.agent.workspace);
      await ensureRuntimeWhatsAppPluginInstalled(runtime);
      const waitResult = await ocWaitWhatsAppLink(channel.id, { timeoutMs: 120000 }, runtime);

      const { updated, snapshot } = await persistWhatsAppChannelState(channel, runtime, {
        lastLinkMessage: waitResult?.message || channel.sessionData?.lastLinkMessage || null,
        statusMessage: waitResult?.message || channel.sessionData?.statusMessage || 'Status login WhatsApp diperbarui.',
        linkState: waitResult?.connected ? 'CONNECTED' : (channel.sessionData?.linkState || 'WAITING_QR'),
      });

      logWhatsAppDebug(fastify.log, 'route-link-wait-response', channel.id, {
        ...waitResult,
        channel: buildChannelPayload(updated, {
          agentStatus: channel.agent.status,
          linked: snapshot?.linked ?? false,
          connected: snapshot?.connected ?? false,
          includeQr: true,
        }),
      }, { route: 'link/wait' });

      emitChannelUpdate(fastify.io, updated, channel.agent.status, snapshot?.connected ? 'connected' : 'updated');

      return reply.send({
        message: waitResult?.message || 'Status login WhatsApp diperbarui',
        connected: Boolean(waitResult?.connected),
        channel: buildChannelPayload(updated, {
          agentStatus: channel.agent.status,
          linked: snapshot?.linked ?? false,
          connected: snapshot?.connected ?? false,
          includeQr: true,
        }),
      });
    } catch (err) {
      const classified = classifyWhatsAppTransportFailure(err);
      const failedChannel = await persistWhatsAppFailureState(channel, classified, {
        lastLinkMessage: classified.userMessage,
        adapterError: err?.payload?.adapterError || err?.message || null,
        rawRuntimePayload: sanitizeQrPayload(err?.payload?.rawRuntimePayload || err?.payload || { message: err?.message || String(err) }),
      }).catch(() => null);

      if (failedChannel) {
        emitChannelUpdate(fastify.io, failedChannel, channel.agent.status, 'updated');
      }

      if (classified.isExpectedState) {
        return reply.send({
          message: classified.userMessage,
          connected: false,
          code: classified.code,
          channel: failedChannel ? buildChannelPayload(failedChannel, { agentStatus: channel.agent.status, includeQr: true }) : undefined,
        });
      }

      fastify.log.error({ err: err.message, channelId: channel.id, code: classified.code, adapterPayload: sanitizeQrPayload(err?.payload || null) }, 'Failed waiting for WhatsApp link');
      return reply.code(classified.statusCode || 500).send({
        error: 'Internal Error',
        message: classified.userMessage || 'Gagal memeriksa status QR login WhatsApp.',
        code: classified.code,
        channel: failedChannel ? buildChannelPayload(failedChannel, { agentStatus: channel.agent.status, includeQr: true }) : undefined,
      });
    }
  });

  // DELETE /api/channels/:id
  fastify.delete('/:id', async (request, reply) => {
    const { ownerId } = request.user;
    const { id } = request.params;

    const channel = await prisma.channel.findFirst({
      where: { id, agent: { workspace: { ownerId } } },
      include: { workspace: { select: { id: true, ownerId: true, subTier: true } } },
    });
    if (!channel) {
      return reply.code(404).send({ error: 'Not Found', message: 'Channel tidak ditemukan' });
    }

    if (channel.status === 'DISCONNECTED') {
      return reply.send({
        message: 'Channel sudah dalam keadaan disconnected',
        mode: 'SAFE_DISCONNECT',
        channel: buildChannelPayload(channel, { agentStatus: channel.agent?.status || 'ACTIVE' }),
      });
    }

    const updatedChannel = await disconnectChannel(channel);
    emitChannelUpdate(fastify.io, updatedChannel, channel.agent?.status || 'ACTIVE', 'disconnected');

    return reply.send({
      message: 'Channel berhasil di-disconnect',
      mode: 'SAFE_DISCONNECT',
      channel: buildChannelPayload(updatedChannel, { agentStatus: channel.agent?.status || 'ACTIVE' }),
    });
  });

  // GET /api/channels/status?workspaceId=xxx
  fastify.get('/status', async (request, reply) => {
    try {
      const { ownerId } = request.user;
      const workspaceId = request.query?.workspaceId;
      const workspace = workspaceId
        ? await prisma.workspace.findFirst({ where: { id: workspaceId, ownerId }, select: { id: true, name: true, ownerId: true, subTier: true } })
        : await prisma.workspace.findFirst({ where: { ownerId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, ownerId: true, subTier: true } });

      const runtime = workspace ? await ensureWorkspaceRuntime(workspace) : {};
      const { bots } = await ocListChannels(runtime).catch(() => ({ bots: [] }));
      return reply.send({ activeBots: bots.length, bots, timestamp: new Date().toISOString() });
    } catch {
      return reply.send({ activeBots: 0, bots: [], timestamp: new Date().toISOString() });
    }
  });
}

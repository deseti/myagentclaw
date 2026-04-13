/**
 * gateway-manager.js
 *
 * Adapter antara myagentclaw backend dan OpenClaw gateway resmi.
 *
 * Tugas:
 * 1. Menulis konfigurasi multi-tenant ke ~/.openclaw/openclaw.json
 * 2. Menyalin skills custom ke global skills dir
 * 3. Expose REST API di port 4000 untuk backend manage bots
 *
 * Gateway OpenClaw sendiri dijalankan terpisah oleh service Docker `openclaw`
 * dari repo resmi openclaw/openclaw.
 */

import { readFileSync, writeFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, mkdtempSync, chmodSync, statSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import Fastify from 'fastify';
import unzipper from 'unzipper';

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || join(homedir(), '.openclaw');
const CREDENTIALS_DIR = process.env.OPENCLAW_OAUTH_DIR || join(OPENCLAW_HOME, 'credentials');
const BOOTSTRAP_OPENCLAW_HOME = process.env.OPENCLAW_BOOTSTRAP_HOME || join(homedir(), '.openclaw-bootstrap');
const CONFIG_PATH = join(OPENCLAW_HOME, 'openclaw.json');
const WORKSPACES_DIR = join(OPENCLAW_HOME, 'workspace');
const SHARED_WORKSPACES_DIR = join(OPENCLAW_HOME, 'shared-workspaces');
const SKILLS_DEST = join(OPENCLAW_HOME, 'global-skills');
const BOOTSTRAP_AGENTS_DIR = join(BOOTSTRAP_OPENCLAW_HOME, 'agents');
const BOOTSTRAP_SKILLS_DEST = join(BOOTSTRAP_OPENCLAW_HOME, 'global-skills');
const HOOKS_DEST = join(OPENCLAW_HOME, 'global-hooks');
const PLUGINS_DEST = join(OPENCLAW_HOME, 'extensions');
const SKILLS_SOURCE = join(process.cwd(), 'skills');
const HOOKS_SOURCE = join(process.cwd(), 'hooks');
const PLUGINS_SOURCE = join(process.cwd(), 'plugins');
const ADAPTER_PORT = parseInt(process.env.ADAPTER_PORT || '4000', 10);
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://openclaw:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const RESOLVED_GATEWAY_TOKEN = GATEWAY_TOKEN || process.env.INTERNAL_SECRET_KEY || '';
const CLAWHUB_URL = (process.env.OPENCLAW_CLAWHUB_URL || process.env.CLAWHUB_URL || 'https://clawhub.ai').replace(/\/+$/, '');
const CLAWHUB_DOWNLOAD_URL = (process.env.OPENCLAW_CLAWHUB_DOWNLOAD_URL || process.env.CLAWHUB_DOWNLOAD_URL || 'https://wry-manatee-359.convex.site').replace(/\/+$/, '');
const INSTALL_METADATA_FILE = '.clawhub-install.json';
const SHARED_WORKSPACE_FOLDER = 'shared-workspace';
const SHARED_WORKSPACE_SYNC_MS = Math.max(1000, parseInt(process.env.MYAGENTCLAW_SHARED_WORKSPACE_SYNC_MS || '2000', 10) || 2000);
const sharedWorkspaceControllers = new Map();

const CHANNEL_KEYS = Object.freeze({
  TELEGRAM: 'telegram',
  WHATSAPP: 'whatsapp',
});

function normalizeChannelType(value) {
  const normalized = String(value || 'TELEGRAM').trim().toUpperCase();
  return CHANNEL_KEYS[normalized] ? normalized : 'TELEGRAM';
}

function getChannelKey(channelType) {
  return CHANNEL_KEYS[normalizeChannelType(channelType)] || 'telegram';
}

function getChannelLabel(channelType) {
  return normalizeChannelType(channelType) === 'WHATSAPP' ? 'WhatsApp' : 'Telegram';
}

function safeStoreKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    throw new Error('invalid store key');
  }
  return raw.replace(/[\\/:*?"<>|]/g, '_').replace(/\.\./g, '_');
}

function resolveAllowFromStorePath(channelType, accountId) {
  return join(CREDENTIALS_DIR, `${safeStoreKey(getChannelKey(channelType))}-${safeStoreKey(accountId)}-allowFrom.json`);
}

const WHATSAPP_GATEWAY_ROUTE_CANDIDATES = Object.freeze({
  status: [
    '/api/myagentclaw/whatsapp/link/status',
    '/api/whatsapp/link/status',
    '/channels/whatsapp/link/status',
    '/api/link/status',
  ],
  start: [
    '/api/myagentclaw/whatsapp/link/start',
    '/api/whatsapp/link/start',
    '/channels/whatsapp/link/start',
    '/api/link/start',
  ],
  wait: [
    '/api/myagentclaw/whatsapp/link/wait',
    '/api/whatsapp/link/wait',
    '/channels/whatsapp/link/wait',
    '/api/link/wait',
  ],
});

const WHATSAPP_ADAPTER_ROUTE_ALIASES = Object.freeze({
  status: [
    '/api/myagentclaw/whatsapp/link/status',
    '/api/whatsapp/link/status',
    '/channels/whatsapp/link/status',
    '/api/link/status',
  ],
  start: [
    '/api/myagentclaw/whatsapp/link/start',
    '/api/whatsapp/link/start',
    '/channels/whatsapp/link/start',
    '/api/link/start',
  ],
  wait: [
    '/api/myagentclaw/whatsapp/link/wait',
    '/api/whatsapp/link/wait',
    '/channels/whatsapp/link/wait',
    '/api/link/wait',
  ],
});

function splitSafePathSegments(value) {
  return String(value || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => safeStoreKey(segment));
}

function buildWhatsAppSessionIdentity(agentConfig = {}, channelId = '') {
  const agentSegment = safeStoreKey(agentConfig.agentId || agentConfig.id || channelId || 'unassigned');

  return {
    authDir: join('auth', `agent-${agentSegment}`, 'whatsapp'),
    runtimeSessionId: `runtime-agent-${agentSegment}-whatsapp`,
    adapterSessionId: `adapter-agent-${agentSegment}-whatsapp`,
  };
}

function resolveWhatsAppAuthDir(agentConfig = {}, channelId = '') {
  const customSegments = splitSafePathSegments(agentConfig.whatsappAuthNamespace);
  if (customSegments.length > 0) {
    return join('auth', ...customSegments);
  }

  return buildWhatsAppSessionIdentity(agentConfig, channelId).authDir;
}

function normalizeApprovedCustomerEntry(channelType, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (normalizeChannelType(channelType) === 'WHATSAPP') {
    return raw
      .replace(/^whatsapp:/i, '')
      .replace(/^wa:/i, '')
      .replace(/@(s\.whatsapp\.net|g\.us)$/i, '');
  }

  return raw
    .replace(/^telegram:/i, '')
    .replace(/^tg:/i, '')
    .replace(/^user:/i, '');
}

function readAllowFromStore(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const allowFrom = Array.isArray(parsed?.allowFrom)
      ? parsed.allowFrom.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    return { version: 1, allowFrom };
  } catch {
    return { version: 1, allowFrom: [] };
  }
}

function writeAllowFromStore(filePath, allowFrom) {
  mkdirSync(CREDENTIALS_DIR, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ version: 1, allowFrom }, null, 2)}\n`);
}

function grantChannelAccess(channelId, channelType, customerPhone) {
  const entry = normalizeApprovedCustomerEntry(channelType, customerPhone);
  if (!entry) {
    return { changed: false, allowFrom: [], entry: null };
  }

  const filePath = resolveAllowFromStorePath(channelType, channelId);
  const current = readAllowFromStore(filePath);
  if (current.allowFrom.includes(entry)) {
    return { changed: false, allowFrom: current.allowFrom, entry };
  }

  const nextAllowFrom = [...current.allowFrom, entry];
  writeAllowFromStore(filePath, nextAllowFrom);
  return { changed: true, allowFrom: nextAllowFrom, entry };
}

function ensureChannelConfig(config, channelType) {
  if (!config.channels) config.channels = {};

  const channelKey = getChannelKey(channelType);
  if (config.channels[channelKey]) {
    if (!config.channels[channelKey].accounts) config.channels[channelKey].accounts = {};
    return config.channels[channelKey];
  }

  if (channelKey === 'whatsapp') {
    config.channels[channelKey] = {
      dmPolicy: 'open',
      allowFrom: ['*'],
      groupPolicy: 'disabled',
      configWrites: false,
      accounts: {},
    };
    return config.channels[channelKey];
  }

  config.channels[channelKey] = {
    dmPolicy: 'open',
    allowFrom: ['*'],
    configWrites: false,
    accounts: {},
  };
  return config.channels[channelKey];
}

function buildChannelAccountConfig(channelType, channelId, credentials = {}, agentConfig = {}) {
  const normalizedType = normalizeChannelType(channelType);
  const name = agentConfig.name || channelId;

  if (normalizedType === 'WHATSAPP') {
    return {
      name,
      enabled: true,
      authDir: resolveWhatsAppAuthDir(agentConfig, channelId),
    };
  }

  return {
    name,
    botToken: credentials.botToken,
    dmPolicy: 'open',
    allowFrom: ['*'],
  };
}

function normalizeSendTarget(channelType, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (normalizeChannelType(channelType) === 'WHATSAPP') {
    return raw.replace(/^wa:/i, '').replace(/@(s\.whatsapp\.net|g\.us)$/i, '');
  }

  return raw.replace(/^tg:/i, '');
}

function normalizeTier(value) {
  const tier = String(value || process.env.MYAGENTCLAW_RUNTIME_TIER || 'FREE').trim().toUpperCase();
  return ['FREE', 'STARTER', 'GROWTH', 'PRO'].includes(tier) ? tier : 'FREE';
}

function resolveSandboxMode(value = process.env.MYAGENTCLAW_SANDBOX_MODE) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['off', 'non-main', 'all'].includes(normalized) ? normalized : 'off';
}

function normalizeSharedWorkspaceAccess(value, options = {}) {
  if (!options.enabled) return 'none';

  const normalized = String(value || '').trim().toLowerCase();
  return ['none', 'ro', 'rw'].includes(normalized) ? normalized : 'none';
}

function resolveSharedWorkspaceOwnerKey(cfg = {}) {
  return String(cfg.ownerId || cfg.workspaceId || 'shared').trim() || 'shared';
}

function resolveSharedWorkspaceCanonicalDir(cfg = {}) {
  return join(SHARED_WORKSPACES_DIR, resolveSharedWorkspaceOwnerKey(cfg));
}

function resolveSharedWorkspaceProjectionDir(workspaceDir) {
  return join(workspaceDir, SHARED_WORKSPACE_FOLDER);
}

function directoryExists(dirPath) {
  try {
    return existsSync(dirPath) && statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function isDirectoryEmpty(dirPath) {
  return !directoryExists(dirPath) || readdirSync(dirPath).length === 0;
}

function applyWorkspacePermissions(dirPath, access) {
  if (!directoryExists(dirPath)) return;

  const dirMode = access === 'ro' ? 0o555 : 0o755;
  const fileMode = access === 'ro' ? 0o444 : 0o644;

  const walk = (currentPath) => {
    const stats = statSync(currentPath);
    chmodSync(currentPath, stats.isDirectory() ? dirMode : fileMode);

    if (!stats.isDirectory()) return;

    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      walk(join(currentPath, entry.name));
    }
  };

  walk(dirPath);
}

function makeDirectoryWritable(dirPath) {
  if (!directoryExists(dirPath)) return;

  const walk = (currentPath) => {
    const stats = statSync(currentPath);
    chmodSync(currentPath, stats.isDirectory() ? 0o755 : 0o644);

    if (!stats.isDirectory()) return;

    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      walk(join(currentPath, entry.name));
    }
  };

  walk(dirPath);
}

function replaceDirectoryContents(sourceDir, targetDir, access) {
  mkdirSync(sourceDir, { recursive: true });
  makeDirectoryWritable(targetDir);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(join(targetDir, '..'), { recursive: true });

  if (directoryExists(sourceDir)) {
    cpSync(sourceDir, targetDir, { recursive: true, force: true });
  } else {
    mkdirSync(targetDir, { recursive: true });
  }

  applyWorkspacePermissions(targetDir, access);
}

function fingerprintDirectory(dirPath) {
  if (!directoryExists(dirPath)) {
    return { token: '', latestMtimeMs: 0 };
  }

  let latestMtimeMs = 0;
  const entries = [];

  const walk = (currentPath, relativePath) => {
    const stats = statSync(currentPath);
    const entryKey = relativePath || '.';
    const mtimeMs = Math.round(stats.mtimeMs || 0);
    latestMtimeMs = Math.max(latestMtimeMs, mtimeMs);
    entries.push(`${entryKey}|${stats.isDirectory() ? 'd' : 'f'}|${stats.size}|${mtimeMs}`);

    if (!stats.isDirectory()) return;

    const children = readdirSync(currentPath, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    for (const child of children) {
      walk(join(currentPath, child), relativePath ? `${relativePath}/${child}` : child);
    }
  };

  walk(dirPath, '');
  return {
    token: entries.join('\n'),
    latestMtimeMs,
  };
}

function ensureSharedWorkspaceController(ownerKey, canonicalDir) {
  let controller = sharedWorkspaceControllers.get(ownerKey);
  if (!controller) {
    controller = {
      ownerKey,
      canonicalDir,
      agents: new Map(),
      lastCanonical: { token: '', latestMtimeMs: 0 },
      lastAgents: new Map(),
      timer: null,
      busy: false,
    };
    sharedWorkspaceControllers.set(ownerKey, controller);
  }

  controller.canonicalDir = canonicalDir;
  mkdirSync(canonicalDir, { recursive: true });
  return controller;
}

function refreshSharedWorkspaceFingerprints(controller) {
  controller.lastCanonical = fingerprintDirectory(controller.canonicalDir);
  controller.lastAgents = new Map(
    [...controller.agents.entries()].map(([agentId, agentState]) => [
      agentId,
      fingerprintDirectory(agentState.projectionDir),
    ]),
  );
}

function refreshSharedWorkspaceTimer(controller) {
  const hasWritableProjection = [...controller.agents.values()].some((entry) => entry.access === 'rw');

  if (!hasWritableProjection && controller.timer) {
    clearInterval(controller.timer);
    controller.timer = null;
  }

  if (hasWritableProjection && !controller.timer) {
    controller.timer = setInterval(() => {
      reconcileSharedWorkspace(controller.ownerKey);
    }, SHARED_WORKSPACE_SYNC_MS);
    if (typeof controller.timer.unref === 'function') {
      controller.timer.unref();
    }
  }

  if (controller.agents.size === 0) {
    if (controller.timer) {
      clearInterval(controller.timer);
      controller.timer = null;
    }
    sharedWorkspaceControllers.delete(controller.ownerKey);
  }
}

function reconcileSharedWorkspace(ownerKey) {
  const controller = sharedWorkspaceControllers.get(ownerKey);
  if (!controller || controller.busy) return;

  controller.busy = true;

  try {
    mkdirSync(controller.canonicalDir, { recursive: true });
    const canonicalState = fingerprintDirectory(controller.canonicalDir);
    const writableChanges = [];

    for (const [agentId, agentState] of controller.agents.entries()) {
      mkdirSync(join(agentState.projectionDir, '..'), { recursive: true });

      if (agentState.access === 'none') {
        controller.agents.delete(agentId);
        continue;
      }

      if (!directoryExists(agentState.projectionDir)) {
        replaceDirectoryContents(controller.canonicalDir, agentState.projectionDir, agentState.access);
      }

      const projectionState = fingerprintDirectory(agentState.projectionDir);
      const previousProjectionState = controller.lastAgents.get(agentId) || { token: '', latestMtimeMs: 0 };

      if (agentState.access === 'rw' && projectionState.token !== previousProjectionState.token) {
        writableChanges.push({
          agentId,
          projectionDir: agentState.projectionDir,
          state: projectionState,
        });
      }
    }

    const canonicalChanged = canonicalState.token !== controller.lastCanonical.token;

    if (canonicalChanged) {
      for (const agentState of controller.agents.values()) {
        replaceDirectoryContents(controller.canonicalDir, agentState.projectionDir, agentState.access);
      }
    } else if (writableChanges.length > 0) {
      const winner = writableChanges.sort((left, right) => right.state.latestMtimeMs - left.state.latestMtimeMs)[0];
      replaceDirectoryContents(winner.projectionDir, controller.canonicalDir, 'rw');
      for (const agentState of controller.agents.values()) {
        replaceDirectoryContents(controller.canonicalDir, agentState.projectionDir, agentState.access);
      }
    }

    refreshSharedWorkspaceFingerprints(controller);
    refreshSharedWorkspaceTimer(controller);
  } catch (error) {
    console.warn('[gateway-manager] shared workspace reconcile failed:', error?.message || error);
  } finally {
    controller.busy = false;
  }
}

function attachSharedWorkspaceProjection({ agentId, workspaceDir, ownerKey, canonicalDir, access }) {
  const controller = ensureSharedWorkspaceController(ownerKey, canonicalDir);
  const projectionDir = resolveSharedWorkspaceProjectionDir(workspaceDir);

  if (access === 'none') {
    controller.agents.delete(agentId);
    controller.lastAgents.delete(agentId);
    makeDirectoryWritable(projectionDir);
    rmSync(projectionDir, { recursive: true, force: true });
    refreshSharedWorkspaceTimer(controller);
    refreshSharedWorkspaceFingerprints(controller);
    return;
  }

  mkdirSync(canonicalDir, { recursive: true });

  if (access === 'rw' && isDirectoryEmpty(canonicalDir) && directoryExists(projectionDir) && !isDirectoryEmpty(projectionDir)) {
    replaceDirectoryContents(projectionDir, canonicalDir, 'rw');
  }

  if (!directoryExists(projectionDir) || access === 'ro' || isDirectoryEmpty(projectionDir)) {
    replaceDirectoryContents(canonicalDir, projectionDir, access);
  } else {
    applyWorkspacePermissions(projectionDir, access);
  }

  controller.agents.set(agentId, { projectionDir, access });
  refreshSharedWorkspaceFingerprints(controller);
  refreshSharedWorkspaceTimer(controller);
}

function detachSharedWorkspaceProjection(agentId) {
  for (const controller of sharedWorkspaceControllers.values()) {
    if (!controller.agents.has(agentId)) continue;
    controller.agents.delete(agentId);
    controller.lastAgents.delete(agentId);
    refreshSharedWorkspaceTimer(controller);
    if (sharedWorkspaceControllers.has(controller.ownerKey)) {
      refreshSharedWorkspaceFingerprints(controller);
    }
  }
}

function buildToolPolicyForTier(tier) {
  if (tier === 'FREE') {
    return {
      profile: 'messaging',
      alsoAllow: ['read', 'web_fetch'],
      fs: { workspaceOnly: true },
    };
  }

  if (tier === 'STARTER') {
    return {
      profile: 'coding',
      deny: ['exec', 'process', 'sessions_spawn', 'subagents', 'code_execution'],
      fs: { workspaceOnly: true },
    };
  }

  return {
    profile: 'coding',
    fs: { workspaceOnly: true },
    exec: {
      timeoutSec: tier === 'GROWTH' || tier === 'PRO' ? 300 : 120,
      backgroundMs: tier === 'GROWTH' || tier === 'PRO' ? 300000 : 60000,
      notifyOnExit: true,
    },
  };
}

function applyTierToolPolicy(config, tier) {
  const policy = buildToolPolicyForTier(tier);
  config.tools = {
    ...(config.tools || {}),
    ...policy,
    fs: {
      ...((config.tools || {}).fs || {}),
      ...(policy.fs || {}),
      workspaceOnly: true,
    },
  };

  if (!policy.alsoAllow) delete config.tools.alsoAllow;
  if (!policy.deny) delete config.tools.deny;
  if (!policy.exec) delete config.tools.exec;
}

function buildAgentToolPolicy(cfg = {}) {
  const tierPolicy = buildToolPolicyForTier(normalizeTier(cfg.subTier));
  const assignedSkills = normalizeAssignedSkills(cfg.assignedSkills ?? cfg.openclawSkill) || [];
  const hasPolymarketSkill = assignedSkills.includes('polymarket-read-only') || assignedSkills.includes('polymarket-growth-autopilot');

  if (!hasPolymarketSkill) {
    return tierPolicy;
  }

  const alsoAllow = new Set([...(tierPolicy.alsoAllow || []), 'read', 'web_fetch', 'polymarket_read_only', 'polymarket_growth_autopilot']);
  const deny = new Set([...(tierPolicy.deny || []), 'exec', 'process', 'sessions_spawn', 'subagents', 'code_execution']);

  return {
    ...tierPolicy,
    profile: 'messaging',
    alsoAllow: [...alsoAllow],
    deny: [...deny],
    exec: undefined,
    fs: { workspaceOnly: true },
  };
}

function getHostnameFromUrl(value) {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

function ensureAllowedHostname(config, hostname) {
  if (!hostname) return;

  if (!config.browser) config.browser = {};
  if (!config.browser.ssrfPolicy) config.browser.ssrfPolicy = {};

  const allowedHostnames = Array.isArray(config.browser.ssrfPolicy.allowedHostnames)
    ? config.browser.ssrfPolicy.allowedHostnames.filter((entry) => typeof entry === 'string' && entry.trim())
    : [];

  if (!allowedHostnames.includes(hostname)) {
    allowedHostnames.push(hostname);
  }

  config.browser.ssrfPolicy.allowedHostnames = allowedHostnames;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return buildBaseConfig();
  try { return sanitizeRuntimeConfig(JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))); }
  catch { return buildBaseConfig(); }
}

function saveConfig(config) {
  mkdirSync(OPENCLAW_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(sanitizeRuntimeConfig(config), null, 2));
}

function touchConfig() {
  saveConfig(readConfig());
}

function buildGatewayHeaders(extraHeaders = {}) {
  const config = readConfig();
  const runtimeGatewayToken = GATEWAY_TOKEN || config?.gateway?.auth?.token || '';
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (runtimeGatewayToken) {
    headers.Authorization = `Bearer ${runtimeGatewayToken}`;
  }

  return headers;
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

async function gatewayFetch(path, options = {}) {
  console.log('[gateway-manager] gatewayFetch:start', sanitizeQrPayload({
    path,
    method: options.method || 'GET',
    timeoutMs: options.timeoutMs || 30000,
    body: options.body || null,
  }));

  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method: options.method || 'GET',
    headers: buildGatewayHeaders(options.headers || {}),
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || 30000),
  });

  const text = await response.text().catch(() => '');
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  console.log('[gateway-manager] gatewayFetch:response', sanitizeQrPayload({
    path,
    method: options.method || 'GET',
    statusCode: response.status,
    ok: response.ok,
    summary: summarizeQrPayload(data || {}),
    rawRuntimePayload: data || (text ? { raw: text } : null),
  }));

  if (!response.ok) {
    throw new Error(`gateway ${options.method || 'GET'} ${path} -> ${response.status}: ${text}`);
  }

  return data;
}

function parseGatewayFetchError(error) {
  const message = String(error?.message || error || 'Gateway request gagal');
  const match = message.match(/->\s*(\d+):\s*([\s\S]*)$/);
  const statusCode = match ? Number(match[1]) : 502;
  const rawBody = match ? match[2] : message;

  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed === 'object') {
      return {
        statusCode: Number.isFinite(statusCode) ? statusCode : 502,
        payload: {
          ...parsed,
          adapterError: message,
          rawRuntimePayload: sanitizeQrPayload(parsed?.rawRuntimePayload || parsed),
        },
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
      adapterError: message,
      rawRuntimePayload: rawBody || message,
    },
  };
}

async function gatewayFetchWithFallback(paths, options = {}, meta = {}) {
  const candidates = [...new Set(
    (Array.isArray(paths) ? paths : [paths])
      .filter((path) => typeof path === 'string' && path.trim())
      .map((path) => path.trim()),
  )];

  let lastFailure = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidatePath = candidates[index];

    try {
      return await gatewayFetch(candidatePath, options);
    } catch (error) {
      const failure = parseGatewayFetchError(error);
      const canRetry = failure.statusCode === 404 && index < candidates.length - 1;
      lastFailure = failure;

      console.warn('[gateway-manager] gateway route attempt failed', sanitizeQrPayload({
        action: meta.action || 'gatewayFetchWithFallback',
        candidatePath,
        statusCode: failure.statusCode,
        channelId: meta.channelId || null,
        forceFreshLogin: meta.forceFreshLogin === true,
        willRetry: canRetry,
        payload: failure.payload,
      }));

      if (canRetry) {
        continue;
      }

      const enrichedError = new Error(
        failure.payload?.adapterError || failure.payload?.message || `Gateway request failed for ${candidatePath}`,
      );
      enrichedError.statusCode = failure.statusCode;
      enrichedError.payload = failure.payload;
      throw enrichedError;
    }
  }

  const fallbackFailure = lastFailure || {
    statusCode: 502,
    payload: {
      error: 'Bad Gateway',
      message: 'Semua route WhatsApp gateway gagal dijangkau.',
    },
  };
  const error = new Error(fallbackFailure.payload?.message || 'Gateway request gagal');
  error.statusCode = fallbackFailure.statusCode;
  error.payload = fallbackFailure.payload;
  throw error;
}

function parseSkillManifest(markdown = '') {
  const content = String(markdown || '');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = match ? match[1] : '';
  const fields = {};
  const requiredEnv = [];
  let inRequires = false;
  let inRequiresEnv = false;

  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      inRequires = false;
      inRequiresEnv = false;
    }

    if (trimmed === 'requires:') {
      inRequires = true;
      inRequiresEnv = false;
      continue;
    }

    if (inRequires && trimmed === 'env:') {
      inRequiresEnv = true;
      continue;
    }

    if (inRequiresEnv) {
      const envMatch = trimmed.match(/^-\s*([A-Z][A-Z0-9_]+)\s*$/);
      if (envMatch) {
        requiredEnv.push(envMatch[1]);
        continue;
      }

      if (trimmed && !trimmed.startsWith('-')) {
        inRequiresEnv = false;
      }
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1 || line.startsWith(' ') || line.startsWith('\t')) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;
    fields[key] = value.replace(/^['"]|['"]$/g, '');
  }

  return {
    skillKey: fields.name || null,
    displayName: fields.title || fields.displayName || fields.name || null,
    description: fields.description || null,
    homepage: fields.homepage || null,
    requiredEnv: [...new Set(requiredEnv)],
    requiresCommandExecution:
      /\b(node|python3?|bash|sh|ruby|perl|php)\s+\{baseDir\}[\\/]/i.test(content)
      || /\bexec\b/i.test(content) && /\{baseDir\}[\\/]/i.test(content),
  };
}

function normalizeAssignedSkills(openclawSkill) {
  const rawValues = Array.isArray(openclawSkill)
    ? openclawSkill
    : String(openclawSkill || '').split(/[\n,]/);

  const normalized = [...new Set(rawValues
    .map((value) => String(value || '').trim())
    .filter(Boolean))];

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeModelName(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'openai-codex/gpt-5.4';
  if (raw.includes('/')) return raw;
  return `openai/${raw}`;
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function findProviderBootstrapDir(provider, currentAgentId) {
  for (const agentsRoot of [join(OPENCLAW_HOME, 'agents'), BOOTSTRAP_AGENTS_DIR]) {
    if (!existsSync(agentsRoot)) continue;

    for (const entry of readdirSync(agentsRoot)) {
      if (agentsRoot === join(OPENCLAW_HOME, 'agents') && entry === currentAgentId) continue;

      const candidateDir = join(agentsRoot, entry, 'agent');
      const authProfilesPath = join(candidateDir, 'auth-profiles.json');
      if (!existsSync(authProfilesPath)) continue;

      const authStore = readJsonFile(authProfilesPath, {});
      const profiles = Object.values(authStore?.profiles || {});
      if (profiles.some((profile) => profile?.provider === provider)) {
        return candidateDir;
      }
    }
  }

  return null;
}

function hasProviderMode(authStore, provider, mode) {
  return Object.values(authStore?.profiles || {}).some((profile) => profile?.provider === provider && (profile?.mode || profile?.type) === mode);
}

function bootstrapProviderState(agentId, provider) {
  const targetDir = join(OPENCLAW_HOME, 'agents', agentId, 'agent');
  mkdirSync(targetDir, { recursive: true });

  const sourceDir = findProviderBootstrapDir(provider, agentId);
  if (!sourceDir) {
    return seedProviderAuthProfileFromEnv(targetDir, provider);
  }

  for (const fileName of ['auth-profiles.json', 'models.json']) {
    const sourcePath = join(sourceDir, fileName);
    const targetPath = join(targetDir, fileName);
    if (!existsSync(sourcePath)) continue;

    let shouldCopy = !existsSync(targetPath);
    if (fileName === 'auth-profiles.json' && existsSync(targetPath)) {
      const sourceStore = readJsonFile(sourcePath, {});
      const targetStore = readJsonFile(targetPath, {});
      shouldCopy = !hasProviderMode(targetStore, provider, 'oauth') && hasProviderMode(sourceStore, provider, 'oauth');
    }

    if (shouldCopy) {
      cpSync(sourcePath, targetPath, { force: true });
    }
  }

  return true;
}

function seedMissingDirectoryEntries(sourceDir, destinationDir) {
  if (!directoryExists(sourceDir)) return;

  mkdirSync(destinationDir, { recursive: true });

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const destinationPath = join(destinationDir, entry.name);
    if (existsSync(destinationPath)) continue;
    cpSync(sourcePath, destinationPath, { recursive: true, force: false, errorOnExist: false });
  }
}

function resolveProviderApiKeyEnvVar(provider) {
  switch (String(provider || '').trim().toLowerCase()) {
    case 'openai':
    case 'openai-codex':
      return 'OPENAI_API_KEY';
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    default:
      return null;
  }
}

function seedProviderAuthProfileFromEnv(agentDir, provider) {
  const envVar = resolveProviderApiKeyEnvVar(provider);
  if (!envVar || !String(process.env[envVar] || '').trim()) {
    return false;
  }

  const authProfilesPath = join(agentDir, 'auth-profiles.json');
  const existingStore = readJsonFile(authProfilesPath, {}) || {};
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const profileId = `${normalizedProvider}:default`;
  const profiles = {
    ...(existingStore.profiles || {}),
    [profileId]: {
      ...(existingStore.profiles?.[profileId] || {}),
      type: 'api_key',
      provider: normalizedProvider,
      keyRef: {
        source: 'env',
        provider: 'default',
        id: envVar,
      },
    },
  };

  const authStore = {
    version: existingStore.version || 1,
    profiles,
    selectedProfileId: existingStore.selectedProfileId || profileId,
    lastUsedProfileByModel: existingStore.lastUsedProfileByModel || {},
    usageStats: existingStore.usageStats || {},
  };

  writeFileSync(authProfilesPath, `${JSON.stringify(authStore, null, 2)}\n`);
  return true;
}

function resolveInstalledSkillDir(slug) {
  return join(SKILLS_DEST, slug);
}

function resolveBundledSkillDir(slug) {
  return join(SKILLS_SOURCE, slug);
}

function readInstallMetadata(skillDir) {
  const metadataPath = join(skillDir, INSTALL_METADATA_FILE);
  if (!existsSync(metadataPath)) return null;

  try {
    return JSON.parse(readFileSync(metadataPath, 'utf8'));
  } catch {
    return null;
  }
}

function readInstalledSkill(skillDir) {
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath)) return null;

  const manifest = parseSkillManifest(readFileSync(skillMdPath, 'utf8'));
  const metadata = readInstallMetadata(skillDir);
  const slug = metadata?.slug || skillDir.split(/[/\\]/).pop() || '';
  const skillKey = manifest.skillKey || metadata?.skillKey || slug;

  return {
    slug,
    skillKey,
    displayName: metadata?.displayName || manifest.displayName || skillKey,
    description: metadata?.summary || manifest.description || '',
    homepage: manifest.homepage || metadata?.homepage || '',
    version: metadata?.version || null,
    source: metadata?.source || 'local',
    requiredEnv: manifest.requiredEnv || [],
    requiresCommandExecution: Boolean(manifest.requiresCommandExecution),
    path: skillDir,
  };
}

function readBundledSkill(skillDir) {
  const skillMdPath = join(skillDir, 'SKILL.md');
  const hasSkillManifest = existsSync(skillMdPath);
  console.log('[gateway-manager] bundled skill folder read', {
    skillDir,
    skillMdPath,
    hasSkillManifest,
  });
  if (!hasSkillManifest) return null;

  const manifest = parseSkillManifest(readFileSync(skillMdPath, 'utf8'));
  const slug = skillDir.split(/[/\\]/).pop() || '';
  const skillKey = manifest.skillKey || slug;

  console.log('[gateway-manager] bundled SKILL.md parsed', {
    slug,
    skillKey,
    displayName: manifest.displayName || skillKey,
    skillMdPath,
  });

  return {
    slug,
    skillKey,
    displayName: manifest.displayName || skillKey,
    description: manifest.description || '',
    homepage: manifest.homepage || '',
    version: null,
    source: 'local',
    requiredEnv: manifest.requiredEnv || [],
    requiresCommandExecution: Boolean(manifest.requiresCommandExecution),
    path: skillDir,
  };
}

function configAllowsExec(config) {
  const tools = config?.tools || {};
  const profile = String(tools.profile || '').toLowerCase();
  const allowed = new Set(
    [...(tools.allow || []), ...(tools.alsoAllow || [])]
      .map((item) => String(item || '').toLowerCase())
      .filter(Boolean),
  );
  const denied = new Set(
    [...(tools.deny || [])]
      .map((item) => String(item || '').toLowerCase())
      .filter(Boolean),
  );

  if (denied.has('exec') || denied.has('group:runtime')) {
    return false;
  }

  if (profile === 'full' || profile === 'coding') {
    return true;
  }

  return ['*', 'exec', 'bash', 'group:runtime', 'group:openclaw'].some((item) => allowed.has(item));
}

function getSkillsRuntimeInfo() {
  const config = readConfig();
  return {
    allowsExec: configAllowsExec(config),
  };
}

function loadAssignedSkillPrompt(skillKey) {
  const normalizedSkillKey = String(skillKey || '').trim();
  if (!normalizedSkillKey) return '';

  const skillDir = resolveInstalledSkillDir(normalizedSkillKey);
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (!existsSync(skillMdPath)) return '';

  const markdown = readFileSync(skillMdPath, 'utf8');
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  if (!body) return '';

  return body.length > 6000 ? `${body.slice(0, 6000).trim()}\n\n[skill truncated]` : body;
}

function loadAssignedSkillPrompts(skillKeys) {
  const normalizedSkills = normalizeAssignedSkills(skillKeys) || [];
  const sections = normalizedSkills
    .map((skillKey) => {
      const body = loadAssignedSkillPrompt(skillKey);
      if (!body) return '';
      return `### ${skillKey}\n${body}`;
    })
    .filter(Boolean);

  return sections.join('\n\n');
}

function listInstalledSkills() {
  mkdirSync(SKILLS_DEST, { recursive: true });

  return readdirSync(SKILLS_DEST, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readInstalledSkill(join(SKILLS_DEST, entry.name)))
    .filter(Boolean)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function listBundledSkills() {
  if (!directoryExists(SKILLS_SOURCE)) {
    console.warn('[gateway-manager] bundled skills source missing', { skillsSource: SKILLS_SOURCE });
    return [];
  }

  console.log('[gateway-manager] listing bundled skills', { skillsSource: SKILLS_SOURCE });

  const skills = readdirSync(SKILLS_SOURCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readBundledSkill(join(SKILLS_SOURCE, entry.name)))
    .filter(Boolean)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  console.log('[gateway-manager] bundled skills listed', {
    skillsSource: SKILLS_SOURCE,
    slugs: skills.map((skill) => skill.slug),
  });

  return skills;
}

async function fetchClawHubSkillDetail(slug) {
  const response = await fetch(`${CLAWHUB_URL}/api/v1/skills/${encodeURIComponent(slug)}`, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`clawhub detail ${slug} -> ${response.status}: ${text}`);
  }

  return response.json();
}

async function downloadClawHubSkillArchive(slug, version) {
  const downloadOrigins = [CLAWHUB_URL, CLAWHUB_DOWNLOAD_URL].filter(Boolean);
  let lastError = null;

  for (const origin of downloadOrigins) {
    const url = new URL('/api/v1/download', `${origin}/`);
    url.searchParams.set('slug', slug);
    if (version) {
      url.searchParams.set('version', version);
    }

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }

    const text = await response.text().catch(() => '');
    lastError = new Error(`clawhub download ${slug} (${origin}) -> ${response.status}: ${text}`);

    // Retry against the direct archive host when the ClawHub proxy is rate-limited.
    if (response.status !== 429) {
      throw lastError;
    }
  }

  throw lastError || new Error(`clawhub download ${slug} gagal tanpa detail error`);
}

function findSkillRoot(searchDir) {
  if (existsSync(join(searchDir, 'SKILL.md'))) {
    return searchDir;
  }

  for (const entry of readdirSync(searchDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = findSkillRoot(join(searchDir, entry.name));
    if (nested) {
      return nested;
    }
  }

  return null;
}

async function installSkillFromClawHub({ slug, version, force = false }) {
  const normalizedSlug = String(slug || '').trim();
  if (!normalizedSlug) {
    const error = new Error('slug diperlukan');
    error.statusCode = 400;
    throw error;
  }

  const targetDir = resolveInstalledSkillDir(normalizedSlug);
  if (existsSync(targetDir) && !force) {
    const error = new Error(`Skill ${normalizedSlug} sudah terinstall`);
    error.statusCode = 409;
    throw error;
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'myagentclaw-clawhub-'));
  const archivePath = join(tempDir, `${normalizedSlug}.zip`);
  const extractDir = join(tempDir, 'extract');
  mkdirSync(extractDir, { recursive: true });

  try {
    const [archiveBuffer, detail] = await Promise.all([
      downloadClawHubSkillArchive(normalizedSlug, version),
      fetchClawHubSkillDetail(normalizedSlug).catch(() => null),
    ]);

    writeFileSync(archivePath, archiveBuffer);
    await unzipper.Open.file(archivePath).then((directory) => directory.extract({ path: extractDir }));

    const skillRoot = findSkillRoot(extractDir);
    if (!skillRoot) {
      const error = new Error(`Arsip skill ${normalizedSlug} tidak mengandung SKILL.md`);
      error.statusCode = 422;
      throw error;
    }

    const manifest = parseSkillManifest(readFileSync(join(skillRoot, 'SKILL.md'), 'utf8'));

    rmSync(targetDir, { recursive: true, force: true });
    cpSync(skillRoot, targetDir, { recursive: true });
    writeFileSync(join(targetDir, INSTALL_METADATA_FILE), JSON.stringify({
      slug: normalizedSlug,
      skillKey: manifest.skillKey || normalizedSlug,
      displayName: detail?.skill?.displayName || manifest.displayName || manifest.skillKey || normalizedSlug,
      summary: detail?.skill?.summary || manifest.description || '',
      homepage: manifest.homepage || '',
      version: detail?.latestVersion?.version || version || null,
      source: 'clawhub',
      installedAt: new Date().toISOString(),
    }, null, 2));

    touchConfig();
    return readInstalledSkill(targetDir);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function installBundledSkill({ slug, force = false }) {
  const normalizedSlug = String(slug || '').trim();
  if (!normalizedSlug) {
    const error = new Error('slug diperlukan');
    error.statusCode = 400;
    throw error;
  }

  const sourceDir = resolveBundledSkillDir(normalizedSlug);
  const targetDir = resolveInstalledSkillDir(normalizedSlug);
  const skillMdPath = join(sourceDir, 'SKILL.md');

  console.log('[gateway-manager] install bundled skill requested', {
    slug: normalizedSlug,
    force,
    sourceDir,
    targetDir,
    skillMdPath,
  });

  if (!existsSync(skillMdPath)) {
    console.warn('[gateway-manager] install bundled skill missing SKILL.md', {
      slug: normalizedSlug,
      sourceDir,
      skillMdPath,
    });
    const error = new Error(`Skill built-in ${normalizedSlug} tidak ditemukan`);
    error.statusCode = 404;
    throw error;
  }

  if (existsSync(targetDir) && !force) {
    const error = new Error(`Skill ${normalizedSlug} sudah terinstall`);
    error.statusCode = 409;
    throw error;
  }

  const manifest = parseSkillManifest(readFileSync(skillMdPath, 'utf8'));

  rmSync(targetDir, { recursive: true, force: true });
  cpSync(sourceDir, targetDir, { recursive: true, force: true });
  writeFileSync(join(targetDir, INSTALL_METADATA_FILE), JSON.stringify({
    slug: normalizedSlug,
    skillKey: manifest.skillKey || normalizedSlug,
    displayName: manifest.displayName || manifest.skillKey || normalizedSlug,
    summary: manifest.description || '',
    homepage: manifest.homepage || '',
    version: null,
    source: 'bundled',
    installedAt: new Date().toISOString(),
  }, null, 2));

  touchConfig();
  const installedSkill = readInstalledSkill(targetDir);
  console.log('[gateway-manager] install bundled skill success', {
    slug: normalizedSlug,
    installedSkillSlug: installedSkill?.slug || normalizedSlug,
    installedSkillKey: installedSkill?.skillKey || manifest.skillKey || normalizedSlug,
    targetDir,
  });
  return installedSkill;
}

function uninstallInstalledSkill(slug) {
  const normalizedSlug = String(slug || '').trim();
  if (!normalizedSlug) {
    const error = new Error('slug diperlukan');
    error.statusCode = 400;
    throw error;
  }

  const targetDir = resolveInstalledSkillDir(normalizedSlug);
  console.log('[gateway-manager] uninstall skill requested', {
    slug: normalizedSlug,
    targetDir,
  });

  if (!existsSync(targetDir)) {
    console.warn('[gateway-manager] uninstall skill target missing', {
      slug: normalizedSlug,
      targetDir,
    });
    const error = new Error(`Skill ${normalizedSlug} tidak ditemukan`);
    error.statusCode = 404;
    throw error;
  }

  const installedSkill = readInstalledSkill(targetDir) || {
    slug: normalizedSlug,
    skillKey: normalizedSlug,
    displayName: normalizedSlug,
  };

  rmSync(targetDir, { recursive: true, force: true });
  touchConfig();

  console.log('[gateway-manager] uninstall skill success', {
    slug: normalizedSlug,
    targetDir,
  });

  return installedSkill;
}

function buildFollowupPrompt(payload = {}) {
  const {
    customerName = 'Pelanggan',
    customerPhone = '',
    followupType = 'FOLLOW_UP',
    recentMessages = [],
  } = payload;

  const conversationContext = Array.isArray(recentMessages) && recentMessages.length > 0
    ? recentMessages
      .map((item) => `- ${item.role}: ${item.content}`)
      .join('\n')
    : '- Belum ada ringkasan percakapan sebelumnya.';

  return [
    'Ini adalah tugas follow-up terjadwal untuk pelanggan lama.',
    'Tulis SATU pesan follow-up final yang siap kirim ke pelanggan.',
    'Jangan gunakan tools apa pun dalam run ini.',
    'Jangan sebutkan sistem internal, session, tool, model, atau bahwa ini pesan otomatis.',
    'Jika follow-up tidak perlu dikirim, balas persis NO_REPLY.',
    'Jika follow-up perlu dikirim, balas hanya isi pesan final tanpa tanda kutip dan tanpa penjelasan tambahan.',
    '',
    `Jenis follow-up: ${followupType}`,
    `Nama pelanggan: ${customerName}`,
    `Identitas pelanggan: ${customerPhone}`,
    'Ringkasan percakapan terakhir:',
    conversationContext,
  ].join('\n');
}

function isProviderErrorMessage(message = '') {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) return false;

  return [
    'you exceeded your current quota',
    'check your plan and billing details',
    'platform.openai.com/docs/guides/error-codes',
    'rate limit',
    'api_error',
  ].some((fragment) => normalized.includes(fragment));
}

function syncDefaultChannelAccount(config, channelType) {
  const channelKey = getChannelKey(channelType);
  const channelConfig = config.channels?.[channelKey];
  if (!channelConfig) return;

  const accountIds = Object.keys(channelConfig.accounts || {});
  if (accountIds.length === 0) {
    delete channelConfig.defaultAccount;
    return;
  }

  if (!channelConfig.defaultAccount || !accountIds.includes(channelConfig.defaultAccount)) {
    channelConfig.defaultAccount = accountIds[0];
  }
}

function sanitizeRuntimeConfig(config = {}) {
  const whatsappAccounts = config?.channels?.whatsapp?.accounts;
  if (!whatsappAccounts || typeof whatsappAccounts !== 'object') {
    return config;
  }

  for (const accountConfig of Object.values(whatsappAccounts)) {
    if (!accountConfig || typeof accountConfig !== 'object') {
      continue;
    }

    delete accountConfig.runtimeSessionId;
    delete accountConfig.adapterSessionId;
  }

  return config;
}

function buildBaseConfig() {
  const internalKey = process.env.INTERNAL_SECRET_KEY || '';
  const backendUrl  = process.env.BACKEND_INTERNAL_URL || 'http://backend:3001';
  const backendHostname = getHostnameFromUrl(backendUrl);
  const model       = normalizeModelName(process.env.DEFAULT_LLM_MODEL || 'openai-codex/gpt-5.4');
  const sandboxMode = resolveSandboxMode();

  const config = {
    agents: {
      defaults: {
        model,
        skipBootstrap: false,
        sandbox: { mode: sandboxMode },
      },
      list: [],
    },
    channels: {
      telegram: {
        dmPolicy: 'open',
        allowFrom: ['*'],
        configWrites: false,
        accounts: {},
      },
      whatsapp: {
        dmPolicy: 'open',
        allowFrom: ['*'],
        groupPolicy: 'disabled',
        configWrites: false,
        accounts: {},
      },
    },
    bindings: [],
    tools: {
      fs: { workspaceOnly: true },
    },
    skills: {
      load: { extraDirs: [SKILLS_DEST], watch: false },
      entries: {
        'get-knowledge': {
          enabled: true,
          env: { BACKEND_INTERNAL_URL: backendUrl, INTERNAL_SECRET_KEY: internalKey },
        },
        'save-message': {
          enabled: true,
          env: { BACKEND_INTERNAL_URL: backendUrl, INTERNAL_SECRET_KEY: internalKey },
        },
        'check-quota': {
          enabled: true,
          env: { BACKEND_INTERNAL_URL: backendUrl, INTERNAL_SECRET_KEY: internalKey },
        },
      },
    },
    plugins: {
      enabled: true,
      load: {
        paths: [PLUGINS_DEST],
      },
      entries: {
        'customer-block-guard': {
          enabled: true,
        },
        'quota-guard': {
          enabled: true,
        },
      },
    },
    gateway: {
      mode: 'local',
      bind: 'lan',
      port: 18789,
      auth: RESOLVED_GATEWAY_TOKEN
        ? { mode: 'token', token: RESOLVED_GATEWAY_TOKEN }
        : { mode: 'none' },
      http: {
        endpoints: {
          chatCompletions: { enabled: true },
        },
      },
      reload: { mode: 'hybrid', debounceMs: 500 },
    },
  };

  applyTierToolPolicy(config, normalizeTier());

  ensureAllowedHostname(config, backendHostname);

  return config;
}

// ---------------------------------------------------------------------------
// Setup satu kali saat startup
// ---------------------------------------------------------------------------

function setup() {
  console.log('[gateway-manager] Setting up directories and config...');
  mkdirSync(OPENCLAW_HOME, { recursive: true });
  mkdirSync(WORKSPACES_DIR, { recursive: true });
  mkdirSync(SHARED_WORKSPACES_DIR, { recursive: true });
  mkdirSync(SKILLS_DEST, { recursive: true });
  mkdirSync(HOOKS_DEST, { recursive: true });
  mkdirSync(PLUGINS_DEST, { recursive: true });

  // Built-in skills tetap tersedia dari repo adapter, tetapi tidak dianggap
  // terinstall sampai owner memasangnya manual via Skills page.

  if (existsSync(HOOKS_SOURCE)) {
    cpSync(HOOKS_SOURCE, HOOKS_DEST, { recursive: true });
    applyWorkspacePermissions(HOOKS_DEST, 'rw');
    console.log('[gateway-manager] Hooks copied to', HOOKS_DEST);
  }

  if (existsSync(PLUGINS_SOURCE)) {
    cpSync(PLUGINS_SOURCE, PLUGINS_DEST, { recursive: true });
    applyWorkspacePermissions(PLUGINS_DEST, 'rw');
    console.log('[gateway-manager] Plugins copied to', PLUGINS_DEST);
  }

  // Tulis base config jika belum ada, atau update env fields
  const config = existsSync(CONFIG_PATH) ? readConfig() : buildBaseConfig();

  const internalKey = process.env.INTERNAL_SECRET_KEY || '';
  const backendUrl  = process.env.BACKEND_INTERNAL_URL || 'http://backend:3001';
  const backendHostname = getHostnameFromUrl(backendUrl);
  const defaultModel = normalizeModelName(process.env.DEFAULT_LLM_MODEL || 'openai-codex/gpt-5.4');
  const sandboxMode = resolveSandboxMode();

  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  config.agents.defaults.model = defaultModel;
  config.agents.defaults.sandbox = {
    ...(config.agents.defaults.sandbox || {}),
    mode: sandboxMode,
  };
  if (Array.isArray(config.agents.list)) {
    config.agents.list = config.agents.list.map((agent) => ({
      ...agent,
      sandbox: {
        ...(agent?.sandbox || {}),
        mode: sandboxMode,
      },
    }));
  }

  // Update env di semua skill entries
  if (config.skills?.entries) {
    for (const skill of Object.values(config.skills.entries)) {
      if (skill.env) {
        skill.env.BACKEND_INTERNAL_URL = backendUrl;
        skill.env.INTERNAL_SECRET_KEY  = internalKey;
      }
    }
  }

  // Pastikan global skills dir ada di extraDirs
  if (config.skills?.load) {
    config.skills.load.extraDirs = config.skills.load.extraDirs || [];
    if (!config.skills.load.extraDirs.includes(SKILLS_DEST)) {
      config.skills.load.extraDirs.push(SKILLS_DEST);
    }
  }

  if (!config.plugins) config.plugins = {};
  config.plugins.enabled = true;
  config.plugins.load = config.plugins.load || {};
  config.plugins.load.paths = Array.isArray(config.plugins.load.paths)
    ? config.plugins.load.paths.filter((entry) => typeof entry === 'string' && entry.trim())
    : [];
  if (!config.plugins.load.paths.includes(PLUGINS_DEST)) {
    config.plugins.load.paths.push(PLUGINS_DEST);
  }
  config.plugins.entries = config.plugins.entries || {};
  config.plugins.entries['customer-block-guard'] = {
    ...(config.plugins.entries['customer-block-guard'] || {}),
    enabled: true,
  };
  config.plugins.entries['quota-guard'] = {
    ...(config.plugins.entries['quota-guard'] || {}),
    enabled: true,
  };
  config.plugins.entries['polymarket-read-only'] = {
    ...(config.plugins.entries['polymarket-read-only'] || {}),
    enabled: true,
  };
  config.plugins.entries['polymarket-growth-autopilot'] = {
    ...(config.plugins.entries['polymarket-growth-autopilot'] || {}),
    enabled: true,
  };
  config.plugins.entries['whatsapp-link-bridge'] = {
    ...(config.plugins.entries['whatsapp-link-bridge'] || {}),
    enabled: true,
  };

  // Aktifkan internal hooks untuk sinkronisasi event pesan ke backend.
  if (!config.hooks) config.hooks = {};
  if (!config.hooks.internal) config.hooks.internal = {};
  config.hooks.internal.enabled = true;
  config.hooks.internal.load = config.hooks.internal.load || {};
  config.hooks.internal.load.extraDirs = config.hooks.internal.load.extraDirs || [];
  if (!config.hooks.internal.load.extraDirs.includes(HOOKS_DEST)) {
    config.hooks.internal.load.extraDirs.push(HOOKS_DEST);
  }
  config.hooks.internal.entries = config.hooks.internal.entries || {};
  config.hooks.internal.entries['message-sync'] = {
    ...(config.hooks.internal.entries['message-sync'] || {}),
    enabled: true,
    env: {
      BACKEND_INTERNAL_URL: backendUrl,
      INTERNAL_SECRET_KEY: internalKey,
    },
  };

  // Pastikan gateway bind = lan (Docker network accessible)
  if (!config.gateway) config.gateway = {};
  config.gateway.mode = 'local';
  config.gateway.bind = 'lan';
  config.gateway.port = parseInt(process.env.OPENCLAW_GATEWAY_PORT || '18789', 10);
  config.gateway.auth = RESOLVED_GATEWAY_TOKEN
    ? { mode: 'token', token: RESOLVED_GATEWAY_TOKEN }
    : { mode: 'none' };
  if (!config.gateway.http) config.gateway.http = {};
  if (!config.gateway.http.endpoints) config.gateway.http.endpoints = {};
  config.gateway.http.endpoints.chatCompletions = {
    ...(config.gateway.http.endpoints.chatCompletions || {}),
    enabled: true,
  };

  // Terapkan policy tool berdasarkan tier runtime, tetapi tetap kunci file ke workspace agent.
  if (!config.tools) config.tools = {};
  delete config.tools.allow;
  applyTierToolPolicy(config, normalizeTier());
  ensureAllowedHostname(config, backendHostname);

  ensureChannelConfig(config, 'TELEGRAM');
  ensureChannelConfig(config, 'WHATSAPP');
  syncDefaultChannelAccount(config, 'TELEGRAM');
  syncDefaultChannelAccount(config, 'WHATSAPP');

  saveConfig(config);
  console.log('[gateway-manager] Config written to', CONFIG_PATH);
}

// ---------------------------------------------------------------------------
// Bot management — tulis ke openclaw.json, openclaw auto hot-reload
// ---------------------------------------------------------------------------

function registerChannel(channelId, channelType, credentials = {}, agentId, agentConfig = {}) {
  const config = readConfig();
  const agentModel = normalizeModelName(agentConfig.llmModel || config.agents?.defaults?.model || 'openai-codex/gpt-5.4');
  const sandboxMode = resolveSandboxMode(agentConfig.sandboxMode);
  const resolvedAgentId = String(agentId || agentConfig.agentId || channelId);
  const workspaceKey = String(agentConfig.privateWorkspaceKey || resolvedAgentId || channelId);
  const runtimeTier = normalizeTier(agentConfig.subTier);
  const normalizedType = normalizeChannelType(channelType);
  const channelKey = getChannelKey(normalizedType);
  const sharedWorkspaceAccess = normalizeSharedWorkspaceAccess(agentConfig.sharedWorkspaceAccess, {
    enabled: runtimeTier !== 'FREE' && agentConfig.hasSharedWorkspace !== false,
  });

  // Ensure structures exist
  ensureChannelConfig(config, normalizedType);
  if (!config.agents) config.agents = { defaults: { model: 'openai-codex/gpt-5.4' }, list: [] };
  if (!config.agents.list) config.agents.list = [];
  if (!config.bindings) config.bindings = [];

  const workspaceDir = join(WORKSPACES_DIR, workspaceKey);
  const provider = agentModel.split('/')[0] || '';

  config.channels[channelKey].accounts[channelId] = buildChannelAccountConfig(
    normalizedType,
    channelId,
    credentials,
    agentConfig,
  );

  const assignedSkills = normalizeAssignedSkills(agentConfig.assignedSkills ?? agentConfig.openclawSkill);
  const existingAgent = config.agents.list.find((a) => a.id === resolvedAgentId);
  const agentTools = buildAgentToolPolicy({ ...agentConfig, subTier: runtimeTier });

  // Tambah agent ke list jika belum ada
  if (!existingAgent) {
    config.agents.list.push({
      id: resolvedAgentId,
      name: agentConfig.name || resolvedAgentId,
      model: agentModel,
      workspace: workspaceDir,
      sandbox: { mode: sandboxMode },
      tools: agentTools,
      ...(assignedSkills ? { skills: assignedSkills } : {}),
    });
  } else {
    existingAgent.name = agentConfig.name || existingAgent.name || resolvedAgentId;
    existingAgent.model = agentModel;
    existingAgent.workspace = workspaceDir;
    existingAgent.sandbox = {
      ...(existingAgent.sandbox || {}),
      mode: sandboxMode,
    };
    existingAgent.tools = agentTools;
    if (assignedSkills) {
      existingAgent.skills = assignedSkills;
    } else {
      delete existingAgent.skills;
    }
  }

  // Tambah atau perbarui binding channel -> agent stabil
  const existingBinding = config.bindings.find((b) => b.match?.channel === channelKey && b.match?.accountId === channelId);
  if (!existingBinding) {
    config.bindings.push({ match: { channel: channelKey, accountId: channelId }, agentId: resolvedAgentId });
  } else if (existingBinding.agentId !== resolvedAgentId) {
    const previousAgentId = existingBinding.agentId;
    existingBinding.agentId = resolvedAgentId;

    const oldAgentStillBound = config.bindings.some((binding) => binding.agentId === previousAgentId);
    if (!oldAgentStillBound && config.agents?.list) {
      config.agents.list = config.agents.list.filter((agent) => agent.id !== previousAgentId);
    }
  }

  // Buat workspace dir + AGENTS.md dengan persona agent
  mkdirSync(workspaceDir, { recursive: true });
  attachSharedWorkspaceProjection({
    agentId: resolvedAgentId,
    workspaceDir,
    ownerKey: resolveSharedWorkspaceOwnerKey(agentConfig),
    canonicalDir: resolveSharedWorkspaceCanonicalDir(agentConfig),
    access: sharedWorkspaceAccess,
  });
  writeFileSync(join(workspaceDir, 'AGENTS.md'), buildAgentsMd(channelId, {
    ...agentConfig,
    agentId: resolvedAgentId,
    channelType: normalizedType,
    sharedWorkspaceAccess,
    sharedWorkspaceFolder: SHARED_WORKSPACE_FOLDER,
  }));

  if (provider === 'openai-codex') {
    const bootstrapped = bootstrapProviderState(resolvedAgentId, provider);
    if (!bootstrapped) {
      console.warn(`[gateway-manager] Codex auth bootstrap not found for ${resolvedAgentId}`);
    }
  }

  syncDefaultChannelAccount(config, normalizedType);
  saveConfig(config);
  console.log(`[gateway-manager] ${getChannelLabel(normalizedType)} channel registered: ${channelId}`);
}

function registerBot(channelId, botToken, agentId, agentConfig = {}) {
  return registerChannel(channelId, 'TELEGRAM', { botToken }, agentId, agentConfig);
}

function unregisterChannel(channelId, channelType = 'TELEGRAM') {
  const config = readConfig();
  const normalizedType = normalizeChannelType(channelType);
  const channelKey = getChannelKey(normalizedType);
  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  const boundAgentId = bindings.find((b) => b.match?.channel === channelKey && b.match?.accountId === channelId)?.agentId;

  if (boundAgentId) {
    detachSharedWorkspaceProjection(boundAgentId);
  }

  if (config.channels?.[channelKey]?.accounts) {
    delete config.channels[channelKey].accounts[channelId];
  }
  if (config.bindings) {
    config.bindings = config.bindings.filter(
      (b) => !(b.match?.channel === channelKey && b.match?.accountId === channelId),
    );
  }

  if (config.agents?.list && boundAgentId) {
    const agentStillBound = config.bindings.some((b) => b.agentId === boundAgentId);
    if (!agentStillBound) {
      config.agents.list = config.agents.list.filter((a) => a.id !== boundAgentId);
    }
  }

  syncDefaultChannelAccount(config, normalizedType);
  saveConfig(config);
  console.log(`[gateway-manager] ${getChannelLabel(normalizedType)} channel unregistered: ${channelId}`);
}

function unregisterBot(channelId) {
  return unregisterChannel(channelId, 'TELEGRAM');
}

// ---------------------------------------------------------------------------
// Build AGENTS.md untuk setiap agent workspace
// Instruksi ini dibaca openclaw sebagai system prompt konteks
// ---------------------------------------------------------------------------

function buildAgentsMd(channelId, cfg = {}) {
  const {
    name          = 'AI Assistant',
    workspaceName = 'Workspace Kami',
    persona       = '',
    goal          = 'Membantu pengguna mencapai tujuan mereka dengan akurat dan aman.',
    tone          = 'Jelas, ramah, dan profesional',
    role          = 'AI Assistant',
    systemPrompt  = '',
    workspaceId   = '',
    agentId       = '',
    channelType   = 'TELEGRAM',
    assignedSkills = undefined,
    openclawSkill = '',
    sharedWorkspaceAccess = 'none',
    sharedWorkspaceFolder = SHARED_WORKSPACE_FOLDER,
  } = cfg;

  const backendUrl  = process.env.BACKEND_INTERNAL_URL || 'http://backend:3001';
  const internalKey = process.env.INTERNAL_SECRET_KEY  || '';
  const knowledgeUrl = `${backendUrl}/internal/knowledge/${agentId}?internal_key=${encodeURIComponent(internalKey)}`;
  const normalizedSkills = normalizeAssignedSkills(assignedSkills ?? openclawSkill) || [];
  const skillsLabel = normalizedSkills.map((skill) => `**${skill}**`).join(', ');
  const assignedSkillPrompt = loadAssignedSkillPrompts(normalizedSkills);
  const customSystemPrompt = String(systemPrompt || '').trim();

  return `# ${name} — ${role}

## Identitas
${customSystemPrompt || `Kamu adalah **${name}**, asisten AI dengan peran **${role}** untuk **${workspaceName}**.
${persona ? `\nKepribadian: ${persona}\n` : ''}`}

## Parameter Profil
- Role utama: ${role}
- Workspace: ${workspaceName}
- Persona: ${persona || 'Belum ditentukan'}

## Tujuan
${goal}

## Gaya Berbicara
${tone}

## Bahasa
Gunakan Bahasa Indonesia secara default, tetapi ikuti bahasa user bila berbeda.

${normalizedSkills.length > 0 ? `## Skill Aktif
Skill yang aktif untuk agent ini adalah ${skillsLabel}. Gunakan skill yang paling relevan dengan kebutuhan user, dan Anda boleh memakai lebih dari satu skill bila memang membantu.

- Jika pertanyaan user cocok dengan salah satu skill aktif, prioritaskan workflow skill itu sebelum menjawab secara umum.
- Jangan mengaku tool tidak tersedia, belum muncul di sesi, atau belum bisa dipakai sebelum benar-benar mencoba tool skill yang relevan atau menerima error nyata dari tool tersebut.
- Untuk pertanyaan Polymarket live, market trending, posisi, status autopilot, atau apakah auto trading sudah aktif, WAJIB pakai tool Polymarket yang relevan lebih dulu sebelum menjawab.

` : ''}## Konteks Internal (JANGAN disebutkan ke pelanggan)
- workspace_id: \`${workspaceId}\`
- agent_id: \`${agentId}\`
- channel_id: \`${channelId}\`
- channel_type: ${normalizeChannelType(channelType)}

${sharedWorkspaceAccess !== 'none' ? `## Shared Workspace
- Folder bersama tersedia di \`${sharedWorkspaceFolder}\`.
- Mode akses: **${sharedWorkspaceAccess === 'ro' ? 'read-only' : 'read-write'}**.
- Gunakan folder ini hanya untuk file yang memang perlu dibagikan antar agent dalam owner yang sama.
` : ''}

---

## ATURAN WAJIB — IKUTI SETIAP TURN

### Langkah 1 — Penyimpanan pesan sudah otomatis
Penyimpanan pesan pelanggan dan balasan AI sudah ditangani sistem internal secara otomatis. Jangan gunakan \`web_fetch\` untuk menyimpan pesan.

### Langkah 2 — Ambil knowledge base (jika ada pertanyaan produk/layanan/harga)
\`\`\`
GET ${knowledgeUrl}
\`\`\`
Gunakan tool \`web_fetch\` ke URL persis di atas, lalu pakai konten response untuk menjawab dengan akurat.

### Langkah 3 — Balas pelanggan
Tulis balasan yang helpful, singkat, dan sesuai gaya bicara di atas.

### Langkah 4 — Tidak perlu menyimpan balasan manual
Balasan AI juga sudah disimpan otomatis oleh sistem. Fokus pada jawaban yang akurat.

---

## Panduan Menjawab
- Jawab singkat dan jelas — hindari paragraf panjang
- Gunakan emoji sesekali agar terasa hangat 🙂
- Jika tidak tahu jawaban, jujur dan sarankan hubungi admin langsung
- JANGAN mengarang informasi yang tidak ada di knowledge base
- Jika item knowledge base punya \`referenceUrl\` yang relevan, bagikan link itu apa adanya ke pelanggan. Ini bisa dipakai untuk payment link universal, katalog, atau halaman referensi.
- JANGAN menyebutkan nama model AI atau teknologi yang digunakan
${normalizedSkills.length > 0 ? `- Jika pelanggan bertanya skill aktif, skill sekarang, atau kemampuan yang sedang dipakai, sebutkan daftar skill aktif secara eksplisit: ${skillsLabel}.
- Jika pelanggan meminta salah satu skill aktif untuk dipakai, gunakan skill tersebut bila memang relevan.
` : ''}

${assignedSkillPrompt ? `## Instruksi Skill Aktif
Jika user meminta salah satu skill aktif dipakai, ikuti instruksi skill berikut secara langsung. Jangan bilang skill tidak tersedia sebelum benar-benar mencoba tool yang relevan jika tool tersebut ada.

Jika skill aktif berkaitan dengan Polymarket, gunakan tool Polymarket lebih dulu untuk verifikasi status live atau data market. Jangan jawab capability autopilot atau ranking market dari asumsi model.

${assignedSkillPrompt}

` : ''}

## Session Startup
Saat percakapan baru dimulai (sesi baru), perkenalkan diri sebagai ${name} dari ${workspaceName}.
`;
}

// ---------------------------------------------------------------------------
// REST API adapter — backend calls ini untuk manage bots
// ---------------------------------------------------------------------------

async function startAdapterApi() {
  const api = Fastify({ logger: false });

  const registerAliasRoutes = (paths, handler) => {
    for (const path of [...new Set(paths)]) {
      api.post(path, handler);
    }
  };

  const replyWithGatewayFailure = (reply, action, channelId, error, extra = {}) => {
    const failure = error?.payload
      ? { statusCode: error.statusCode || 502, payload: error.payload }
      : parseGatewayFetchError(error);

    console.error(`[gateway-manager] ${action}:error`, sanitizeQrPayload({
      channelId: String(channelId || ''),
      ...extra,
      statusCode: failure.statusCode,
      payload: failure.payload,
    }));

    return reply.code(failure.statusCode).send(failure.payload);
  };

  const handleWhatsAppLinkStatusRequest = async (req, reply) => {
    const { channelId } = req.body || {};
    if (!channelId) {
      return reply.code(400).send({ error: 'channelId diperlukan' });
    }

    try {
      const result = await gatewayFetchWithFallback(WHATSAPP_GATEWAY_ROUTE_CANDIDATES.status, {
        method: 'POST',
        body: {
          accountId: String(channelId),
          channelId: String(channelId),
        },
        timeoutMs: 10000,
      }, {
        action: 'whatsapp-link-status',
        channelId: String(channelId),
      });
      console.log('[gateway-manager] whatsapp-link-status', sanitizeQrPayload({
        channelId: String(channelId),
        summary: summarizeQrPayload(result || {}),
        rawRuntimePayload: result?.rawRuntimePayload || result || null,
      }));
      return result;
    } catch (error) {
      return replyWithGatewayFailure(reply, 'whatsapp-link-status', channelId, error);
    }
  };

  const handleWhatsAppLinkStartRequest = async (req, reply) => {
    const {
      channelId,
      agentId,
      force,
      forceFreshLogin,
      timeoutMs,
      authNamespace,
      runtimeSessionId,
      adapterSessionId,
      previousAuthNamespace,
      previousRuntimeSessionId,
      previousAdapterSessionId,
      previousAuthDir,
    } = req.body || {};

    if (!channelId) {
      return reply.code(400).send({ error: 'channelId diperlukan' });
    }

    const requestedTimeoutMs = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 30000;
    const isFreshLogin = forceFreshLogin === true;

    if (isFreshLogin) {
      console.log('[gateway-manager] Fresh login requested', sanitizeQrPayload({
        channelId: String(channelId),
        agentId: agentId ? String(agentId) : null,
        previousRuntimeSessionId: previousRuntimeSessionId || null,
        previousAdapterSessionId: previousAdapterSessionId || null,
        previousAuthNamespace: previousAuthNamespace || null,
        authNamespace: authNamespace || null,
        runtimeSessionId: runtimeSessionId || null,
        adapterSessionId: adapterSessionId || null,
      }));
    }

    try {
      const result = await gatewayFetchWithFallback(WHATSAPP_GATEWAY_ROUTE_CANDIDATES.start, {
        method: 'POST',
        body: {
          accountId: String(channelId),
          channelId: String(channelId),
          agentId: agentId ? String(agentId) : undefined,
          force: force === true || isFreshLogin,
          forceFreshLogin: isFreshLogin,
          timeoutMs: requestedTimeoutMs,
          authNamespace: typeof authNamespace === 'string' ? authNamespace : undefined,
          runtimeSessionId: typeof runtimeSessionId === 'string' ? runtimeSessionId : undefined,
          adapterSessionId: typeof adapterSessionId === 'string' ? adapterSessionId : undefined,
          previousAuthNamespace: typeof previousAuthNamespace === 'string' ? previousAuthNamespace : undefined,
          previousRuntimeSessionId: typeof previousRuntimeSessionId === 'string' ? previousRuntimeSessionId : undefined,
          previousAdapterSessionId: typeof previousAdapterSessionId === 'string' ? previousAdapterSessionId : undefined,
          previousAuthDir: typeof previousAuthDir === 'string' ? previousAuthDir : undefined,
        },
        timeoutMs: Math.max(40000, requestedTimeoutMs + 10000),
      }, {
        action: 'whatsapp-link-start',
        channelId: String(channelId),
        forceFreshLogin: isFreshLogin,
      });

      console.log('[gateway-manager] whatsapp-link-start', sanitizeQrPayload({
        channelId: String(channelId),
        force: force === true,
        forceFreshLogin: isFreshLogin,
        authNamespace: authNamespace || null,
        summary: summarizeQrPayload(result || {}),
        rawRuntimePayload: result?.rawRuntimePayload || result || null,
      }));
      return result;
    } catch (error) {
      return replyWithGatewayFailure(reply, 'whatsapp-link-start', channelId, error, {
        force: force === true,
        forceFreshLogin: isFreshLogin,
      });
    }
  };

  const handleWhatsAppLinkWaitRequest = async (req, reply) => {
    const { channelId, timeoutMs } = req.body || {};
    if (!channelId) {
      return reply.code(400).send({ error: 'channelId diperlukan' });
    }

    try {
      const requestedTimeoutMs = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 120000;
      const result = await gatewayFetchWithFallback(WHATSAPP_GATEWAY_ROUTE_CANDIDATES.wait, {
        method: 'POST',
        body: {
          accountId: String(channelId),
          channelId: String(channelId),
          timeoutMs: requestedTimeoutMs,
        },
        timeoutMs: requestedTimeoutMs + 10000,
      }, {
        action: 'whatsapp-link-wait',
        channelId: String(channelId),
      });
      console.log('[gateway-manager] whatsapp-link-wait', sanitizeQrPayload({
        channelId: String(channelId),
        timeoutMs: requestedTimeoutMs,
        summary: summarizeQrPayload(result || {}),
        rawRuntimePayload: result?.rawRuntimePayload || result || null,
      }));
      return result;
    } catch (error) {
      return replyWithGatewayFailure(reply, 'whatsapp-link-wait', channelId, error, {
        timeoutMs: Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 120000,
      });
    }
  };

  api.get('/health', async () => ({
    status: 'ok',
    service: 'openclaw-adapter',
    gatewayConfigPath: CONFIG_PATH,
    timestamp: new Date().toISOString(),
  }));

  api.get('/bots', async () => {
    const config = readConfig();
    const bots = [];

    for (const channelType of ['TELEGRAM', 'WHATSAPP']) {
      const channelKey = getChannelKey(channelType);
      const accounts = config.channels?.[channelKey]?.accounts || {};
      for (const [id, acc] of Object.entries(accounts)) {
        bots.push({
          channelId: id,
          channelType,
          name: acc.name,
        });
      }
    }

    return {
      bots,
    };
  });

  api.post('/bots/start', async (req, reply) => {
    const { channelId, type, botToken, agentId, agentConfig } = req.body || {};
    const channelType = normalizeChannelType(type);

    if (!channelId) {
      return reply.code(400).send({ error: 'channelId diperlukan' });
    }

    if (channelType === 'TELEGRAM' && !botToken) {
      return reply.code(400).send({ error: 'botToken diperlukan untuk Telegram' });
    }

    try {
      registerChannel(channelId, channelType, { botToken }, agentId || channelId, agentConfig || {});
      return { ok: true, channelId, channelType };
    } catch (err) {
      console.error('[gateway-manager] registerChannel error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  api.post('/bots/stop', async (req, reply) => {
    const { channelId, type } = req.body || {};
    if (!channelId) return reply.code(400).send({ error: 'channelId diperlukan' });
    try {
      unregisterChannel(channelId, type || 'TELEGRAM');
      return { ok: true, channelId };
    } catch (err) {
      console.error('[gateway-manager] unregisterChannel error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  registerAliasRoutes(WHATSAPP_ADAPTER_ROUTE_ALIASES.status, handleWhatsAppLinkStatusRequest);
  registerAliasRoutes(WHATSAPP_ADAPTER_ROUTE_ALIASES.start, handleWhatsAppLinkStartRequest);
  registerAliasRoutes(WHATSAPP_ADAPTER_ROUTE_ALIASES.wait, handleWhatsAppLinkWaitRequest);

  api.post('/channels/access/grant', async (req, reply) => {
    const { channelId, channelType, customerPhone } = req.body || {};
    const normalizedType = normalizeChannelType(channelType);

    if (!channelId || !customerPhone) {
      return reply.code(400).send({ error: 'channelId dan customerPhone diperlukan' });
    }

    try {
      const result = grantChannelAccess(channelId, normalizedType, customerPhone);
      return { ok: true, channelId, channelType: normalizedType, ...result };
    } catch (err) {
      console.error('[gateway-manager] channels/access/grant error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  api.post('/messages/send', async (req, reply) => {
    const { channelId, channelType, to, text, replyToId, threadId } = req.body || {};
    const normalizedType = normalizeChannelType(channelType);
    const channelKey = getChannelKey(normalizedType);
    if (!channelId || !to || !text) {
      return reply.code(400).send({ error: 'channelId, to, dan text diperlukan' });
    }

    try {
      const result = await gatewayFetch('/tools/invoke', {
        method: 'POST',
        headers: {
          'x-openclaw-message-channel': channelKey,
          'x-openclaw-account-id': String(channelId),
        },
        body: {
          tool: 'message',
          action: 'send',
          sessionKey: 'main',
          args: {
            channel: channelKey,
            target: normalizeSendTarget(normalizedType, to),
            accountId: channelId,
            message: text,
            ...(replyToId ? { replyTo: String(replyToId) } : {}),
            ...(threadId ? { threadId: String(threadId) } : {}),
          },
        },
      });

      return { ok: true, result };
    } catch (err) {
      console.error('[gateway-manager] messages/send error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  api.post('/followups/generate', async (req, reply) => {
    const {
      agentId,
      channelId,
      channelType,
      customerId,
      customerPhone,
      customerName,
      followupType,
      recentMessages,
    } = req.body || {};

    if (!channelId || !customerId || !agentId) {
      return reply.code(400).send({ error: 'channelId, agentId, dan customerId diperlukan' });
    }

    try {
      const normalizedType = normalizeChannelType(channelType);
      const result = await gatewayFetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'x-openclaw-agent-id': String(agentId),
          'x-openclaw-session-key': `followup:${channelId}:${customerId}`,
          'x-openclaw-message-channel': getChannelKey(normalizedType),
        },
        body: {
          model: 'openclaw',
          stream: false,
          messages: [
            {
              role: 'system',
              content: 'Kamu sedang menyiapkan pesan follow-up outbound. Jangan panggil tools. Kembalikan hanya teks final atau NO_REPLY.',
            },
            {
              role: 'user',
              content: buildFollowupPrompt({
                customerName,
                customerPhone,
                followupType,
                recentMessages,
              }),
            },
          ],
        },
      });

      const message = result?.choices?.[0]?.message?.content?.trim() || '';

      if (isProviderErrorMessage(message)) {
        throw new Error(`gateway returned provider error text: ${message}`);
      }

      const shouldSend = Boolean(message) && message !== 'NO_REPLY';

      return {
        ok: true,
        shouldSend,
        message: shouldSend ? message : '',
      };
    } catch (err) {
      console.error('[gateway-manager] followups/generate error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });

  api.get('/skills/installed', async () => {
    return {
      skills: listInstalledSkills(),
      runtime: getSkillsRuntimeInfo(),
    };
  });

  api.get('/skills/bundled', async () => {
    return {
      skills: listBundledSkills(),
      runtime: getSkillsRuntimeInfo(),
    };
  });

  api.post('/skills/install', async (req, reply) => {
    const { slug, version, force } = req.body || {};

    try {
      const skill = await installSkillFromClawHub({ slug, version, force: Boolean(force) });
      return { ok: true, skill };
    } catch (err) {
      const statusCode = err?.statusCode || 500;
      return reply.code(statusCode).send({ error: err.message });
    }
  });

  api.post('/skills/install-bundled', async (req, reply) => {
    const { slug, force } = req.body || {};

    try {
      const skill = installBundledSkill({ slug, force: Boolean(force) });
      return { ok: true, skill };
    } catch (err) {
      const statusCode = err?.statusCode || 500;
      return reply.code(statusCode).send({ error: err.message });
    }
  });

  api.delete('/skills/:slug', async (req, reply) => {
    const { slug } = req.params || {};

    try {
      const skill = uninstallInstalledSkill(slug);
      return { ok: true, skill };
    } catch (err) {
      const statusCode = err?.statusCode || 500;
      return reply.code(statusCode).send({ error: err.message });
    }
  });

  await api.listen({ port: ADAPTER_PORT, host: '0.0.0.0' });
  console.log(`[gateway-manager] Adapter API listening on port ${ADAPTER_PORT}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('[gateway-manager] myagentclaw openclaw adapter starting...');
  try {
    setup();
    await startAdapterApi();
  } catch (err) {
    console.error('[gateway-manager] Fatal error:', err);
    process.exit(1);
  }
}

main();

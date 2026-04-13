import http from 'node:http';

import prisma from './prisma.js';

const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const DOCKER_API_VERSION = process.env.DOCKER_API_VERSION || 'v1.41';
const SHARED_ADAPTER_URL = process.env.OPENCLAW_ADAPTER_URL || process.env.OPENCLAW_BASE_URL || 'http://openclaw-adapter:4000';
const SHARED_OPENCLAW_CONTAINER = process.env.MYAGENTCLAW_SHARED_OPENCLAW_CONTAINER || 'myagentclaw_openclaw';
const SHARED_ADAPTER_CONTAINER = process.env.MYAGENTCLAW_SHARED_ADAPTER_CONTAINER || 'myagentclaw_openclaw_adapter';
const DEFAULT_OPENCLAW_IMAGE = process.env.MYAGENTCLAW_OPENCLAW_RUNTIME_IMAGE || '';
const DEFAULT_ADAPTER_IMAGE = process.env.MYAGENTCLAW_ADAPTER_RUNTIME_IMAGE || '';
const DEFAULT_LLM_MODEL = process.env.DEFAULT_LLM_MODEL || 'openai-codex/gpt-5.4';
const DEDICATED_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.INTERNAL_SECRET_KEY || 'myagentclaw-dedicated-gateway-token';
const BOOTSTRAP_OPENCLAW_HOME = '/home/node/.openclaw-bootstrap';
const OPENCLAW_RUNTIME_WORKDIR = process.env.MYAGENTCLAW_OPENCLAW_RUNTIME_WORKDIR || '/app';

const runtimeImageCache = new Map();
let networkNamePromise = null;
let sharedStateVolumeNamePromise = null;
const runtimeWhatsAppInstallPromises = new Map();

function sanitizeRuntimeSlug(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return (normalized || 'runtime').slice(0, 24);
}

function isDedicatedTier(subTier) {
  return ['STARTER', 'GROWTH', 'PRO'].includes(String(subTier || 'FREE').toUpperCase());
}

function buildRuntimeNames(ownerId) {
  const slug = sanitizeRuntimeSlug(ownerId);
  return {
    slug,
    openclawContainerName: `myagentclaw_openclaw_owner_${slug}`,
    adapterContainerName: `myagentclaw_openclaw_adapter_owner_${slug}`,
    volumeName: `myagentclaw_openclaw_data_owner_${slug}`,
  };
}

function requestDocker(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: DOCKER_SOCKET_PATH,
      path: `/${DOCKER_API_VERSION}${path}`,
      method,
      timeout: 30000,
      headers: body
        ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        }
        : undefined,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = raw;
          }
        }
        resolve({ statusCode: res.statusCode || 0, data, raw });
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Docker API ${method} ${path} timed out`));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestDockerText(method, path, body, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: DOCKER_SOCKET_PATH,
      path: `/${DOCKER_API_VERSION}${path}`,
      method,
      timeout: timeoutMs,
      headers: body
        ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        }
        : undefined,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, raw }));
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Docker API ${method} ${path} timed out`));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function dockerJson(method, path, payload, expected = [200, 201, 204]) {
  const body = payload ? JSON.stringify(payload) : undefined;
  const result = await requestDocker(method, path, body);
  if (!expected.includes(result.statusCode)) {
    const details = typeof result.data === 'string'
      ? result.data
      : result.data?.message || result.raw || `Docker API ${method} ${path} failed`;
    throw new Error(details);
  }
  return result.data;
}

async function inspectContainer(name) {
  const result = await requestDocker('GET', `/containers/${encodeURIComponent(name)}/json`);
  if (result.statusCode === 404) return null;
  if (result.statusCode !== 200) {
    throw new Error(result.data?.message || result.raw || `Failed to inspect container ${name}`);
  }
  return result.data;
}

async function ensureVolume(name, labels = {}) {
  return dockerJson('POST', '/volumes/create', { Name: name, Labels: labels }, [201]);
}

async function removeContainer(name) {
  const result = await requestDocker('DELETE', `/containers/${encodeURIComponent(name)}?force=true`);
  if (![204, 404].includes(result.statusCode)) {
    throw new Error(result.data?.message || result.raw || `Failed to remove container ${name}`);
  }
}

async function startContainer(name) {
  const result = await requestDocker('POST', `/containers/${encodeURIComponent(name)}/start`);
  if (![204, 304].includes(result.statusCode)) {
    throw new Error(result.data?.message || result.raw || `Failed to start container ${name}`);
  }
}

async function execInContainer(containerName, command, options = {}) {
  const createResult = await dockerJson('POST', `/containers/${encodeURIComponent(containerName)}/exec`, {
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    WorkingDir: options.workingDir || OPENCLAW_RUNTIME_WORKDIR,
    Cmd: command,
    Env: options.env,
  }, [201]);

  const execId = createResult?.Id;
  if (!execId) {
    throw new Error(`Gagal membuat docker exec untuk container ${containerName}`);
  }

  const startBody = JSON.stringify({ Detach: false, Tty: true });
  const started = await requestDockerText(
    'POST',
    `/exec/${encodeURIComponent(execId)}/start`,
    startBody,
    options.timeoutMs || 30000,
  );

  if (started.statusCode !== 200) {
    throw new Error(started.raw || `Gagal menjalankan command di container ${containerName}`);
  }

  const inspect = await dockerJson('GET', `/exec/${encodeURIComponent(execId)}/json`, undefined, [200]);
  return {
    exitCode: typeof inspect?.ExitCode === 'number' ? inspect.ExitCode : null,
    output: started.raw,
  };
}

function parseGatewayCallOutput(output, method) {
  const trimmed = String(output || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`Output gateway call ${method} tidak valid JSON: ${trimmed}`);
  }
}

function envValue(name, fallback = '') {
  return `${name}=${process.env[name] || fallback}`;
}

function envLiteral(name, value) {
  return `${name}=${value}`;
}

function envIncludes(envList = [], entry) {
  return envList.some((value) => value === entry);
}

function containerNeedsRecreate(containerInfo, expected) {
  if (!containerInfo) return false;
  if (expected.image && containerInfo.Config?.Image !== expected.image) {
    return true;
  }
  if (expected.imageId && containerInfo.Image !== expected.imageId) {
    return true;
  }

  const labels = containerInfo.Config?.Labels || {};
  for (const [key, value] of Object.entries(expected.labels || {})) {
    if (labels[key] !== value) return true;
  }

  const envList = containerInfo.Config?.Env || [];
  for (const entry of expected.env || []) {
    if (!envIncludes(envList, entry)) return true;
  }

  return false;
}

async function detectBackendNetworkName() {
  if (!networkNamePromise) {
    networkNamePromise = (async () => {
      if (process.env.MYAGENTCLAW_RUNTIME_NETWORK) {
        return process.env.MYAGENTCLAW_RUNTIME_NETWORK;
      }

      const containerId = process.env.HOSTNAME || '';
      if (!containerId) {
        throw new Error('HOSTNAME container id tidak tersedia untuk deteksi network Docker');
      }

      const info = await inspectContainer(containerId);
      const networkName = Object.keys(info?.NetworkSettings?.Networks || {})[0];
      if (!networkName) {
        throw new Error('Tidak dapat mendeteksi network backend container');
      }
      return networkName;
    })();
  }

  return networkNamePromise;
}

async function resolveImageFromContainer(containerName, fallbackEnvValue, cacheKey) {
  if (runtimeImageCache.has(cacheKey)) return runtimeImageCache.get(cacheKey);

  const info = await inspectContainer(containerName).catch(() => null);
  const imageReference = fallbackEnvValue || info?.Config?.Image;
  const imageId = info?.Image || null;
  if (!imageReference) {
    throw new Error(`Tidak dapat membaca image dari container ${containerName}`);
  }

  const imageSpec = {
    reference: imageReference,
    imageId,
  };

  runtimeImageCache.set(cacheKey, imageSpec);
  return imageSpec;
}

async function resolveSharedStateVolumeName() {
  if (!sharedStateVolumeNamePromise) {
    sharedStateVolumeNamePromise = (async () => {
      const info = await inspectContainer(SHARED_OPENCLAW_CONTAINER);
      const mount = (info?.Mounts || []).find((entry) => entry?.Destination === '/home/node/.openclaw' && entry?.Type === 'volume');

      if (!mount?.Name) {
        throw new Error(`Tidak dapat membaca volume state dari container ${SHARED_OPENCLAW_CONTAINER}`);
      }

      return mount.Name;
    })();
  }

  return sharedStateVolumeNamePromise;
}

function getDedicatedAdapterUrl(ownerId) {
  return `http://${buildRuntimeNames(ownerId).adapterContainerName}:4000`;
}

function getDedicatedOpenclawUrl(ownerId) {
  return `http://${buildRuntimeNames(ownerId).openclawContainerName}:18789`;
}

async function waitForHttpHealth(url, label, attempts = 20, delayMs = 1500, path = '/health') {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${url}${path}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        return true;
      }
    } catch {
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`${label} ${url} belum sehat setelah ${attempts} percobaan`);
}

async function waitForAdapterHealth(adapterUrl, attempts = 20, delayMs = 1500) {
  return waitForHttpHealth(adapterUrl, 'Dedicated adapter', attempts, delayMs);
}

async function waitForOpenclawHealth(openclawUrl, attempts = 120, delayMs = 1500) {
  return waitForHttpHealth(openclawUrl, 'Dedicated openclaw gateway', attempts, delayMs, '/healthz');
}

async function ensureContainerRunning({
  name,
  image,
  imageId,
  env,
  labels,
  volumeName,
  networkName,
  cmd,
  extraBinds = [],
  forceRecreate = false,
}) {
  const existing = await inspectContainer(name);

  if (existing && (forceRecreate || containerNeedsRecreate(existing, { image, imageId, env, labels }))) {
    console.log(`[runtime-manager] Recreating container ${name}${forceRecreate ? ' (forced)' : ' due to image/env drift'}`);
    await removeContainer(name);
  }

  const current = await inspectContainer(name);
  if (!current) {
    await dockerJson('POST', `/containers/create?name=${encodeURIComponent(name)}`, {
      Image: image,
      Env: env,
      Labels: labels,
      Cmd: cmd,
      HostConfig: {
        Binds: [`${volumeName}:/home/node/.openclaw`, ...extraBinds],
        NetworkMode: networkName,
        RestartPolicy: { Name: 'unless-stopped' },
      },
    }, [201]);
  }

  await startContainer(name);
}

async function ensureDockerSocketAvailable() {
  const result = await requestDocker('GET', '/_ping');
  if (result.statusCode !== 200 || String(result.raw || '').trim() !== 'OK') {
    throw new Error('Docker Engine API tidak tersedia. Pastikan backend mendapat mount /var/run/docker.sock');
  }
}

export async function ensureWorkspaceRuntime(workspace, options = {}) {
  if (!workspace) {
    throw new Error('Workspace diperlukan untuk resolve runtime');
  }

  const forceRecreateAdapter = options.forceRecreateAdapter === true;
  const forceRecreateOpenclaw = options.forceRecreateOpenclaw === true;

  if (!isDedicatedTier(workspace.subTier)) {
    return {
      mode: 'SHARED',
      tier: 'FREE',
      adapterUrl: SHARED_ADAPTER_URL,
      openclawContainerName: SHARED_OPENCLAW_CONTAINER,
      adapterContainerName: SHARED_ADAPTER_CONTAINER,
      ownerId: workspace.ownerId || '',
    };
  }

  await ensureDockerSocketAvailable();

  const names = buildRuntimeNames(workspace.ownerId);
  const networkName = await detectBackendNetworkName();
  const sharedStateVolumeName = await resolveSharedStateVolumeName();
  const bootstrapBind = `${sharedStateVolumeName}:${BOOTSTRAP_OPENCLAW_HOME}:ro`;
  const openclawImage = await resolveImageFromContainer(
    SHARED_OPENCLAW_CONTAINER,
    DEFAULT_OPENCLAW_IMAGE,
    'openclaw-image',
  );
  const adapterImage = await resolveImageFromContainer(
    SHARED_ADAPTER_CONTAINER,
    DEFAULT_ADAPTER_IMAGE,
    'adapter-image',
  );

  await ensureVolume(names.volumeName, {
    'myagentclaw.runtime.mode': 'dedicated',
    'myagentclaw.owner.id': workspace.ownerId,
    'myagentclaw.tier': workspace.subTier,
  });

  await ensureContainerRunning({
    name: names.adapterContainerName,
    image: adapterImage.reference,
    imageId: adapterImage.imageId,
    networkName,
    volumeName: names.volumeName,
    labels: {
      'myagentclaw.runtime.mode': 'dedicated',
      'myagentclaw.owner.id': workspace.ownerId,
      'myagentclaw.tier': workspace.subTier,
      'myagentclaw.service': 'adapter',
    },
    env: [
      envLiteral('HOME', '/home/node'),
      envLiteral('OPENCLAW_HOME', '/home/node/.openclaw'),
      envLiteral('OPENCLAW_BOOTSTRAP_HOME', BOOTSTRAP_OPENCLAW_HOME),
      `OPENCLAW_GATEWAY_URL=http://${names.openclawContainerName}:18789`,
      `OPENCLAW_GATEWAY_TOKEN=${DEDICATED_GATEWAY_TOKEN}`,
      envValue('OPENAI_API_KEY'),
      envValue('ANTHROPIC_API_KEY'),
      envValue('ADAPTER_PORT', '4000'),
      envValue('OPENCLAW_GATEWAY_PORT', '18789'),
      envValue('INTERNAL_SECRET_KEY'),
      envValue('BACKEND_INTERNAL_URL', 'http://backend:3001'),
      `DEFAULT_LLM_MODEL=${DEFAULT_LLM_MODEL}`,
      `MYAGENTCLAW_RUNTIME_TIER=${workspace.subTier}`,
      'MYAGENTCLAW_RUNTIME_MODE=DEDICATED',
      'MYAGENTCLAW_ENABLE_SHARED_WORKSPACE=1',
    ],
    extraBinds: [bootstrapBind],
    forceRecreate: forceRecreateAdapter,
  });

  const adapterUrl = getDedicatedAdapterUrl(workspace.ownerId);
  await waitForAdapterHealth(adapterUrl);

  await ensureContainerRunning({
    name: names.openclawContainerName,
    image: openclawImage.reference,
    imageId: openclawImage.imageId,
    networkName,
    volumeName: names.volumeName,
    labels: {
      'myagentclaw.runtime.mode': 'dedicated',
      'myagentclaw.owner.id': workspace.ownerId,
      'myagentclaw.tier': workspace.subTier,
      'myagentclaw.service': 'openclaw',
    },
    env: [
      envLiteral('HOME', '/home/node'),
      envValue('NODE_ENV', 'production'),
      envValue('OPENCLAW_GATEWAY_PORT', '18789'),
      envLiteral('OPENCLAW_GATEWAY_TOKEN', DEDICATED_GATEWAY_TOKEN),
      envValue('OPENAI_API_KEY'),
      envValue('ANTHROPIC_API_KEY'),
      envValue('INTERNAL_SECRET_KEY'),
      envValue('BACKEND_INTERNAL_URL', 'http://backend:3001'),
    ],
    cmd: ['node', 'dist/index.js', 'gateway', '--bind', 'lan', '--port', '18789', '--allow-unconfigured'],
    extraBinds: [bootstrapBind],
    forceRecreate: forceRecreateOpenclaw,
  });

  const openclawUrl = getDedicatedOpenclawUrl(workspace.ownerId);
  await waitForOpenclawHealth(openclawUrl);

  return {
    mode: 'DEDICATED',
    tier: workspace.subTier,
    ownerId: workspace.ownerId,
    adapterUrl,
    ...names,
  };
}

export async function resolveWorkspaceRuntimeById(workspaceId) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, ownerId: true, subTier: true, name: true },
  });

  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} tidak ditemukan`);
  }

  return ensureWorkspaceRuntime(workspace);
}

export async function resolveAgentRuntime(agentId) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { workspace: { select: { id: true, ownerId: true, subTier: true, name: true } } },
  });

  if (!agent?.workspace) {
    throw new Error(`Agent ${agentId} tidak ditemukan atau workspace hilang`);
  }

  const runtime = await ensureWorkspaceRuntime(agent.workspace);
  return { ...runtime, workspace: agent.workspace, agentId: agent.id };
}

export async function resolveChannelRuntime(channelId) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      workspace: { select: { id: true, ownerId: true, subTier: true, name: true } },
      agent: { select: { id: true } },
    },
  });

  if (!channel?.workspace) {
    throw new Error(`Channel ${channelId} tidak ditemukan atau workspace hilang`);
  }

  const runtime = await ensureWorkspaceRuntime(channel.workspace);
  return { ...runtime, workspace: channel.workspace, channelId: channel.id, agentId: channel.agentId || channel.agent?.id || '' };
}

export function listCandidateAdapterUrls(workspace) {
  const urls = new Set([SHARED_ADAPTER_URL]);
  if (workspace?.ownerId) {
    urls.add(getDedicatedAdapterUrl(workspace.ownerId));
  }
  return [...urls];
}

export function getSharedAdapterUrl() {
  return SHARED_ADAPTER_URL;
}

export function workspaceHasPaidSharedWorkspace(workspace) {
  return isDedicatedTier(workspace?.subTier);
}

async function readRuntimeWhatsAppPluginState(containerName) {
  const probeScript = [
    "const fs = require('fs');",
    "const configPath = '/home/node/.openclaw/openclaw.json';",
    'let config = {};',
    "try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}",
    "const record = config?.plugins?.installs?.whatsapp || config?.plugins?.installs?.['@openclaw/whatsapp'] || null;",
    "console.log(JSON.stringify({ installed: Boolean(record?.installPath), installPath: record?.installPath || null }));",
  ].join(' ');

  const result = await execInContainer(containerName, ['node', '-e', probeScript], {
    timeoutMs: 15000,
  });

  if (result.exitCode && result.exitCode !== 0) {
    throw new Error(result.output || `Gagal membaca status plugin WhatsApp di container ${containerName}`);
  }

  return parseGatewayCallOutput(result.output, 'runtime whatsapp plugin state') || { installed: false, installPath: null };
}

async function repairRuntimeWhatsAppConfig(containerName) {
  const repairScript = [
    "const fs = require('fs');",
    "const configPath = '/home/node/.openclaw/openclaw.json';",
    'let config = {};',
    "try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch { process.exit(0); }",
    'let changed = false;',
    "const validPolicies = new Set(['open', 'allowlist', 'disabled']);",
    'if (config?.channels?.whatsapp && !validPolicies.has(config.channels.whatsapp.groupPolicy)) {',
    "  config.channels.whatsapp.groupPolicy = 'disabled';",
    '  changed = true;',
    '}',
    'if (changed) {',
    "  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\\n');",
    '}',
    'console.log(JSON.stringify({ changed }));',
  ].join(' ');

  const result = await execInContainer(containerName, ['node', '-e', repairScript], {
    timeoutMs: 15000,
  });

  if (result.exitCode && result.exitCode !== 0) {
    throw new Error(result.output || `Gagal memperbaiki config WhatsApp di container ${containerName}`);
  }

  return parseGatewayCallOutput(result.output, 'runtime whatsapp config repair') || { changed: false };
}

export async function ensureRuntimeWhatsAppPluginInstalled(runtime) {
  await ensureDockerSocketAvailable();

  const containerName = runtime?.openclawContainerName || SHARED_OPENCLAW_CONTAINER;
  const cached = runtimeWhatsAppInstallPromises.get(containerName);
  if (cached) {
    return cached;
  }

  const installationPromise = (async () => {
    await repairRuntimeWhatsAppConfig(containerName).catch(() => ({ changed: false }));

    const state = await readRuntimeWhatsAppPluginState(containerName).catch(() => ({ installed: false, installPath: null }));
    if (state?.installed) {
      return state;
    }

    const installResult = await execInContainer(
      containerName,
      ['node', 'dist/index.js', 'plugins', 'install', '@openclaw/whatsapp'],
      {
        timeoutMs: 300000,
      },
    );

    if (installResult.exitCode && installResult.exitCode !== 0) {
      throw new Error(installResult.output || 'Install plugin WhatsApp gagal');
    }

    const finalState = await readRuntimeWhatsAppPluginState(containerName);
    if (!finalState?.installed) {
      throw new Error('Plugin WhatsApp selesai diinstall tetapi installPath belum tercatat di runtime');
    }

    return finalState;
  })();

  runtimeWhatsAppInstallPromises.set(containerName, installationPromise);

  try {
    return await installationPromise;
  } catch (error) {
    runtimeWhatsAppInstallPromises.delete(containerName);
    throw error;
  }
}

export async function execRuntimeGatewayCall(runtime, method, params = {}, options = {}) {
  await ensureDockerSocketAvailable();

  const containerName = runtime?.openclawContainerName || SHARED_OPENCLAW_CONTAINER;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000));
  const command = [
    'node',
    'dist/index.js',
    'gateway',
    'call',
    String(method),
    '--params',
    JSON.stringify(params || {}),
    '--json',
    '--timeout',
    String(timeoutMs),
  ];

  const result = await execInContainer(containerName, command, {
    timeoutMs: timeoutMs + 5000,
  });

  if (result.exitCode && result.exitCode !== 0) {
    throw new Error(result.output || `Gateway call ${method} gagal dengan exit code ${result.exitCode}`);
  }

  return parseGatewayCallOutput(result.output, method);
}

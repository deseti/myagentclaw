const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_OPENAI_COMPATIBLE_MODEL = 'qwen/qwen3-32b';
const DEFAULT_OPENAI_COMPATIBLE_TEMPERATURE = 0.4;
const DEFAULT_OPENAI_COMPATIBLE_TOP_P = 0.95;
const DEFAULT_OPENAI_COMPATIBLE_MAX_TOKENS = 200;
const DEFAULT_OPENAI_COMPATIBLE_STREAM = true;
const DEFAULT_OPENAI_COMPATIBLE_REASONING = 'none';
const DEFAULT_OPENAI_PROVIDER_ID = 'openai';
const DEFAULT_OPENAI_CODEX_PROVIDER_ID = 'openai-codex';
const DEFAULT_OPENAI_CODEX_MODEL = `${DEFAULT_OPENAI_CODEX_PROVIDER_ID}/gpt-5.4`;
const SUPPORTED_OPENCLAW_MODEL_PROVIDERS = new Set([
  DEFAULT_OPENAI_PROVIDER_ID,
  DEFAULT_OPENAI_CODEX_PROVIDER_ID,
]);

const LEGACY_OPENAI_COMPATIBLE_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const LEGACY_OPENAI_COMPATIBLE_MODEL = 'minimaxai/minimax-m2.7';
const LEGACY_OPENAI_COMPATIBLE_IMAGE_MODEL = 'meta/llama-3.2-11b-vision-instruct';

export const AI_PROVIDER_DB_VALUE = DEFAULT_OPENAI_CODEX_PROVIDER_ID;

function parseExplicitModelRef(model) {
  const trimmed = String(model || '').trim();
  if (!trimmed) return null;

  for (const provider of SUPPORTED_OPENCLAW_MODEL_PROVIDERS) {
    const prefix = `${provider}/`;
    if (trimmed.toLowerCase().startsWith(prefix)) {
      const modelId = trimmed.slice(prefix.length).trim();
      if (!modelId) return null;
      return {
        provider,
        modelId,
        ref: `${provider}/${modelId}`,
      };
    }
  }

  return null;
}

function normalizeConfiguredModelRef(model, fallbackRef = DEFAULT_OPENAI_CODEX_MODEL) {
  const explicit = parseExplicitModelRef(model);
  if (explicit) {
    return explicit.ref;
  }

  const trimmed = String(model || '').trim();
  if (!trimmed) {
    return fallbackRef;
  }

  return `${DEFAULT_OPENAI_PROVIDER_ID}/${trimmed}`;
}

function parseOptionalNumber(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return undefined;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function parseOptionalReasoning(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized || undefined;
}

function resolveImageModel({ rawImageModel, resolvedModelId, resolvedBaseURL }) {
  if (rawImageModel) {
    return {
      imageModel: rawImageModel,
      usesImageModelFallback: false,
      usesVisionPresetFallback: false,
    };
  }

  const usesVisionPresetFallback =
    resolvedBaseURL === LEGACY_OPENAI_COMPATIBLE_BASE_URL
    && resolvedModelId === LEGACY_OPENAI_COMPATIBLE_MODEL;

  return {
    imageModel: usesVisionPresetFallback ? LEGACY_OPENAI_COMPATIBLE_IMAGE_MODEL : undefined,
    usesImageModelFallback: usesVisionPresetFallback,
    usesVisionPresetFallback,
  };
}

export function getAiProviderConfig(env = process.env) {
  const apiKey = String(env.OPENAI_API_KEY || '').trim();
  const oauthToken = String(env.OPENAI_OAUTH_TOKEN || '').trim();
  const rawBaseURL = String(env.OPENAI_BASE_URL || '').trim();
  const rawModel = String(env.OPENAI_MODEL || '').trim();
  const rawImageModel = String(env.OPENAI_IMAGE_MODEL || '').trim();
  const temperature = parseOptionalNumber(env.OPENAI_TEMPERATURE);
  const topP = parseOptionalNumber(env.OPENAI_TOP_P);
  const maxTokens = parseOptionalNumber(env.OPENAI_MAX_TOKENS);
  const stream = parseOptionalBoolean(env.OPENAI_STREAM);
  const reasoning = parseOptionalReasoning(env.OPENAI_REASONING);
  const resolvedModel = normalizeConfiguredModelRef(rawModel, DEFAULT_OPENAI_CODEX_MODEL);
  const resolvedProvider = getOptionalOpenClawProviderId(resolvedModel) || DEFAULT_OPENAI_CODEX_PROVIDER_ID;
  const resolvedModelId = getOpenClawModelId(resolvedModel);
  const resolvedBaseURL = resolvedProvider === DEFAULT_OPENAI_PROVIDER_ID
    ? (rawBaseURL || DEFAULT_OPENAI_COMPATIBLE_BASE_URL)
    : rawBaseURL;
  const usesCodexProvider = resolvedProvider === DEFAULT_OPENAI_CODEX_PROVIDER_ID;
  const imageModelResolution = resolveImageModel({
    rawImageModel,
    resolvedModelId,
    resolvedBaseURL,
  });

  return {
    apiKey,
    oauthToken,
    baseURL: resolvedBaseURL,
    provider: resolvedProvider,
    model: resolvedModel,
    imageModel: imageModelResolution.imageModel,
    temperature: temperature ?? (usesCodexProvider ? undefined : DEFAULT_OPENAI_COMPATIBLE_TEMPERATURE),
    topP: topP ?? (usesCodexProvider ? undefined : DEFAULT_OPENAI_COMPATIBLE_TOP_P),
    maxTokens: maxTokens ?? (usesCodexProvider ? undefined : DEFAULT_OPENAI_COMPATIBLE_MAX_TOKENS),
    stream: stream ?? DEFAULT_OPENAI_COMPATIBLE_STREAM,
    reasoning: reasoning ?? DEFAULT_OPENAI_COMPATIBLE_REASONING,
    hasApiKey: Boolean(apiKey),
    hasOAuthToken: Boolean(oauthToken),
    hasImageModel: Boolean(imageModelResolution.imageModel),
    usesBaseURLFallback: resolvedProvider === DEFAULT_OPENAI_PROVIDER_ID && !rawBaseURL,
    usesModelFallback: !rawModel,
    usesImageModelFallback: imageModelResolution.usesImageModelFallback,
    usesVisionPresetFallback: imageModelResolution.usesVisionPresetFallback,
  };
}

export const aiProviderConfig = getAiProviderConfig();

export function getOptionalOpenClawProviderId(model) {
  return parseExplicitModelRef(model)?.provider;
}

export function getOpenClawProviderId(model = getAiProviderConfig().model) {
  return getOptionalOpenClawProviderId(model) || DEFAULT_OPENAI_PROVIDER_ID;
}

export function getOptionalOpenClawModelId(model) {
  const explicit = parseExplicitModelRef(model);
  if (explicit) {
    return explicit.modelId;
  }

  const trimmed = String(model || '').trim();
  return trimmed || undefined;
}

export function getOpenClawModelId(model = getAiProviderConfig().model) {
  return getOptionalOpenClawModelId(model) || getOptionalOpenClawModelId(DEFAULT_OPENAI_CODEX_MODEL);
}

export function getOptionalOpenClawModelRef(model) {
  const trimmed = String(model || '').trim();
  if (!trimmed) return undefined;
  return normalizeConfiguredModelRef(trimmed);
}

export function getOpenClawModelRef(model = getAiProviderConfig().model) {
  return normalizeConfiguredModelRef(model, DEFAULT_OPENAI_CODEX_MODEL);
}

export function validateAiProviderConfig(logger = console) {
  const config = getAiProviderConfig();
  const warn = typeof logger?.warn === 'function' ? logger.warn.bind(logger) : console.warn.bind(console);
  const info = typeof logger?.info === 'function'
    ? logger.info.bind(logger)
    : (typeof logger?.log === 'function' ? logger.log.bind(logger) : console.log.bind(console));

  if (config.provider === DEFAULT_OPENAI_CODEX_PROVIDER_ID) {
    if (!config.hasOAuthToken) {
      warn('[AI Provider] OPENAI_OAUTH_TOKEN is empty; runtime must rely on persisted OpenClaw auth profiles for openai-codex');
    }
  } else if (!config.hasApiKey) {
    warn('[AI Provider] OPENAI_API_KEY is empty');
  }

  if (config.usesBaseURLFallback) {
    warn(`[AI Provider] OPENAI_BASE_URL is empty, falling back to ${config.baseURL}`);
  }

  if (config.usesModelFallback) {
    warn(`[AI Provider] OPENAI_MODEL is empty, falling back to ${config.model}`);
  }

  if (config.usesImageModelFallback) {
    const message = config.usesVisionPresetFallback
      ? `[AI Provider] OPENAI_IMAGE_MODEL is empty, falling back to ${config.imageModel} for image inputs`
      : `[AI Provider] OPENAI_IMAGE_MODEL is empty, reusing ${config.imageModel} for image inputs`;
    warn(message);
  }

  info({
    provider: config.provider,
    baseURL: config.baseURL,
    model: config.model,
    imageModel: config.imageModel,
    temperature: config.temperature,
    topP: config.topP,
    maxTokens: config.maxTokens,
    stream: config.stream,
    reasoning: config.reasoning,
    authMode: config.provider === DEFAULT_OPENAI_CODEX_PROVIDER_ID
      ? (config.hasOAuthToken ? 'oauth-env' : 'managed-profile')
      : (config.hasApiKey ? 'api-key-env' : 'managed-profile'),
  }, '[AI Provider]');

  return config;
}
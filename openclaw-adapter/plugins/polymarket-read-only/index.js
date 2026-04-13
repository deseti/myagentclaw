import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || 'http://backend:3001';
const INTERNAL_KEY = process.env.INTERNAL_SECRET_KEY || '';
const ACTIONS = ['markets', 'trending', 'market', 'orderbook', 'positions', 'tags'];

const toolSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ACTIONS,
      description: 'Read-only Polymarket action to perform.',
    },
    slug: {
      type: 'string',
      description: 'Market slug for action=market, or slug filter for action=markets.',
    },
    tokenId: {
      type: 'string',
      description: 'CLOB token id for action=orderbook.',
    },
    tagId: {
      type: 'number',
      description: 'Optional Polymarket tag id for action=markets.',
    },
    order: {
      type: 'string',
      enum: ['volume', 'volume_24hr', 'liquidity', 'created_at', 'updated_at', 'open_interest', 'liquidity_clob'],
      description: 'Optional Polymarket market sort field for action=markets or action=trending.',
    },
    limit: {
      type: 'number',
      description: 'Result limit. Markets: 1-100, positions: 1-500.',
      minimum: 1,
      maximum: 500,
    },
    offset: {
      type: 'number',
      description: 'Pagination offset for action=markets or action=positions.',
      minimum: 0,
    },
    sizeThreshold: {
      type: 'number',
      description: 'Optional size threshold for action=positions.',
      minimum: 0,
    },
  },
  required: ['action'],
};

function json(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function normalizeString(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

function normalizeInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const integer = Math.trunc(numeric);
  if (integer < min || integer > max) return undefined;
  return integer;
}

function normalizeNumber(value, { min = 0 } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min) return undefined;
  return numeric;
}

async function internalFetch(path, search = {}) {
  const url = new URL(path, `${BACKEND_URL}/`);

  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': INTERNAL_KEY,
    },
    signal: AbortSignal.timeout(15000),
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

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Polymarket internal request failed with status ${response.status}`);
  }

  return data;
}

async function executePolymarketReadOnlyTool(_toolCallId, rawParams, _signal, _onUpdate, context) {
  try {
    const agentId = normalizeString(context?.agentId);
    if (!agentId) {
      throw new Error('Polymarket tool membutuhkan context agentId dari runtime.');
    }

    const action = normalizeString(rawParams?.action).toLowerCase();
    if (!ACTIONS.includes(action)) {
      throw new Error(`Action tidak valid. Gunakan salah satu: ${ACTIONS.join(', ')}`);
    }

    switch (action) {
      case 'markets':
      case 'trending': {
        const requestedOrder = normalizeString(rawParams?.order);
        const slug = normalizeString(rawParams?.slug) || undefined;
        const isTrending = action === 'trending';
        const payload = await internalFetch(`/internal/polymarket/agents/${encodeURIComponent(agentId)}/markets`, {
          limit: normalizeInteger(rawParams?.limit, { min: 1, max: 100 }),
          offset: normalizeInteger(rawParams?.offset, { min: 0 }),
          slug,
          tag_id: normalizeInteger(rawParams?.tagId, { min: 1 }),
          active: 'true',
          closed: 'false',
          order: requestedOrder || (isTrending ? 'volume_24hr' : undefined),
          ascending: isTrending ? 'false' : undefined,
        });
        return json(payload);
      }

      case 'market': {
        const slug = normalizeString(rawParams?.slug);
        if (!slug) {
          throw new Error('slug diperlukan untuk action=market');
        }

        const payload = await internalFetch(`/internal/polymarket/agents/${encodeURIComponent(agentId)}/markets/slug/${encodeURIComponent(slug)}`);
        return json(payload);
      }

      case 'orderbook': {
        const tokenId = normalizeString(rawParams?.tokenId);
        if (!tokenId) {
          throw new Error('tokenId diperlukan untuk action=orderbook');
        }

        const payload = await internalFetch(`/internal/polymarket/agents/${encodeURIComponent(agentId)}/orderbook/${encodeURIComponent(tokenId)}`);
        return json(payload);
      }

      case 'positions': {
        const payload = await internalFetch(`/internal/polymarket/agents/${encodeURIComponent(agentId)}/positions`, {
          limit: normalizeInteger(rawParams?.limit, { min: 1, max: 500 }),
          offset: normalizeInteger(rawParams?.offset, { min: 0 }),
          sizeThreshold: normalizeNumber(rawParams?.sizeThreshold, { min: 0 }),
        });
        return json(payload);
      }

      case 'tags': {
        const payload = await internalFetch(`/internal/polymarket/agents/${encodeURIComponent(agentId)}/tags`);
        return json(payload);
      }

      default:
        throw new Error(`Action tidak didukung: ${action}`);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) });
  }
}

function createPolymarketReadOnlyTool(context) {
  return {
    name: 'polymarket_read_only',
    label: 'Polymarket Read-only',
    description: 'Read-only Polymarket live tool for trending markets, top volume scans, market detail by slug, orderbook, tags, and saved-address positions.',
    parameters: toolSchema,
    execute: async (toolCallId, params, signal, onUpdate) => executePolymarketReadOnlyTool(toolCallId, params, signal, onUpdate, context),
  };
}

export default definePluginEntry({
  id: 'polymarket-read-only',
  name: 'Polymarket Read-only',
  description: 'Expose read-only live Polymarket tools for trending markets, top volume scans, orderbook, and saved positions in myagentclaw agents.',
  register(api) {
    api.registerTool((context) => createPolymarketReadOnlyTool(context), {
      name: 'polymarket_read_only',
    });
  },
});
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || 'http://backend:3001';
const INTERNAL_KEY = process.env.INTERNAL_SECRET_KEY || '';
const ACTIONS = ['status', 'runs', 'decisions', 'trigger_run', 'trigger_dry_run'];

const toolSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ACTIONS,
      description: 'Autopilot action to perform.',
    },
    limit: {
      type: 'number',
      description: 'Optional result limit for runs or decisions.',
      minimum: 1,
      maximum: 100,
    },
    runId: {
      type: 'string',
      description: 'Optional run id for action=decisions.',
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

async function internalFetch(path, options = {}, search = {}) {
  const url = new URL(path, `${BACKEND_URL}/`);

  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-internal-key': INTERNAL_KEY,
      ...(options.headers || {}),
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
    throw new Error(data?.message || data?.error || `Polymarket autopilot internal request failed with status ${response.status}`);
  }

  return data;
}

async function executePolymarketGrowthAutopilotTool(_toolCallId, rawParams, _signal, _onUpdate, context) {
  try {
    const agentId = normalizeString(context?.agentId);
    if (!agentId) {
      throw new Error('Polymarket autopilot tool membutuhkan context agentId dari runtime.');
    }

    const action = normalizeString(rawParams?.action).toLowerCase();
    if (!ACTIONS.includes(action)) {
      throw new Error(`Action tidak valid. Gunakan salah satu: ${ACTIONS.join(', ')}`);
    }

    switch (action) {
      case 'status': {
        const payload = await internalFetch(`/internal/polymarket/autopilot/agents/${encodeURIComponent(agentId)}/status`);
        return json(payload);
      }

      case 'runs': {
        const payload = await internalFetch(
          `/internal/polymarket/autopilot/agents/${encodeURIComponent(agentId)}/runs`,
          {},
          { limit: normalizeInteger(rawParams?.limit, { min: 1, max: 100 }) },
        );
        return json(payload);
      }

      case 'decisions': {
        const payload = await internalFetch(
          `/internal/polymarket/autopilot/agents/${encodeURIComponent(agentId)}/decisions`,
          {},
          {
            limit: normalizeInteger(rawParams?.limit, { min: 1, max: 100 }),
            runId: normalizeString(rawParams?.runId) || undefined,
          },
        );
        return json(payload);
      }

      case 'trigger_run':
      case 'trigger_dry_run': {
        const payload = await internalFetch(`/internal/polymarket/autopilot/agents/${encodeURIComponent(agentId)}/run`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        return json(payload);
      }

      default:
        throw new Error(`Action tidak didukung: ${action}`);
    }
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) });
  }
}

function createPolymarketGrowthAutopilotTool(context) {
  return {
    name: 'polymarket_growth_autopilot',
    label: 'Polymarket Growth Autopilot',
    description: 'Growth-only Polymarket automatic trading autopilot status, history, and dry-run or live execution trigger tool, including checks for whether auto trading is active right now.',
    parameters: toolSchema,
    execute: async (toolCallId, params, signal, onUpdate) => executePolymarketGrowthAutopilotTool(toolCallId, params, signal, onUpdate, context),
  };
}

export default definePluginEntry({
  id: 'polymarket-growth-autopilot',
  name: 'Polymarket Growth Autopilot',
  description: 'Expose Growth Polymarket automatic trading autopilot status and execution trigger tools for myagentclaw agents, including whether live auto trading is already active.',
  register(api) {
    api.registerTool((context) => createPolymarketGrowthAutopilotTool(context), {
      name: 'polymarket_growth_autopilot',
    });
  },
});
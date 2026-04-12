const POLYMARKET_GAMMA_API_URL = (process.env.POLYMARKET_GAMMA_API_URL || 'https://gamma-api.polymarket.com').replace(/\/+$/, '');
const POLYMARKET_DATA_API_URL = (process.env.POLYMARKET_DATA_API_URL || 'https://data-api.polymarket.com').replace(/\/+$/, '');
const POLYMARKET_CLOB_API_URL = (process.env.POLYMARKET_CLOB_API_URL || 'https://clob.polymarket.com').replace(/\/+$/, '');
const POLYMARKET_REQUEST_TIMEOUT_MS = Math.max(5000, parseInt(process.env.POLYMARKET_REQUEST_TIMEOUT_MS || '15000', 10) || 15000);
const POLYMARKET_CACHE_TTL_MS = Math.max(1000, parseInt(process.env.POLYMARKET_CACHE_TTL_MS || '5000', 10) || 5000);
const LOCAL_ONLY_MARKET_ORDER_VALUES = new Set(['volume_24hr']);

const polymarketCache = new Map();

function readCache(key) {
  const entry = polymarketCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    polymarketCache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key, value) {
  polymarketCache.set(key, {
    value,
    expiresAt: Date.now() + POLYMARKET_CACHE_TTL_MS,
  });
}

async function polymarketRequest(baseUrl, path, search = {}) {
  const url = new URL(path, `${baseUrl}/`);

  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const cacheKey = url.toString();
  const cached = readCache(cacheKey);
  if (cached) return cached;

  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(POLYMARKET_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Polymarket ${path} -> ${response.status}: ${text}`);
  }

  const data = await response.json();
  writeCache(cacheKey, data);
  return data;
}

function toSortableNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Number.NEGATIVE_INFINITY;
}

function toSortableTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function resolveMarketSortValue(market, order) {
  switch (order) {
    case 'volume_24hr':
      return toSortableNumber(market?.volume24hr ?? market?.volume24hrClob ?? market?.volume);
    case 'volume':
      return toSortableNumber(market?.volume ?? market?.volumeClob ?? market?.volume1yrClob);
    case 'liquidity':
      return toSortableNumber(market?.liquidityNum ?? market?.liquidity ?? market?.liquidityClob);
    case 'liquidity_clob':
      return toSortableNumber(market?.liquidityClob ?? market?.liquidityNum ?? market?.liquidity);
    case 'open_interest':
      return toSortableNumber(market?.openInterest);
    case 'created_at':
      return toSortableTimestamp(market?.createdAt);
    case 'updated_at':
      return toSortableTimestamp(market?.updatedAt);
    default:
      return Number.NEGATIVE_INFINITY;
  }
}

function sortPolymarketMarkets(markets, { order, ascending } = {}) {
  if (!Array.isArray(markets) || !order) return markets;

  const direction = ascending ? 1 : -1;
  return [...markets].sort((left, right) => {
    const leftValue = resolveMarketSortValue(left, order);
    const rightValue = resolveMarketSortValue(right, order);
    if (leftValue === rightValue) return 0;
    return leftValue > rightValue ? direction : -direction;
  });
}

export async function listPolymarketMarkets(params = {}) {
  const { order, ascending, ...rest } = params;
  const requestParams = {
    ...rest,
    ...(order && !LOCAL_ONLY_MARKET_ORDER_VALUES.has(order) ? { order } : {}),
    ...(ascending !== undefined && !LOCAL_ONLY_MARKET_ORDER_VALUES.has(order) ? { ascending } : {}),
  };

  const markets = await polymarketRequest(POLYMARKET_GAMMA_API_URL, '/markets', requestParams);
  return sortPolymarketMarkets(markets, { order, ascending });
}

export async function getPolymarketMarketBySlug(slug) {
  return polymarketRequest(POLYMARKET_GAMMA_API_URL, `/markets/slug/${encodeURIComponent(slug)}`);
}

export async function listPolymarketTags() {
  return polymarketRequest(POLYMARKET_GAMMA_API_URL, '/tags');
}

export async function listPolymarketSports() {
  return polymarketRequest(POLYMARKET_GAMMA_API_URL, '/sports');
}

export async function getPolymarketOrderBook(tokenId) {
  return polymarketRequest(POLYMARKET_CLOB_API_URL, '/book', { token_id: tokenId });
}

export async function listPolymarketPositions(address, params = {}) {
  return polymarketRequest(POLYMARKET_DATA_API_URL, '/positions', {
    user: address,
    ...params,
  });
}

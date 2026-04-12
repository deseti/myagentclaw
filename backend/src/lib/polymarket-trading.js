import { AssetType, ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { Wallet } from 'ethers';
import { decryptSecret, encryptSecret } from './secretbox.js';
import { getPolymarketOrderBook } from './polymarket-client.js';

const POLYMARKET_CLOB_API_URL = (process.env.POLYMARKET_CLOB_API_URL || 'https://clob.polymarket.com').replace(/\/+$/, '');
const POLYMARKET_CHAIN_ID = Math.max(1, parseInt(process.env.POLYMARKET_CHAIN_ID || '137', 10) || 137);
const PRIVATE_KEY_REGEX = /^(0x)?[a-fA-F0-9]{64}$/;
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const LIMIT_ORDER_TYPES = new Set(['GTC', 'GTD']);
const MARKET_ORDER_TYPES = new Set(['FOK', 'FAK']);
const POLYMARKET_AMOUNT_DECIMALS = 6;

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatRawAmount(value, decimals = POLYMARKET_AMOUNT_DECIMALS) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;

  const normalized = (numeric / (10 ** decimals)).toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return normalized || '0';
}

function extractNumericBookLevels(levels) {
  if (!Array.isArray(levels)) return [];

  return levels
    .map((level) => ({
      price: toFiniteNumber(level?.price),
      size: toFiniteNumber(level?.size),
    }))
    .filter((level) => level.price !== null && level.size !== null && level.size > 0);
}

function getBestBookPrice(levels, mode) {
  const numericLevels = extractNumericBookLevels(levels);
  if (!numericLevels.length) return null;

  return numericLevels.reduce((best, level) => {
    if (best === null) return level.price;
    return mode === 'min' ? Math.min(best, level.price) : Math.max(best, level.price);
  }, null);
}

function sumExecutableShares(levels, predicate) {
  return extractNumericBookLevels(levels)
    .filter((level) => predicate(level.price))
    .reduce((total, level) => total + level.size, 0);
}

function formatShareAmount(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  return numeric.toFixed(4).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function resolveRequiredShares(input, signedOrder) {
  if (input.orderKind === 'limit') {
    return toFiniteNumber(input.size);
  }

  if (input.side === 'BUY') {
    const takerAmount = toFiniteNumber(signedOrder?.takerAmount);
    return takerAmount === null ? null : takerAmount / (10 ** POLYMARKET_AMOUNT_DECIMALS);
  }

  return toFiniteNumber(input.amount);
}

function assertOrderbookConstraints(input, signedOrder, orderbook) {
  const minOrderSize = toFiniteNumber(orderbook?.min_order_size);

  if (input.orderKind === 'limit' && minOrderSize !== null && Number(input.size) < minOrderSize) {
    throw new Error(`Exchange menetapkan minimum size ${formatShareAmount(minOrderSize)} share untuk limit order pada market ini. Order limit di bawah batas itu akan ditolak.`);
  }

  if (input.orderKind !== 'market') {
    return;
  }

  if (input.side === 'BUY' && Number(input.amount) < 1) {
    throw new Error('Exchange menetapkan minimum amount 1 USDC untuk market BUY.');
  }

  const worstPrice = Number(input.price);
  const requiredShares = resolveRequiredShares(input, signedOrder);

  if (input.side === 'BUY') {
    const bestAsk = getBestBookPrice(orderbook?.asks, 'min');
    if (bestAsk === null) {
      throw new Error('Tidak ada ask aktif di orderbook saat ini, jadi market BUY tidak bisa dieksekusi.');
    }

    if (worstPrice < bestAsk) {
      throw new Error(`Worst price ${worstPrice} terlalu rendah. Best ask saat ini ${bestAsk}, jadi market BUY ${input.orderType} tidak bisa match.`);
    }

    const executableShares = sumExecutableShares(orderbook?.asks, (price) => price <= worstPrice);
    if (input.orderType === 'FOK' && requiredShares !== null && executableShares + 1e-9 < requiredShares) {
      throw new Error(`Likuiditas ask pada price <= ${worstPrice} hanya sekitar ${formatShareAmount(executableShares)} share, sementara order FOK membutuhkan sekitar ${formatShareAmount(requiredShares)} share penuh.`);
    }

    if (input.orderType === 'FAK' && executableShares <= 0) {
      throw new Error(`Tidak ada ask yang bisa di-match pada worst price ${worstPrice}. Best ask saat ini ${bestAsk}.`);
    }

    return;
  }

  const bestBid = getBestBookPrice(orderbook?.bids, 'max');
  if (bestBid === null) {
    throw new Error('Tidak ada bid aktif di orderbook saat ini, jadi market SELL tidak bisa dieksekusi.');
  }

  if (worstPrice > bestBid) {
    throw new Error(`Worst price ${worstPrice} terlalu tinggi. Best bid saat ini ${bestBid}, jadi market SELL ${input.orderType} tidak bisa match.`);
  }

  const executableShares = sumExecutableShares(orderbook?.bids, (price) => price >= worstPrice);
  if (input.orderType === 'FOK' && requiredShares !== null && executableShares + 1e-9 < requiredShares) {
    throw new Error(`Likuiditas bid pada price >= ${worstPrice} hanya sekitar ${formatShareAmount(executableShares)} share, sementara order FOK membutuhkan ${formatShareAmount(requiredShares)} share penuh.`);
  }

  if (input.orderType === 'FAK' && executableShares <= 0) {
    throw new Error(`Tidak ada bid yang bisa di-match pada worst price ${worstPrice}. Best bid saat ini ${bestBid}.`);
  }
}

async function assertSufficientTradingBalance(client, input, signedOrder) {
  const requiredRawAmount = toFiniteNumber(signedOrder?.makerAmount);
  if (!(requiredRawAmount > 0)) return;

  if (input.side === 'BUY') {
    const collateral = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const availableRawAmount = toFiniteNumber(collateral?.balance);

    if (availableRawAmount !== null && requiredRawAmount > availableRawAmount) {
      throw new Error(
        `Saldo collateral tidak cukup. Tersedia ${formatRawAmount(availableRawAmount)} USDC, dibutuhkan ${formatRawAmount(requiredRawAmount)} USDC untuk order ini. Untuk market BUY, amount adalah budget USDC yang dibelanjakan, bukan jumlah share.`,
      );
    }

    return;
  }

  const conditional = await client.getBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: input.tokenId });
  const availableRawAmount = toFiniteNumber(conditional?.balance);

  if (availableRawAmount !== null && requiredRawAmount > availableRawAmount) {
    throw new Error(
      `Saldo posisi tidak cukup. Tersedia ${formatRawAmount(availableRawAmount)} share, dibutuhkan ${formatRawAmount(requiredRawAmount)} share untuk order SELL ini. Untuk market SELL, amount adalah jumlah share yang dijual.`,
    );
  }
}

export function normalizePrivateKey(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  if (!PRIVATE_KEY_REGEX.test(normalized)) {
    throw new Error('Private key Polymarket tidak valid.');
  }
  return normalized.startsWith('0x') ? normalized : `0x${normalized}`;
}

export function normalizeOptionalSecret(value) {
  return normalizeString(value);
}

export function normalizeAddress(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const match = normalized.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : normalized;
}

function assertAddress(value, message) {
  if (!value || !ADDRESS_REGEX.test(value)) {
    throw new Error(message);
  }
}

export function serializeTradingCredentials(profile) {
  return {
    signerAddress: profile?.signerAddress || null,
    hasPrivateKey: Boolean(profile?.encryptedPrivateKey),
    hasApiCredentials: Boolean(profile?.encryptedApiKey && profile?.encryptedApiSecret && profile?.encryptedApiPassphrase),
    lastAuthenticatedAt: profile?.credentialsLastVerifiedAt ? profile.credentialsLastVerifiedAt.toISOString() : null,
    lastAuthError: profile?.credentialsLastError || null,
  };
}

export function validateTradingIdentity(profile, signerAddress) {
  const signatureType = Number.isInteger(profile?.signatureType) ? profile.signatureType : null;
  const normalizedFunderAddress = normalizeAddress(profile?.funderAddress);

  if (signatureType === null || ![0, 1, 2].includes(signatureType)) {
    throw new Error('Signature type Polymarket wajib dipilih sebelum menyiapkan credential trading.');
  }

  if (signatureType === 0) {
    if (normalizedFunderAddress && normalizedFunderAddress.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error('Untuk signature type 0 (EOA), funder address harus sama dengan signer address private key.');
    }

    return {
      signatureType,
      funderAddress: normalizedFunderAddress || signerAddress,
    };
  }

  assertAddress(
    normalizedFunderAddress,
    'Funder address wajib diisi dan valid untuk signature type proxy atau Gnosis Safe.',
  );

  return {
    signatureType,
    funderAddress: normalizedFunderAddress,
  };
}

function buildWallet(privateKey) {
  const normalizedPrivateKey = normalizePrivateKey(privateKey);
  return new Wallet(normalizedPrivateKey);
}

function buildClobSigner(privateKey) {
  const wallet = buildWallet(privateKey);

  return {
    address: wallet.address,
    getAddress() {
      return Promise.resolve(wallet.address);
    },
    _signTypedData(domain, types, value) {
      return wallet.signTypedData(domain, types, value);
    },
    signMessage(message) {
      return wallet.signMessage(message);
    },
  };
}

function buildStoredTradingClient(profile) {
  const privateKey = readStoredPrivateKey(profile);
  const credentials = readStoredApiCredentials(profile);

  if (!privateKey) {
    throw new Error('Private key Polymarket belum tersimpan.');
  }

  if (!credentials) {
    throw new Error('API credential Polymarket belum tersimpan.');
  }

  const wallet = buildWallet(privateKey);
  const signer = buildClobSigner(privateKey);
  const signerAddress = wallet.address;
  const { signatureType, funderAddress } = validateTradingIdentity(profile, signerAddress);
  const client = new ClobClient(
    POLYMARKET_CLOB_API_URL,
    POLYMARKET_CHAIN_ID,
    signer,
    credentials,
    signatureType,
    funderAddress,
  );

  return {
    client,
    signerAddress,
    signatureType,
    funderAddress,
  };
}

function normalizeOpenOrder(order) {
  return {
    id: order?.id || null,
    status: order?.status || null,
    owner: order?.owner || null,
    makerAddress: order?.maker_address || null,
    market: order?.market || null,
    assetId: order?.asset_id || null,
    side: order?.side || null,
    originalSize: order?.original_size || null,
    sizeMatched: order?.size_matched || null,
    price: order?.price || null,
    outcome: order?.outcome || null,
    orderType: order?.order_type || null,
    expiration: order?.expiration || null,
    createdAt: order?.created_at || null,
  };
}

function normalizeBookLevel(levels, type) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const first = levels[0];
  return {
    type,
    price: first?.price || null,
    size: first?.size || null,
  };
}

function assertSupportedOrderRequest(input) {
  if (input.orderKind === 'limit' && !LIMIT_ORDER_TYPES.has(input.orderType)) {
    throw new Error('Limit order hanya mendukung orderType GTC atau GTD.');
  }

  if (input.orderKind === 'market' && !MARKET_ORDER_TYPES.has(input.orderType)) {
    throw new Error('Market order hanya mendukung orderType FOK atau FAK.');
  }

  if (input.orderKind === 'limit' && (!(Number(input.size) > 0) || !(Number(input.price) > 0))) {
    throw new Error('Limit order membutuhkan price dan size yang valid.');
  }

  if (input.orderKind === 'market' && (!(Number(input.amount) > 0) || !(Number(input.price) > 0))) {
    throw new Error('Market order membutuhkan amount dan worst price yang valid.');
  }

  if (input.orderType === 'GTD' && !(Number(input.expiration) > 0)) {
    throw new Error('Order type GTD membutuhkan expiration timestamp UNIX.');
  }

  if (input.postOnly && input.orderKind !== 'limit') {
    throw new Error('Post-only hanya didukung untuk limit order.');
  }
}

function buildOrderSide(value) {
  return value === 'SELL' ? Side.SELL : Side.BUY;
}

function summarizeSignedOrder(signedOrder) {
  return {
    maker: signedOrder?.maker || null,
    signer: signedOrder?.signer || null,
    tokenId: signedOrder?.tokenId || null,
    makerAmount: signedOrder?.makerAmount || null,
    takerAmount: signedOrder?.takerAmount || null,
    expiration: signedOrder?.expiration || null,
    nonce: signedOrder?.nonce || null,
    feeRateBps: signedOrder?.feeRateBps || null,
    signatureType: signedOrder?.signatureType ?? null,
  };
}

function resolveOrderResponseId(response) {
  return response?.orderID || response?.orderId || response?.id || null;
}

function assertAcceptedOrderResponse(response) {
  const orderId = resolveOrderResponseId(response);
  const status = Number(response?.status);
  const errorMessage = normalizeString(response?.error) || normalizeString(response?.message);

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  if (Number.isFinite(status) && status >= 400) {
    throw new Error(`Polymarket menolak order dengan status ${status}.`);
  }

  if (!orderId) {
    throw new Error('Polymarket tidak mengembalikan order id setelah submit order.');
  }

  return orderId;
}

export async function getTradingSummary(profile, params = {}) {
  const { client, signerAddress, signatureType, funderAddress } = buildStoredTradingClient(profile);
  const assetId = normalizeString(params.assetId) || normalizeString(params.tokenId);
  const market = normalizeString(params.market);
  const includeAllOpenOrders = Boolean(params.includeAllOpenOrders);

  const [collateral, conditional, openOrders] = await Promise.all([
    client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL }),
    assetId
      ? client.getBalanceAllowance({ asset_type: AssetType.CONDITIONAL, token_id: assetId })
      : Promise.resolve(null),
    client.getOpenOrders(includeAllOpenOrders ? {} : {
      ...(market ? { market } : {}),
      ...(assetId ? { asset_id: assetId } : {}),
    }, true),
  ]);

  return {
    signerAddress,
    signatureType,
    funderAddress,
    collateral,
    conditional,
    openOrders: Array.isArray(openOrders) ? openOrders.map(normalizeOpenOrder) : [],
    checkedAt: new Date().toISOString(),
  };
}

export async function listTradingOpenOrders(profile, params = {}) {
  const { client } = buildStoredTradingClient(profile);
  const assetId = normalizeString(params.assetId) || normalizeString(params.tokenId);
  const market = normalizeString(params.market);
  const openOrders = await client.getOpenOrders({
    ...(market ? { market } : {}),
    ...(assetId ? { asset_id: assetId } : {}),
  }, true);

  return Array.isArray(openOrders) ? openOrders.map(normalizeOpenOrder) : [];
}

export async function previewManualTrade(profile, input, options = {}) {
  assertSupportedOrderRequest(input);

  const { client, signerAddress, signatureType, funderAddress } = buildStoredTradingClient(profile);
  const orderbook = await getPolymarketOrderBook(input.tokenId);
  const tickSize = String(orderbook?.tick_size || '0.01');
  const negRisk = Boolean(orderbook?.neg_risk);
  const side = buildOrderSide(input.side);

  let signedOrder;
  if (input.orderKind === 'market') {
    signedOrder = await client.createMarketOrder({
      tokenID: input.tokenId,
      side,
      amount: Number(input.amount),
      price: Number(input.price),
    }, { tickSize, negRisk });
  } else {
    const limitOrder = {
      tokenID: input.tokenId,
      side,
      price: Number(input.price),
      size: Number(input.size),
    };

    if (input.orderType === 'GTD') {
      limitOrder.expiration = Number(input.expiration);
    }

    signedOrder = await client.createOrder(limitOrder, { tickSize, negRisk });
  }

  assertOrderbookConstraints(input, signedOrder, orderbook);
  await assertSufficientTradingBalance(client, input, signedOrder);

  const preview = {
    marketSlug: normalizeString(input.marketSlug),
    marketQuestion: normalizeString(input.marketQuestion),
    outcomeLabel: normalizeString(input.outcomeLabel),
    tokenId: input.tokenId,
    side: input.side,
    orderKind: input.orderKind,
    orderType: input.orderType,
    price: Number(input.price),
    size: input.size !== undefined ? Number(input.size) : null,
    amount: input.amount !== undefined ? Number(input.amount) : null,
    expiration: input.expiration !== undefined ? Number(input.expiration) : null,
    postOnly: Boolean(input.postOnly),
    tickSize,
    minOrderSize: orderbook?.min_order_size || null,
    negRisk,
    signerAddress,
    signatureType,
    funderAddress,
    requiresApproval: Boolean(options.requiresApproval),
    bestBid: normalizeBookLevel(orderbook?.bids, 'bid'),
    bestAsk: normalizeBookLevel(orderbook?.asks, 'ask'),
    lastTradePrice: orderbook?.last_trade_price || null,
    order: summarizeSignedOrder(signedOrder),
  };

  return {
    preview,
    signedOrder,
  };
}

export async function placeManualTrade(profile, input, options = {}) {
  if (options.requiresApproval && !input.approvalConfirmed) {
    throw new Error('Paket STARTER membutuhkan approval eksplisit sebelum order dikirim.');
  }

  const { client } = buildStoredTradingClient(profile);
  const { preview, signedOrder } = await previewManualTrade(profile, input, options);
  const response = await client.postOrder(
    signedOrder,
    OrderType[input.orderType],
    false,
    input.orderKind === 'limit' ? Boolean(input.postOnly) : false,
  );
  assertAcceptedOrderResponse(response);

  return {
    preview,
    response,
  };
}

export async function cancelManualTrade(profile, orderId) {
  const { client } = buildStoredTradingClient(profile);
  const response = await client.cancelOrder({ orderID: orderId });
  return {
    orderId,
    response,
  };
}

export function readStoredPrivateKey(profile) {
  return profile?.encryptedPrivateKey ? decryptSecret(profile.encryptedPrivateKey) : null;
}

export function readStoredApiCredentials(profile) {
  if (!profile?.encryptedApiKey || !profile?.encryptedApiSecret || !profile?.encryptedApiPassphrase) {
    return null;
  }

  return {
    key: decryptSecret(profile.encryptedApiKey),
    secret: decryptSecret(profile.encryptedApiSecret),
    passphrase: decryptSecret(profile.encryptedApiPassphrase),
  };
}

export function buildCredentialUpdateData(input = {}) {
  const nextData = {};

  if (input.privateKey !== undefined) {
    const privateKey = normalizePrivateKey(input.privateKey);
    nextData.encryptedPrivateKey = privateKey ? encryptSecret(privateKey) : null;
    nextData.signerAddress = privateKey ? buildWallet(privateKey).address : null;
  }

  const apiKey = normalizeOptionalSecret(input.apiKey);
  const secret = normalizeOptionalSecret(input.secret);
  const passphrase = normalizeOptionalSecret(input.passphrase);
  const hasAnyApiCredential = apiKey !== null || secret !== null || passphrase !== null;

  if (hasAnyApiCredential) {
    if (!apiKey || !secret || !passphrase) {
      throw new Error('Jika ingin menyimpan API credential manual, isi apiKey, secret, dan passphrase sekaligus.');
    }

    nextData.encryptedApiKey = encryptSecret(apiKey);
    nextData.encryptedApiSecret = encryptSecret(secret);
    nextData.encryptedApiPassphrase = encryptSecret(passphrase);
  }

  if (Object.keys(nextData).length === 0) {
    throw new Error('Tidak ada credential rahasia baru yang dikirim.');
  }

  nextData.credentialsLastError = null;
  return nextData;
}

export async function createOrDeriveTradingCredentials(profile, options = {}) {
  const privateKey = normalizePrivateKey(options.privateKey) || readStoredPrivateKey(profile);
  if (!privateKey) {
    throw new Error('Private key Polymarket belum tersimpan. Simpan dulu private key terenkripsi sebelum derive credential.');
  }

  const wallet = buildWallet(privateKey);
  const signer = buildClobSigner(privateKey);
  const signerAddress = wallet.address;
  const { signatureType, funderAddress } = validateTradingIdentity(profile, signerAddress);
  const client = new ClobClient(POLYMARKET_CLOB_API_URL, POLYMARKET_CHAIN_ID, signer);

  let credentials;
  if (options.mode === 'create') {
    credentials = await client.createApiKey();
  } else if (options.mode === 'derive') {
    credentials = await client.deriveApiKey();
  } else {
    credentials = await client.createOrDeriveApiKey();
  }

  const authenticatedClient = new ClobClient(
    POLYMARKET_CLOB_API_URL,
    POLYMARKET_CHAIN_ID,
    signer,
    credentials,
    signatureType,
    funderAddress,
  );

  const [apiKeys, collateral] = await Promise.all([
    authenticatedClient.getApiKeys(),
    authenticatedClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL }),
  ]);

  return {
    signerAddress,
    signatureType,
    funderAddress,
    credentials,
    testResult: {
      endpoint: 'getBalanceAllowance',
      apiKeys,
      collateral,
      checkedAt: new Date().toISOString(),
    },
  };
}

export async function testStoredTradingCredentials(profile) {
  const { client, signerAddress, signatureType, funderAddress } = buildStoredTradingClient(profile);

  const [apiKeys, collateral] = await Promise.all([
    client.getApiKeys(),
    client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL }),
  ]);

  return {
    signerAddress,
    signatureType,
    funderAddress,
    endpoint: 'getBalanceAllowance',
    apiKeys,
    collateral,
    checkedAt: new Date().toISOString(),
  };
}
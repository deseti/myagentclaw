'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Save, Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import api from '@/lib/api';
import {
  canAccessInternalSkill,
  getInstalledInternalSkill,
  getInternalSkillDefinition,
  INTERNAL_SKILL_KEYS,
  isInternalSkillActive,
} from '@/lib/internalSkills';
import PolymarketAutopilotPanel from '@/components/polymarket-autopilot-panel';

const SIGNATURE_TYPE_OPTIONS = [
  { value: '0', label: '0 - EOA wallet' },
  { value: '1', label: '1 - Polymarket proxy wallet' },
  { value: '2', label: '2 - Gnosis Safe / proxy' },
];

const MARKET_LIMIT_OPTIONS = ['24', '48', '96'];
const MARKET_AUTO_REFRESH_MS = 15000;
const POLYMARKET_SKILL_KEY = INTERNAL_SKILL_KEYS.POLYMARKET_READ_ONLY;
const POLYMARKET_AUTOPILOT_SKILL_KEY = INTERNAL_SKILL_KEYS.POLYMARKET_GROWTH_AUTOPILOT;
const POLYMARKET_MINIMUM_TIER = getInternalSkillDefinition(POLYMARKET_SKILL_KEY)?.minimumTier || 'GROWTH';
const POLYMARKET_AUTOPILOT_MINIMUM_TIER = getInternalSkillDefinition(POLYMARKET_AUTOPILOT_SKILL_KEY)?.minimumTier || 'GROWTH';
const EMPTY_MARKET_FILTERS = {
  slug: '',
  tagId: '',
  limit: '24',
};
const EMPTY_TRADING_STATUS = {
  signerAddress: '',
  hasPrivateKey: false,
  hasApiCredentials: false,
  lastAuthenticatedAt: null,
  lastAuthError: null,
};
const EMPTY_CREDENTIAL_FORM = {
  privateKey: '',
  apiKey: '',
  secret: '',
  passphrase: '',
};
const DEFAULT_TRADE_FORM = {
  tokenId: '',
  marketSlug: '',
  marketQuestion: '',
  outcomeLabel: '',
  side: 'BUY',
  orderKind: 'limit',
  orderType: 'GTC',
  price: '',
  orderValue: '2',
  sellSize: '',
  expiration: '',
  postOnly: 'false',
};

function normalizeMarketSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function formatOrderDateTime(value) {
  if (value === undefined || value === null || value === '') return '-';
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const timestamp = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return formatDateTime(timestamp);
  }
  return formatDateTime(value);
}

function formatDisplayValue(value) {
  if (value === undefined || value === null || value === '') return '-';

  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '-';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();

  if (Array.isArray(value)) {
    const items = value.map((item) => formatDisplayValue(item)).filter((item) => item !== '-');
    return items.length ? items.join(', ') : '-';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function toLocalDateTimeValue(timestampSeconds) {
  const numeric = Number(timestampSeconds);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  const date = new Date(numeric * 1000);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

function formatAllowanceValue(value) {
  if (!value) return '-';
  if (value.allowance !== undefined && value.allowance !== null && value.allowance !== '') {
    return formatDisplayValue(value.allowance);
  }
  if (value.allowances && typeof value.allowances === 'object') {
    const entries = Object.entries(value.allowances);
    if (entries.length === 0) return '-';
    return entries
      .slice(0, 2)
      .map(([address, amount]) => `${address.slice(0, 6)}...${address.slice(-4)}: ${formatDisplayValue(amount)}`)
      .join(' | ');
  }
  return formatDisplayValue(value);
}

function normalizeAddress(value) {
  const normalized = String(value || '').trim();
  const match = normalized.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : normalized;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function formatCompactNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';

  return new Intl.NumberFormat('id-ID', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatRawTokenAmount(value, decimals = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';

  const normalized = (numeric / (10 ** decimals)).toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return normalized || '0';
}

function formatPriceNumber(value, maximumFractionDigits = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';

  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(numeric);
}

function computeSharesFromValue(orderValue, price) {
  const numericValue = Number(orderValue);
  const numericPrice = Number(price);

  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) return null;

  return numericValue / numericPrice;
}

function formatPercentFromPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return `${(numeric * 100).toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return formatDisplayValue(value);
  }

  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return formatDisplayValue(value);
  }
}

function normalizeOrderLevels(levels, sortDirection) {
  if (!Array.isArray(levels)) return [];

  return [...levels]
    .filter((level) => level && level.price !== undefined && level.size !== undefined)
    .sort((left, right) => {
      const leftPrice = Number(left.price);
      const rightPrice = Number(right.price);
      return sortDirection === 'desc' ? rightPrice - leftPrice : leftPrice - rightPrice;
    })
    .slice(0, 8);
}

function getBestBookPrice(levels, mode) {
  if (!Array.isArray(levels) || levels.length === 0) return '';

  const numericPrices = levels
    .map((level) => Number(level?.price))
    .filter((price) => Number.isFinite(price));

  if (!numericPrices.length) return '';
  return String(mode === 'min' ? Math.min(...numericPrices) : Math.max(...numericPrices));
}

function getPrimaryTokenId(market, outcomeIndex = 0) {
  const tokenIds = parseJsonArray(market?.clobTokenIds);
  return tokenIds[outcomeIndex] || tokenIds[0] || null;
}

function buildPositionsPreview(data) {
  const positions = Array.isArray(data?.positions) ? data.positions : [];

  return {
    address: data?.address || null,
    count: positions.length,
    sample: positions.slice(0, 3),
    raw: positions,
  };
}

export default function PolymarketPage() {
  const [loading, setLoading] = useState(true);
  const [polymarketSkillInstalled, setPolymarketSkillInstalled] = useState(false);
  const [hasActivePolymarketSkill, setHasActivePolymarketSkill] = useState(false);
  const [autopilotSkillInstalled, setAutopilotSkillInstalled] = useState(false);
  const [hasActiveAutopilotSkill, setHasActiveAutopilotSkill] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [derivingCredentials, setDerivingCredentials] = useState(false);
  const [testingCredentials, setTestingCredentials] = useState(false);
  const [loadingTradingDesk, setLoadingTradingDesk] = useState(false);
  const [loadingTradeAudit, setLoadingTradeAudit] = useState(false);
  const [previewingTrade, setPreviewingTrade] = useState(false);
  const [placingTrade, setPlacingTrade] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState('');
  const [prefillingPositionTokenId, setPrefillingPositionTokenId] = useState('');
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [loadingMarketDetail, setLoadingMarketDetail] = useState(false);
  const [loadingOrderbook, setLoadingOrderbook] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceTier, setWorkspaceTier] = useState('FREE');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [marketError, setMarketError] = useState('');
  const [positionsPreview, setPositionsPreview] = useState(null);
  const [tags, setTags] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [marketFilters, setMarketFilters] = useState(EMPTY_MARKET_FILTERS);
  const [selectedMarketSlug, setSelectedMarketSlug] = useState('');
  const [selectedOutcomeIndex, setSelectedOutcomeIndex] = useState(0);
  const [marketDetail, setMarketDetail] = useState(null);
  const [orderbookPreview, setOrderbookPreview] = useState(null);
  const [tradingStatus, setTradingStatus] = useState(EMPTY_TRADING_STATUS);
  const [credentialForm, setCredentialForm] = useState(EMPTY_CREDENTIAL_FORM);
  const [authPreview, setAuthPreview] = useState(null);
  const [tradingDeskError, setTradingDeskError] = useState('');
  const [tradingSummary, setTradingSummary] = useState(null);
  const [tradeAudits, setTradeAudits] = useState([]);
  const [orderPreview, setOrderPreview] = useState(null);
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [tradeForm, setTradeForm] = useState(DEFAULT_TRADE_FORM);
  const hasPolymarketTierAccess = canAccessInternalSkill(workspaceTier, POLYMARKET_MINIMUM_TIER);
  const [form, setForm] = useState({
    accountAddress: '',
    apiAddress: '',
    funderAddress: '',
    signatureType: '',
  });

  function applyTradingStatus(settings = {}) {
    setTradingStatus({
      signerAddress: settings.trading?.signerAddress || '',
      hasPrivateKey: Boolean(settings.trading?.hasPrivateKey),
      hasApiCredentials: Boolean(settings.trading?.hasApiCredentials),
      lastAuthenticatedAt: settings.trading?.lastAuthenticatedAt || null,
      lastAuthError: settings.trading?.lastAuthError || null,
    });
  }

  function updateTradeForm(patch) {
    setTradeForm((prev) => ({ ...prev, ...patch }));
    setOrderPreview(null);
  }

  function buildTradePayload({ approvalConfirmed = false } = {}) {
    const orderValue = Number(tradeForm.orderValue);
    const derivedShares = computeSharesFromValue(orderValue, tradeForm.price);
    const sellSize = Number(tradeForm.sellSize);
    const payload = {
      workspaceId,
      tokenId: tradeForm.tokenId,
      marketSlug: tradeForm.marketSlug,
      marketQuestion: tradeForm.marketQuestion,
      outcomeLabel: tradeForm.outcomeLabel,
      side: tradeForm.side,
      orderKind: tradeForm.orderKind,
      orderType: tradeForm.orderType,
      price: Number(tradeForm.price),
      postOnly: tradeForm.postOnly === 'true',
    };

    if (tradeForm.side === 'BUY' && tradeForm.orderKind === 'limit') {
      payload.size = derivedShares;
      if (tradeForm.orderType === 'GTD' && tradeForm.expiration) {
        payload.expiration = Math.floor(new Date(tradeForm.expiration).getTime() / 1000);
      }
    } else if (tradeForm.side === 'BUY' && tradeForm.orderKind === 'market') {
      payload.amount = orderValue;
    } else if (tradeForm.side === 'SELL' && tradeForm.orderKind === 'limit') {
      payload.size = sellSize;
      if (tradeForm.orderType === 'GTD' && tradeForm.expiration) {
        payload.expiration = Math.floor(new Date(tradeForm.expiration).getTime() / 1000);
      }
    } else {
      payload.amount = sellSize;
    }

    if (approvalConfirmed) {
      payload.approvalConfirmed = true;
    }

    return payload;
  }

  async function loadTradeAudit(nextWorkspaceId = workspaceId) {
    if (!nextWorkspaceId) return;

    setLoadingTradeAudit(true);

    try {
      const { data } = await api.get('/polymarket/trading/audit', {
        params: { workspaceId: nextWorkspaceId, limit: 12 },
      });
      setTradeAudits(Array.isArray(data.audits) ? data.audits : []);
    } catch (err) {
      setTradeAudits([]);
      setTradingDeskError(err.response?.data?.message || 'Gagal memuat audit trading Polymarket');
    } finally {
      setLoadingTradeAudit(false);
    }
  }

  async function loadTradingDesk(nextWorkspaceId = workspaceId, options = {}) {
    const { tokenId = '', silent = false } = options;
    if (!nextWorkspaceId) return;

    setLoadingTradingDesk(true);
    if (!silent) setTradingDeskError('');

    try {
      const params = { workspaceId: nextWorkspaceId };
      if (tokenId) params.tokenId = tokenId;
      params.includeAllOpenOrders = 'true';

      const { data } = await api.get('/polymarket/trading/summary', { params });
      setTradingSummary(data.summary || null);
    } catch (err) {
      setTradingSummary(null);
      setTradeAudits([]);
      if (!silent) {
        setTradingDeskError(err.response?.data?.message || 'Gagal memuat ringkasan trading Polymarket');
      }
    } finally {
      setLoadingTradingDesk(false);
    }
  }

  async function loadPositionsPreview(nextWorkspaceId = workspaceId, options = {}) {
    const { silent = false, toast = false } = options;
    if (!nextWorkspaceId) return null;

    try {
      const { data } = await api.get('/polymarket/positions', {
        params: { workspaceId: nextWorkspaceId, limit: 5, offset: 0 },
      });

      const preview = buildPositionsPreview(data);
      setPositionsPreview(preview);

      if (toast) {
        setSuccess(`Koneksi read-only berhasil. ${preview.count} posisi terbaca.`);
      }

      return data;
    } catch (err) {
      setPositionsPreview(null);

      if (!silent) {
        setError(err.response?.data?.message || 'Gagal menguji koneksi Polymarket');
      }

      return null;
    }
  }

  async function loadOrderbookForMarket(market, outcomeIndex = 0, nextWorkspaceId = workspaceId) {
    const tokenId = getPrimaryTokenId(market, outcomeIndex);
    setSelectedOutcomeIndex(outcomeIndex);

    if (!tokenId || !nextWorkspaceId) {
      setOrderbookPreview(null);
      return;
    }

    setLoadingOrderbook(true);

    try {
      const { data } = await api.get(`/polymarket/orderbook/${tokenId}`, {
        params: { workspaceId: nextWorkspaceId },
      });

      setOrderbookPreview(data.orderbook || null);
    } catch (err) {
      setOrderbookPreview(null);
      setMarketError(err.response?.data?.message || 'Gagal memuat orderbook Polymarket');
    } finally {
      setLoadingOrderbook(false);
    }
  }

  async function handleSelectMarket(slug, baseMarket = null, nextWorkspaceId = workspaceId, options = {}) {
    const outcomeIndex = Number.isInteger(options.outcomeIndex) ? options.outcomeIndex : 0;

    if (!slug || !nextWorkspaceId) {
      setSelectedMarketSlug('');
      setMarketDetail(null);
      setOrderbookPreview(null);
      return;
    }

    setSelectedMarketSlug(slug);
    setLoadingMarketDetail(true);
    setMarketError('');

    try {
      const { data } = await api.get(`/polymarket/markets/slug/${slug}`, {
        params: { workspaceId: nextWorkspaceId },
      });

      const detail = data.market || baseMarket || null;
      setMarketDetail(detail);
      await loadOrderbookForMarket(detail, outcomeIndex, nextWorkspaceId);
    } catch (err) {
      if (baseMarket) {
        setMarketDetail(baseMarket);
        await loadOrderbookForMarket(baseMarket, outcomeIndex, nextWorkspaceId);
      } else {
        setMarketDetail(null);
        setOrderbookPreview(null);
      }

      setMarketError(err.response?.data?.message || 'Gagal memuat detail market Polymarket');
    } finally {
      setLoadingMarketDetail(false);
    }
  }

  async function loadMarkets(nextWorkspaceId = workspaceId, filters = marketFilters, preferredSlug = selectedMarketSlug, options = {}) {
    const { silent = false } = options;
    if (!nextWorkspaceId) return;

    setLoadingMarkets(true);
    if (!silent) setMarketError('');

    try {
      const requestedLimit = Number(filters.limit) || 24;
      const searchTerm = normalizeMarketSearch(filters.slug);
      const params = {
        workspaceId: nextWorkspaceId,
        limit: searchTerm ? 100 : requestedLimit,
        active: 'true',
        closed: 'false',
        order: 'volume_24hr',
        ascending: 'false',
      };

      if (filters.tagId) {
        params.tag_id = Number(filters.tagId);
      }

      const { data } = await api.get('/polymarket/markets', { params });
      const sourceMarkets = Array.isArray(data.markets) ? data.markets : [];
      const nextMarkets = searchTerm
        ? sourceMarkets
          .filter((item) => {
            const question = normalizeMarketSearch(item?.question);
            const slug = normalizeMarketSearch(item?.slug);
            return question.includes(searchTerm) || slug.includes(searchTerm);
          })
          .slice(0, requestedLimit)
        : sourceMarkets;
      setMarkets(nextMarkets);

      const nextSlug = preferredSlug && nextMarkets.some((item) => item.slug === preferredSlug)
        ? preferredSlug
        : nextMarkets[0]?.slug || '';

      if (!nextSlug) {
        setSelectedMarketSlug('');
        setMarketDetail(null);
        setOrderbookPreview(null);
        return;
      }

      const nextMarket = nextMarkets.find((item) => item.slug === nextSlug) || null;
      await handleSelectMarket(nextSlug, nextMarket, nextWorkspaceId);
    } catch (err) {
      setMarkets([]);
      setSelectedMarketSlug('');
      setMarketDetail(null);
      setOrderbookPreview(null);
      if (!silent) {
        setMarketError(err.response?.data?.message || 'Gagal memuat daftar market Polymarket');
      }
    } finally {
      setLoadingMarkets(false);
    }
  }

  async function load() {
    setLoading(true);
    setError('');
    setSuccess('');
    setMarketError('');

    try {
      const { data: me } = await api.get('/auth/me');
      const wsId = me.workspace?.id;
      const tier = me.workspace?.subTier || 'FREE';
      const polymarketEligible = canAccessInternalSkill(tier, POLYMARKET_MINIMUM_TIER);
      const autopilotEligible = canAccessInternalSkill(tier, POLYMARKET_AUTOPILOT_MINIMUM_TIER);

      setWorkspaceId(wsId || '');
      setWorkspaceTier(tier);

      if (!wsId || !polymarketEligible) {
        setPolymarketSkillInstalled(false);
        setHasActivePolymarketSkill(false);
        setAutopilotSkillInstalled(false);
        setHasActiveAutopilotSkill(false);
        setPositionsPreview(null);
        setMarkets([]);
        setMarketDetail(null);
        setOrderbookPreview(null);
        setTradingStatus(EMPTY_TRADING_STATUS);
        setCredentialForm(EMPTY_CREDENTIAL_FORM);
        setAuthPreview(null);
        return;
      }

      const { data: installedSkillsPayload } = await api.get('/skills/installed');
      const installedSkills = Array.isArray(installedSkillsPayload.skills) ? installedSkillsPayload.skills : [];
      const polymarketSkill = getInstalledInternalSkill(installedSkills, POLYMARKET_SKILL_KEY);
      const autopilotSkill = getInstalledInternalSkill(installedSkills, POLYMARKET_AUTOPILOT_SKILL_KEY);
      const polymarketInstalled = polymarketEligible && Boolean(polymarketSkill);
      const polymarketActive = polymarketEligible && isInternalSkillActive(polymarketSkill);
      const autopilotInstalled = autopilotEligible && Boolean(autopilotSkill);
      const autopilotActive = autopilotEligible && isInternalSkillActive(autopilotSkill);
      setPolymarketSkillInstalled(polymarketInstalled);
      setHasActivePolymarketSkill(polymarketActive);
      setAutopilotSkillInstalled(autopilotInstalled);
      setHasActiveAutopilotSkill(autopilotActive);

      if (!polymarketActive) {
        setPositionsPreview(null);
        setMarkets([]);
        setMarketDetail(null);
        setOrderbookPreview(null);
        setTradingStatus(EMPTY_TRADING_STATUS);
        setCredentialForm(EMPTY_CREDENTIAL_FORM);
        setAuthPreview(null);
        setTradingSummary(null);
        setTradeAudits([]);
        setOrderPreview(null);
        return;
      }

      setMarketFilters(EMPTY_MARKET_FILTERS);
      setLoadingTags(true);

      const [settingsResult, tagsResult] = await Promise.allSettled([
        api.get('/polymarket/settings', { params: { workspaceId: wsId } }),
        api.get('/polymarket/tags', { params: { workspaceId: wsId } }),
      ]);

      if (settingsResult.status === 'fulfilled') {
        const settings = settingsResult.value.data.settings || {};

        setForm({
          accountAddress: settings.accountAddress || '',
          apiAddress: settings.apiAddress || '',
          funderAddress: settings.funderAddress || '',
          signatureType: settings.signatureType === null || settings.signatureType === undefined
            ? ''
            : String(settings.signatureType),
        });
        applyTradingStatus(settings);
        setCredentialForm(EMPTY_CREDENTIAL_FORM);
        setAuthPreview(null);
        setTradeForm(DEFAULT_TRADE_FORM);
        setTradingSummary(null);
        setTradeAudits([]);
        setOrderPreview(null);

        if (settings.preferredReadAddress) {
          await loadPositionsPreview(wsId, { silent: true });
        } else {
          setPositionsPreview(null);
        }
      } else {
        setError(settingsResult.reason?.response?.data?.message || 'Gagal memuat settings Polymarket');
      }

      if (tagsResult.status === 'fulfilled') {
        setTags(Array.isArray(tagsResult.value.data.tags) ? tagsResult.value.data.tags.slice(0, 120) : []);
      } else {
        setTags([]);
      }

      await loadMarkets(wsId, EMPTY_MARKET_FILTERS, '');
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memuat dashboard Polymarket');
    } finally {
      setLoadingTags(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!workspaceId) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        workspaceId,
        accountAddress: normalizeAddress(form.accountAddress) || null,
        apiAddress: normalizeAddress(form.apiAddress) || null,
        funderAddress: normalizeAddress(form.funderAddress) || null,
        signatureType: form.signatureType === '' ? null : Number(form.signatureType),
      };

      const { data } = await api.put('/polymarket/settings', payload);
      setForm({
        accountAddress: data.settings?.accountAddress || '',
        apiAddress: data.settings?.apiAddress || '',
        funderAddress: data.settings?.funderAddress || '',
        signatureType: data.settings?.signatureType === null || data.settings?.signatureType === undefined
          ? ''
          : String(data.settings.signatureType),
      });

      if (data.settings?.preferredReadAddress) {
        await loadPositionsPreview(workspaceId, { silent: true });
      }

      setSuccess(data.message || 'Settings Polymarket berhasil disimpan');
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan settings Polymarket');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    if (!workspaceId) return;

    setTesting(true);
    setError('');
    setSuccess('');

    try {
      await loadPositionsPreview(workspaceId, { toast: true });
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveCredentials() {
    if (!workspaceId) return;

    setSavingCredentials(true);
    setError('');
    setSuccess('');

    try {
      const payload = { workspaceId };

      if (credentialForm.privateKey.trim()) payload.privateKey = credentialForm.privateKey.trim();
      if (credentialForm.apiKey.trim()) payload.apiKey = credentialForm.apiKey.trim();
      if (credentialForm.secret.trim()) payload.secret = credentialForm.secret.trim();
      if (credentialForm.passphrase.trim()) payload.passphrase = credentialForm.passphrase.trim();

      const { data } = await api.put('/polymarket/credentials', payload);
      applyTradingStatus(data.settings || {});
      setCredentialForm(EMPTY_CREDENTIAL_FORM);
      setTradingDeskError('');
      setSuccess(data.message || 'Credential trading Polymarket berhasil disimpan');
    } catch (err) {
      applyTradingStatus(err.response?.data?.settings || {});
      setError(err.response?.data?.message || 'Gagal menyimpan credential trading Polymarket');
    } finally {
      setSavingCredentials(false);
    }
  }

  async function handleDeriveCredentials() {
    if (!workspaceId) return;

    setDerivingCredentials(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        workspaceId,
        mode: 'createOrDerive',
      };

      if (credentialForm.privateKey.trim()) {
        payload.privateKey = credentialForm.privateKey.trim();
      }

      const { data } = await api.post('/polymarket/credentials/derive', payload);
      applyTradingStatus(data.settings || {});
      setCredentialForm((prev) => ({ ...prev, privateKey: '', apiKey: '', secret: '', passphrase: '' }));
      setAuthPreview(data.auth || null);
      await Promise.all([
        loadTradingDesk(workspaceId, { tokenId: tradeForm.tokenId, silent: true }),
        loadTradeAudit(workspaceId),
      ]);
      setSuccess(data.message || 'API credential Polymarket berhasil dibuat atau diturunkan');
    } catch (err) {
      applyTradingStatus(err.response?.data?.settings || {});
      setAuthPreview(null);
      setError(err.response?.data?.message || 'Gagal derive credential trading Polymarket');
    } finally {
      setDerivingCredentials(false);
    }
  }

  async function handleTestAuthenticatedConnection() {
    if (!workspaceId) return;

    setTestingCredentials(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await api.post('/polymarket/credentials/test', { workspaceId });
      applyTradingStatus(data.settings || {});
      setAuthPreview(data.auth || null);
      await loadTradingDesk(workspaceId, { tokenId: tradeForm.tokenId, silent: true });
      setSuccess(data.message || 'Authenticated read Polymarket berhasil');
    } catch (err) {
      applyTradingStatus(err.response?.data?.settings || {});
      setAuthPreview(null);
      setError(err.response?.data?.message || 'Gagal menguji credential trading Polymarket');
    } finally {
      setTestingCredentials(false);
    }
  }

  async function applyMarketFilters() {
    setSuccess('');
    setError('');
    await loadMarkets(workspaceId, marketFilters, '');
  }

  async function resetMarketFilters() {
    setMarketFilters(EMPTY_MARKET_FILTERS);
    setSuccess('');
    setError('');
    await loadMarkets(workspaceId, EMPTY_MARKET_FILTERS, '');
  }

  async function handlePreviewTrade() {
    if (!workspaceId) return;

    setPreviewingTrade(true);
    setTradingDeskError('');
    setSuccess('');

    try {
      const payload = buildTradePayload();
      const { data } = await api.post('/polymarket/trading/preview', payload);
      setOrderPreview(data.preview || null);
      await loadTradeAudit(workspaceId);
      setSuccess('Preview order Polymarket berhasil dibuat. Tinjau detail sebelum kirim order nyata.');
    } catch (err) {
      setOrderPreview(null);
      await loadTradeAudit(workspaceId);
      setTradingDeskError(err.response?.data?.message || 'Gagal membuat preview order Polymarket');
    } finally {
      setPreviewingTrade(false);
    }
  }

  async function handlePlaceTrade() {
    if (!workspaceId || !orderPreview) return;

    setPlacingTrade(true);
    setTradingDeskError('');
    setSuccess('');

    try {
      const payload = buildTradePayload({ approvalConfirmed: true });
      const { data } = await api.post('/polymarket/trading/orders', payload);
      setTradeDialogOpen(false);
      setOrderPreview(null);
      await Promise.all([
        loadTradingDesk(workspaceId, { tokenId: tradeForm.tokenId, silent: true }),
        loadTradeAudit(workspaceId),
        loadPositionsPreview(workspaceId, { silent: true }),
      ]);
      setSuccess(data.message || 'Order Polymarket berhasil dikirim');
    } catch (err) {
      await loadTradeAudit(workspaceId);
      setTradingDeskError(err.response?.data?.message || 'Gagal mengirim order Polymarket');
    } finally {
      setPlacingTrade(false);
    }
  }

  async function handleCancelOrder(order) {
    if (!workspaceId || !order?.id) return;
    if (typeof window !== 'undefined' && !window.confirm(`Batalkan order ${order.id}?`)) return;

    setCancellingOrderId(order.id);
    setTradingDeskError('');
    setSuccess('');

    try {
      const { data } = await api.post('/polymarket/trading/orders/cancel', {
        workspaceId,
        orderId: order.id,
        marketSlug: tradeForm.marketSlug,
        tokenId: order.assetId || tradeForm.tokenId,
        outcomeLabel: order.outcome || tradeForm.outcomeLabel,
      });
      await Promise.all([
        loadTradingDesk(workspaceId, { tokenId: tradeForm.tokenId, silent: true }),
        loadTradeAudit(workspaceId),
        loadPositionsPreview(workspaceId, { silent: true }),
      ]);
      setSuccess(data.message || 'Order Polymarket berhasil dibatalkan');
    } catch (err) {
      await loadTradeAudit(workspaceId);
      setTradingDeskError(err.response?.data?.message || 'Gagal membatalkan order Polymarket');
    } finally {
      setCancellingOrderId('');
    }
  }

  async function handleSellPosition(position) {
    const tokenId = String(position?.asset || position?.token_id || position?.conditionId || '').trim();
    const slug = String(position?.slug || '').trim();
    const size = Number(position?.size || position?.balance || position?.amount || 0);
    const outcomeIndex = Number.isInteger(position?.outcomeIndex) ? position.outcomeIndex : 0;
    const price = Number(position?.curPrice || position?.avg_price || position?.average_price || 0);

    if (!workspaceId || !tokenId || !(size > 0)) {
      setTradingDeskError('Posisi ini belum memiliki token atau size yang valid untuk dipakai di ticket jual.');
      return;
    }

    setPrefillingPositionTokenId(tokenId);
    setSuccess('');
    setError('');
    setTradingDeskError('');

    try {
      if (slug) {
        await handleSelectMarket(slug, null, workspaceId, { outcomeIndex });
      }

      updateTradeForm({
        side: 'SELL',
        orderKind: 'market',
        orderType: 'FAK',
        tokenId,
        marketSlug: slug || tradeForm.marketSlug,
        marketQuestion: String(position?.title || position?.question || tradeForm.marketQuestion || ''),
        outcomeLabel: String(position?.outcome || tradeForm.outcomeLabel || ''),
        sellSize: String(size),
        price: Number.isFinite(price) && price > 0 ? String(price) : tradeForm.price,
        expiration: '',
        postOnly: 'false',
      });

      if (typeof document !== 'undefined') {
        document.getElementById('manual-order-ticket')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      setSuccess(`Ticket market SELL sudah diisi dari posisi ${position?.outcome || 'aktif'}. Tinjau worst price lalu preview sebelum kirim order.`);
    } catch (err) {
      setTradingDeskError(err.response?.data?.message || 'Gagal menyiapkan ticket jual dari posisi aktif.');
    } finally {
      setPrefillingPositionTokenId('');
    }
  }

  const selectedOutcomes = parseJsonArray(marketDetail?.outcomes);
  const selectedOutcomePrices = parseJsonArray(marketDetail?.outcomePrices);
  const selectedTokenIds = parseJsonArray(marketDetail?.clobTokenIds);
  const topBids = normalizeOrderLevels(orderbookPreview?.bids, 'desc');
  const topAsks = normalizeOrderLevels(orderbookPreview?.asks, 'asc');
  const bestBidPrice = getBestBookPrice(orderbookPreview?.bids, 'max');
  const bestAskPrice = getBestBookPrice(orderbookPreview?.asks, 'min');
  const activeTradingTokenId = selectedTokenIds[selectedOutcomeIndex] || getPrimaryTokenId(marketDetail, selectedOutcomeIndex) || '';
  const activeOutcomeLabel = selectedOutcomes[selectedOutcomeIndex] || '';
  const selectedOutcomePrice = selectedOutcomePrices[selectedOutcomeIndex] || '';
  const collateralBalanceDisplay = formatRawTokenAmount(tradingSummary?.collateral?.balance);
  const selectedTokenBalanceDisplay = formatRawTokenAmount(tradingSummary?.conditional?.balance);
  const derivedShares = computeSharesFromValue(tradeForm.orderValue, tradeForm.price);
  const estimatedSellValue = computeSharesFromValue(tradeForm.sellSize, 1 / Number(tradeForm.price || 0));
  const orderValueHelpText = `Untuk BUY ${tradeForm.orderKind}, input utama memakai amount USDC. Balance tersedia saat ini sekitar ${collateralBalanceDisplay} USDC.`;
  const limitSizeHelpText = tradeForm.side === 'BUY'
    ? (orderbookPreview?.min_order_size
      ? `Exchange min size untuk order resting di market ini adalah ${orderbookPreview.min_order_size} share. Dashboard menghitung share otomatis dari amount USDC dan harga.`
      : 'Dashboard menghitung share otomatis dari amount USDC dan harga yang Anda pilih.')
    : (orderbookPreview?.min_order_size
      ? `Exchange min size untuk order resting di market ini adalah ${orderbookPreview.min_order_size} share.`
      : 'Untuk SELL limit, masukkan jumlah share yang ingin dijual.');
  const marketPriceHelpText = tradeForm.side === 'BUY'
    ? `Untuk market BUY, worst price harus minimal menyentuh best ask saat ini (${bestAskPrice || '-'}).`
    : `Untuk market SELL, worst price harus maksimal menyentuh best bid saat ini (${bestBidPrice || '-'}).`;
  const derivedSharesHelpText = tradeForm.side === 'BUY'
    ? (derivedShares !== null
      ? `Estimasi size yang akan dipakai: ${formatPriceNumber(derivedShares, 6)} share.`
      : 'Isi price dan nilai USDC agar dashboard bisa menghitung jumlah share secara otomatis.')
    : (Number(tradeForm.sellSize) > 0 && Number(tradeForm.price) > 0
      ? `Estimasi nilai order: ${formatPriceNumber(Number(tradeForm.sellSize) * Number(tradeForm.price), 6)} USDC.`
      : 'Isi size/shares dan price untuk melihat estimasi nilai order.');

  useEffect(() => {
    if (!activeTradingTokenId) return;

    let shouldResetPreview = false;

    setTradeForm((prev) => {
      const nextPrice = prev.tokenId === activeTradingTokenId
        ? prev.price
        : String(bestAskPrice || selectedOutcomePrice || prev.price || '');

      const nextTradeForm = {
        ...prev,
        tokenId: activeTradingTokenId,
        marketSlug: marketDetail?.slug || '',
        marketQuestion: marketDetail?.question || '',
        outcomeLabel: activeOutcomeLabel,
        price: nextPrice,
      };

      if (
        prev.tokenId === nextTradeForm.tokenId
        && prev.marketSlug === nextTradeForm.marketSlug
        && prev.marketQuestion === nextTradeForm.marketQuestion
        && prev.outcomeLabel === nextTradeForm.outcomeLabel
        && prev.price === nextTradeForm.price
      ) {
        return prev;
      }

      shouldResetPreview = true;
      return nextTradeForm;
    });

    if (shouldResetPreview) {
      setOrderPreview(null);
    }
  }, [activeTradingTokenId, activeOutcomeLabel, marketDetail?.question, marketDetail?.slug, bestAskPrice, selectedOutcomePrice]);

  useEffect(() => {
    if (!workspaceId || !hasPolymarketTierAccess) return;
    if (!tradingStatus.hasApiCredentials) {
      setTradingSummary(null);
      setTradeAudits([]);
      return;
    }

    loadTradingDesk(workspaceId, { tokenId: activeTradingTokenId, silent: true });
    loadTradeAudit(workspaceId);
  }, [workspaceId, hasPolymarketTierAccess, tradingStatus.hasApiCredentials, activeTradingTokenId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!workspaceId || !hasPolymarketTierAccess || !hasActivePolymarketSkill) return undefined;

    const intervalId = setInterval(() => {
      loadMarkets(workspaceId, marketFilters, selectedMarketSlug, { silent: true });

      if (marketDetail) {
        loadOrderbookForMarket(marketDetail, selectedOutcomeIndex, workspaceId);
      }
    }, MARKET_AUTO_REFRESH_MS);

    return () => clearInterval(intervalId);
  }, [workspaceId, hasPolymarketTierAccess, hasActivePolymarketSkill, marketFilters, selectedMarketSlug, marketDetail, selectedOutcomeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!hasPolymarketTierAccess) {
    return (
      <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold text-white">Polymarket</h1>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Fitur belum tersedia</AlertTitle>
          <AlertDescription>
            Polymarket memerlukan minimum paket Growth. Upgrade paket di <Link href="/dashboard/billing" className="underline underline-offset-4">halaman Billing</Link> untuk melanjutkan.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!hasActivePolymarketSkill) {
    return (
      <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold text-white">Polymarket</h1>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Skill Polymarket belum aktif</AlertTitle>
          <AlertDescription>
            {polymarketSkillInstalled
              ? <>Skill <strong>{POLYMARKET_SKILL_KEY}</strong> sudah terinstall, tetapi belum aktif. Assign ke minimal satu agent di <Link href="/dashboard/skills" className="underline underline-offset-4">halaman Skills</Link> untuk membuka dashboard Polymarket.</>
              : <>Install built-in skill <strong>{POLYMARKET_SKILL_KEY}</strong> lalu assign ke minimal satu agent di <Link href="/dashboard/skills" className="underline underline-offset-4">halaman Skills</Link> untuk mengaktifkan dashboard dan capability agent Polymarket.</>}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Polymarket</h1>
          <p className="text-sm text-slate-400">Settings identity, positions viewer, market explorer live, dan ticket trading berbasis nilai USDC untuk workspace aktif.</p>
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Muat Ulang
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {tradingDeskError && (
        <Alert variant="destructive">
          <AlertDescription>{tradingDeskError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <Card className="border-slate-800 bg-slate-900">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-emerald-400" />
                Identity Settings
              </CardTitle>
              <CardDescription>
                Isi alamat yang dipakai agent untuk membaca posisi dan menyiapkan fase auth trading nanti. Address API-use dapat berbeda dari address profil utama.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Profile Address</Label>
                <Input
                  value={form.accountAddress}
                  onChange={(event) => setForm((prev) => ({ ...prev, accountAddress: event.target.value }))}
                  placeholder="0x..."
                  className="border-slate-700 bg-slate-800 font-mono"
                />
              </div>

              <div className="space-y-2">
                <Label>API-use Address</Label>
                <Input
                  value={form.apiAddress}
                  onChange={(event) => setForm((prev) => ({ ...prev, apiAddress: event.target.value }))}
                  placeholder="0x..."
                  className="border-slate-700 bg-slate-800 font-mono"
                />
                <p className="text-xs text-slate-500">Gunakan address yang di halaman Polymarket ditandai untuk API jika berbeda dari profile address.</p>
              </div>

              <div className="space-y-2">
                <Label>Funder Address</Label>
                <Input
                  value={form.funderAddress}
                  onChange={(event) => setForm((prev) => ({ ...prev, funderAddress: event.target.value }))}
                  placeholder="0x..."
                  className="border-slate-700 bg-slate-800 font-mono"
                />
                <p className="text-xs text-slate-500">Dipakai untuk validasi flow trading. Untuk signature type 0, funder harus sama dengan signer private key.</p>
              </div>

              <div className="space-y-2">
                <Label>Signature Type</Label>
                <Select value={form.signatureType} onValueChange={(value) => setForm((prev) => ({ ...prev, signatureType: value }))}>
                  <SelectTrigger className="border-slate-700 bg-slate-800">
                    <SelectValue placeholder="Pilih signature type" />
                  </SelectTrigger>
                  <SelectContent>
                    {SIGNATURE_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500">Signature type ini divalidasi saat create/derive/test authenticated credential.</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Simpan Settings
                </Button>
                <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
                  {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Test Read-only Connection
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader>
              <CardTitle>Trading Credential Flow</CardTitle>
              <CardDescription>
                Fase 5: simpan private key dan API credential secara terenkripsi di backend, lalu uji authenticated read CLOB tanpa place order. Secret tidak pernah dikirim balik ke browser setelah tersimpan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                  <p className="text-slate-500">Private key server-side</p>
                  <p className="mt-1 font-semibold text-white">{tradingStatus.hasPrivateKey ? 'Tersimpan terenkripsi' : 'Belum ada'}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                  <p className="text-slate-500">API credential L2</p>
                  <p className="mt-1 font-semibold text-white">{tradingStatus.hasApiCredentials ? 'Tersimpan terenkripsi' : 'Belum ada'}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300 md:col-span-2">
                  <p className="text-slate-500">Signer address</p>
                  <p className="mt-1 break-all font-mono text-xs text-white">{tradingStatus.signerAddress || '-'}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300 md:col-span-2">
                  <p className="text-slate-500">Authenticated test terakhir</p>
                  <p className="mt-1 font-semibold text-white">{tradingStatus.lastAuthenticatedAt ? formatDateTime(tradingStatus.lastAuthenticatedAt) : 'Belum pernah diuji'}</p>
                </div>
              </div>

              {tradingStatus.lastAuthError && (
                <Alert variant="destructive">
                  <AlertDescription>{tradingStatus.lastAuthError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label>Private Key</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={credentialForm.privateKey}
                  onChange={(event) => setCredentialForm((prev) => ({ ...prev, privateKey: event.target.value }))}
                  placeholder="0x..."
                  className="border-slate-700 bg-slate-800 font-mono"
                />
                <p className="text-xs text-slate-500">Dipakai server untuk L1 auth dan create/derive API credential. Tidak pernah ditampilkan kembali setelah tersimpan.</p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={credentialForm.apiKey}
                    onChange={(event) => setCredentialForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                    placeholder="manual import optional"
                    className="border-slate-700 bg-slate-800 font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Secret</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={credentialForm.secret}
                    onChange={(event) => setCredentialForm((prev) => ({ ...prev, secret: event.target.value }))}
                    placeholder="manual import optional"
                    className="border-slate-700 bg-slate-800 font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Passphrase</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={credentialForm.passphrase}
                    onChange={(event) => setCredentialForm((prev) => ({ ...prev, passphrase: event.target.value }))}
                    placeholder="manual import optional"
                    className="border-slate-700 bg-slate-800 font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={handleSaveCredentials} disabled={savingCredentials}>
                  {savingCredentials ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Simpan Secret Terenkripsi
                </Button>
                <Button variant="outline" onClick={handleDeriveCredentials} disabled={derivingCredentials}>
                  {derivingCredentials ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Create/Derive API Credential
                </Button>
                <Button variant="outline" onClick={handleTestAuthenticatedConnection} disabled={testingCredentials}>
                  {testingCredentials ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Test Authenticated Read
                </Button>
              </div>

              {authPreview && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                    <p className="text-slate-500">Endpoint test</p>
                    <p className="mt-1 font-semibold text-white">{formatDisplayValue(authPreview.endpoint)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                    <p className="text-slate-500">Funder address</p>
                    <p className="mt-1 break-all font-mono text-xs text-white">{formatDisplayValue(authPreview.funderAddress)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                    <p className="text-slate-500">Collateral balance</p>
                    <p className="mt-1 font-semibold text-white">{formatDisplayValue(authPreview.collateral?.balance)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                    <p className="text-slate-500">Collateral allowance</p>
                    <p className="mt-1 font-semibold text-white">{formatAllowanceValue(authPreview.collateral)}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-800 bg-slate-900">
          <CardHeader>
            <CardTitle>Saved Address Positions</CardTitle>
            <CardDescription>
              Positions viewer ini selalu memakai address yang tersimpan di settings workspace. Tidak perlu lagi query manual di URL.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {positionsPreview ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                    <p className="text-slate-500">Address aktif</p>
                    <p className="break-all font-mono text-xs text-white">{positionsPreview.address}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                    <p className="text-slate-500">Jumlah posisi terbaca</p>
                    <p className="text-xl font-semibold text-white">{positionsPreview.count}</p>
                  </div>
                </div>

                {positionsPreview.raw.length === 0 ? (
                  <p className="text-sm text-slate-400">Belum ada posisi terbuka pada address tersimpan ini, tetapi koneksi read-only sudah valid.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {positionsPreview.raw.map((item, index) => {
                      const tokenId = item.asset || item.token_id || item.conditionId || 'unknown-asset';
                      const positionSize = Number(item.size || item.balance || item.amount || 0);
                      const estimatedMinSizeWarning = Number.isFinite(positionSize) && positionSize > 0 && positionSize < 5;

                      return (
                        <div key={`${tokenId}-${index}`} className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                          <p className="text-sm font-semibold text-white">{item.title || item.question || item.slug || 'Active position'}</p>
                          <p className="mt-1 text-xs text-slate-400">{item.outcome || 'Outcome'}{item.slug ? ` • ${item.slug}` : ''}</p>
                          <p className="mt-2 break-all font-mono text-[11px] text-slate-500">{tokenId}</p>
                          <div className="mt-3 space-y-1">
                            <p>Size / Shares: {item.size || item.balance || item.amount || '-'}</p>
                            <p>Avg Price: {item.avg_price || item.average_price || '-'}</p>
                            <p>Current Price: {item.curPrice || '-'}</p>
                            <p>Current Value: {item.current_value || item.value || '-'}</p>
                          </div>
                          {estimatedMinSizeWarning && (
                            <p className="mt-3 text-xs text-amber-300">Size posisi ini kecil. Exchange bisa menolak sell jika minimum order size market lebih besar dari size aktif Anda.</p>
                          )}
                            <Button
                            variant="outline"
                            className="mt-3 w-full"
                            onClick={() => handleSellPosition(item)}
                            disabled={prefillingPositionTokenId === tokenId}
                          >
                            {prefillingPositionTokenId === tokenId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              Sell at Market
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-400">Belum ada preview. Simpan settings lalu klik Test Read-only Connection.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <PolymarketAutopilotPanel
        workspaceId={workspaceId}
        workspaceTier={workspaceTier}
          hasAutopilotSkill={hasActiveAutopilotSkill}
          autopilotSkillInstalled={autopilotSkillInstalled}
      />

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <Card className="border-slate-800 bg-slate-900">
          <CardHeader>
            <CardTitle>Market Explorer</CardTitle>
            <CardDescription>
              Jelajahi market aktif Polymarket dari dashboard. Daftar diurutkan berdasarkan volume 24 jam dan disegarkan otomatis tiap 15 detik.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Filter judul / slug</Label>
                <Input
                  value={marketFilters.slug}
                  onChange={(event) => setMarketFilters((prev) => ({ ...prev, slug: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyMarketFilters();
                    }
                  }}
                  placeholder="contoh: Iran, ceasefire, Manchester City, bitcoin"
                  className="border-slate-700 bg-slate-800"
                />
              </div>

              <div className="space-y-2">
                <Label>Jumlah market</Label>
                <Select value={marketFilters.limit} onValueChange={(value) => setMarketFilters((prev) => ({ ...prev, limit: value }))}>
                  <SelectTrigger className="border-slate-700 bg-slate-800">
                    <SelectValue placeholder="Limit" />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKET_LIMIT_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tag market</Label>
              <Select value={marketFilters.tagId || 'all'} onValueChange={(value) => setMarketFilters((prev) => ({ ...prev, tagId: value === 'all' ? '' : value }))}>
                <SelectTrigger className="border-slate-700 bg-slate-800">
                  <SelectValue placeholder={loadingTags ? 'Memuat tag...' : 'Pilih tag'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua tag</SelectItem>
                  {tags.map((tag) => (
                    <SelectItem key={tag.id} value={String(tag.id)}>{tag.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={applyMarketFilters} disabled={loadingMarkets}>
                {loadingMarkets ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Muat Market
              </Button>
              <Button variant="outline" onClick={resetMarketFilters} disabled={loadingMarkets}>
                Reset Filter
              </Button>
            </div>

            {marketError && (
              <Alert variant="destructive">
                <AlertDescription>{marketError}</AlertDescription>
              </Alert>
            )}

            <div className="max-h-[34rem] space-y-3 overflow-auto pr-1">
              {loadingMarkets ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : markets.length === 0 ? (
                <p className="text-sm text-slate-400">Tidak ada market yang cocok dengan filter saat ini.</p>
              ) : markets.map((market) => {
                const isSelected = market.slug === selectedMarketSlug;
                const outcomes = parseJsonArray(market.outcomes);
                const outcomePrices = parseJsonArray(market.outcomePrices);

                return (
                  <button
                    key={market.id || market.slug}
                    type="button"
                    onClick={() => handleSelectMarket(market.slug, market)}
                    className={`w-full rounded-xl border p-4 text-left transition ${isSelected ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-950/60 hover:border-slate-600'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{market.question || market.slug}</p>
                        <p className="mt-1 text-xs text-slate-400">{market.slug}</p>
                      </div>
                      <div className="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-300">
                        {market.active ? 'ACTIVE' : market.closed ? 'CLOSED' : 'DRAFT'}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                      <div>
                        <p className="text-slate-500">Volume 24h</p>
                        <p className="text-sm text-slate-200">{formatCompactNumber(market.volume24hr || market.volume24hrClob)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Liquidity</p>
                        <p className="text-sm text-slate-200">{formatCompactNumber(market.liquidityNum || market.liquidity)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Best Bid</p>
                        <p className="text-sm text-slate-200">{market.bestBid ?? '-'}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Best Ask</p>
                        <p className="text-sm text-slate-200">{market.bestAsk ?? '-'}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {outcomes.slice(0, 2).map((outcome, index) => (
                        <span key={`${market.id}-${outcome}`} className="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-300">
                          {outcome}: {formatPercentFromPrice(outcomePrices[index])}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card id="manual-order-ticket" className="border-slate-800 bg-slate-900">
            <CardHeader>
              <CardTitle>Market Detail</CardTitle>
              <CardDescription>
                Detail market terpilih untuk membantu review konteks, outcome price, likuiditas, dan deadline sebelum masuk fase trading.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingMarketDetail ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : marketDetail ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <h2 className="text-lg font-semibold text-white">{marketDetail.question || marketDetail.slug}</h2>
                      <p className="text-xs text-slate-400">{marketDetail.slug}</p>
                      {marketDetail.events?.[0]?.title && (
                        <p className="text-sm text-slate-300">Event: {marketDetail.events[0].title}</p>
                      )}
                    </div>
                    <div className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
                      Ends: {formatDateTime(marketDetail.endDate)}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Volume 24h</p>
                      <p className="mt-1 text-lg font-semibold text-white">{formatCompactNumber(marketDetail.volume24hr || marketDetail.volume24hrClob)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Total Volume</p>
                      <p className="mt-1 text-lg font-semibold text-white">{formatCompactNumber(marketDetail.volumeNum || marketDetail.volume)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Liquidity</p>
                      <p className="mt-1 text-lg font-semibold text-white">{formatCompactNumber(marketDetail.liquidityNum || marketDetail.liquidity)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Min Order Size</p>
                      <p className="mt-1 text-lg font-semibold text-white">{formatDisplayValue(orderbookPreview?.min_order_size || '-')}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Last Trade</p>
                      <p className="mt-1 text-lg font-semibold text-white">{marketDetail.lastTradePrice ?? '-'}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {selectedOutcomes.map((outcome, index) => (
                      <div key={`${marketDetail.id}-${outcome}`} className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                        <p className="font-semibold text-white">{outcome}</p>
                        <p className="mt-1 text-slate-400">Indicative price: {formatPercentFromPrice(selectedOutcomePrices[index])}</p>
                        {selectedTokenIds[index] && (
                          <p className="mt-2 break-all font-mono text-[11px] text-slate-500">Token ID: {selectedTokenIds[index]}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-white">Deskripsi</p>
                    <div className="max-h-48 overflow-auto rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm leading-6 text-slate-300">
                      {marketDetail.description || 'Belum ada deskripsi dari API market ini.'}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-400">Pilih satu market di panel kiri untuk melihat detail lengkapnya.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader>
              <CardTitle>Orderbook Viewer</CardTitle>
              <CardDescription>
                Menampilkan bid dan ask terbaik dari outcome token market terpilih. Ini tetap read-only dan belum mengeksekusi order apa pun.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {marketDetail && selectedTokenIds.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {selectedTokenIds.map((tokenId, index) => (
                    <Button
                      key={tokenId}
                      type="button"
                      variant={index === selectedOutcomeIndex ? 'default' : 'outline'}
                      onClick={() => loadOrderbookForMarket(marketDetail, index)}
                      disabled={loadingOrderbook}
                    >
                      {selectedOutcomes[index] || `Outcome ${index + 1}`}
                    </Button>
                  ))}
                </div>
              )}

              {loadingOrderbook ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : orderbookPreview ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <div className="rounded-lg border border-emerald-800/70 bg-emerald-950/20 p-3">
                      <p className="text-sm font-semibold text-emerald-300">Top Bids</p>
                    </div>
                    {topBids.length === 0 ? (
                      <p className="text-sm text-slate-400">Tidak ada bid yang terbaca.</p>
                    ) : topBids.map((level, index) => (
                      <div key={`bid-${level.price}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                        <span>Price {level.price}</span>
                        <span>Size {formatCompactNumber(level.size)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-lg border border-rose-800/70 bg-rose-950/20 p-3">
                      <p className="text-sm font-semibold text-rose-300">Top Asks</p>
                    </div>
                    {topAsks.length === 0 ? (
                      <p className="text-sm text-slate-400">Tidak ada ask yang terbaca.</p>
                    ) : topAsks.map((level, index) => (
                      <div key={`ask-${level.price}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300">
                        <span>Price {level.price}</span>
                        <span>Size {formatCompactNumber(level.size)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-400">Pilih market dengan token CLOB agar orderbook bisa ditampilkan di sini.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader>
              <CardTitle>Authenticated Trading Summary</CardTitle>
              <CardDescription>
                Saldo collateral, allowance outcome terpilih, dan open orders dari endpoint authenticated trading. Tidak ada order yang dikirim dari panel ini.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!tradingStatus.hasApiCredentials ? (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>Simpan lalu derive/test credential trading dulu agar balances, allowances, dan open orders bisa dibaca.</AlertDescription>
                </Alert>
              ) : loadingTradingDesk ? (
                <div className="flex h-28 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : tradingSummary ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Collateral balance</p>
                      <p className="mt-1 text-lg font-semibold text-white">{formatDisplayValue(tradingSummary.collateral?.balance)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Collateral allowance</p>
                      <p className="mt-1 break-all text-sm font-semibold text-white">{formatAllowanceValue(tradingSummary.collateral)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Selected token allowance</p>
                      <p className="mt-1 break-all text-sm font-semibold text-white">{formatAllowanceValue(tradingSummary.conditional)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Selected token balance</p>
                      <p className="mt-1 text-lg font-semibold text-white">{selectedTokenBalanceDisplay}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Open orders</p>
                      <p className="mt-1 text-lg font-semibold text-white">{Array.isArray(tradingSummary.openOrders) ? tradingSummary.openOrders.length : 0}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                      <p className="text-slate-500">Signer address</p>
                      <p className="mt-1 break-all font-mono text-xs text-white">{formatDisplayValue(tradingSummary.signerAddress)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                      <p className="text-slate-500">Funder address</p>
                      <p className="mt-1 break-all font-mono text-xs text-white">{formatDisplayValue(tradingSummary.funderAddress)}</p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-400">Ringkasan trading belum tersedia untuk workspace ini.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900">
            <CardHeader>
              <CardTitle>Manual Order Ticket</CardTitle>
              <CardDescription>
                Preview dan kirim order Polymarket secara manual. Input utama diseragamkan ke nilai USDC, lalu dashboard menghitung share yang dibutuhkan untuk limit dan sell.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Side</Label>
                  <Select value={tradeForm.side} onValueChange={(value) => updateTradeForm({ side: value })}>
                    <SelectTrigger className="border-slate-700 bg-slate-800">
                      <SelectValue placeholder="Pilih side" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BUY">BUY</SelectItem>
                      <SelectItem value="SELL">SELL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Order Kind</Label>
                  <Select
                    value={tradeForm.orderKind}
                    onValueChange={(value) => updateTradeForm({
                      orderKind: value,
                      orderType: value === 'limit' ? 'GTC' : 'FOK',
                      postOnly: value === 'limit' ? tradeForm.postOnly : 'false',
                    })}
                  >
                    <SelectTrigger className="border-slate-700 bg-slate-800">
                      <SelectValue placeholder="Pilih order kind" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="limit">Limit</SelectItem>
                      <SelectItem value="market">Market</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Order Type</Label>
                  <Select value={tradeForm.orderType} onValueChange={(value) => updateTradeForm({ orderType: value })}>
                    <SelectTrigger className="border-slate-700 bg-slate-800">
                      <SelectValue placeholder="Pilih order type" />
                    </SelectTrigger>
                    <SelectContent>
                      {(tradeForm.orderKind === 'limit' ? ['GTC', 'GTD'] : ['FOK', 'FAK']).map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Worst / Limit Price</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    value={tradeForm.price}
                    onChange={(event) => updateTradeForm({ price: event.target.value })}
                    className="border-slate-700 bg-slate-800"
                    placeholder="0.50"
                  />
                  <p className="text-xs text-slate-500">{tradeForm.orderKind === 'market' ? marketPriceHelpText : 'Untuk limit order, price adalah harga resting order Anda di orderbook.'}</p>
                </div>

                {tradeForm.side === 'BUY' ? (
                  <div className="space-y-2">
                    <Label>Order Amount (USDC)</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      value={tradeForm.orderValue}
                      onChange={(event) => updateTradeForm({ orderValue: event.target.value })}
                      className="border-slate-700 bg-slate-800"
                      placeholder="2"
                    />
                    <p className="text-xs text-slate-500">{orderValueHelpText}</p>
                    <p className="text-xs text-slate-500">{limitSizeHelpText}</p>
                    <p className="text-xs text-emerald-300">{derivedSharesHelpText}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Sell Size / Shares</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      value={tradeForm.sellSize}
                      onChange={(event) => updateTradeForm({ sellSize: event.target.value })}
                      className="border-slate-700 bg-slate-800"
                      placeholder="1"
                    />
                    <p className="text-xs text-slate-500">Balance posisi aktif sekitar ${selectedTokenBalanceDisplay} share. Untuk SELL, input langsung memakai jumlah share.</p>
                    <p className="text-xs text-slate-500">{limitSizeHelpText}</p>
                    <p className="text-xs text-emerald-300">{derivedSharesHelpText}</p>
                  </div>
                )}

                {tradeForm.orderKind === 'limit' && tradeForm.orderType === 'GTD' && (
                  <div className="space-y-2">
                    <Label>Expiration</Label>
                    <Input
                      type="datetime-local"
                      value={tradeForm.expiration}
                      onChange={(event) => updateTradeForm({ expiration: event.target.value })}
                      className="border-slate-700 bg-slate-800"
                    />
                  </div>
                )}

                {tradeForm.orderKind === 'limit' && (
                  <div className="space-y-2">
                    <Label>Post Only</Label>
                    <Select value={tradeForm.postOnly} onValueChange={(value) => updateTradeForm({ postOnly: value })}>
                      <SelectTrigger className="border-slate-700 bg-slate-800">
                        <SelectValue placeholder="Post only" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="false">Tidak</SelectItem>
                        <SelectItem value="true">Ya</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
                <p className="text-slate-500">Market / Outcome</p>
                <p className="mt-1 font-semibold text-white">{tradeForm.marketQuestion || marketDetail?.question || 'Pilih market di panel kiri'}</p>
                <p className="mt-1 text-slate-400">{tradeForm.outcomeLabel || activeOutcomeLabel || '-'}{tradeForm.tokenId ? ` • Token ${tradeForm.tokenId}` : ''}</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={handlePreviewTrade} disabled={previewingTrade || !tradeForm.tokenId || !tradingStatus.hasApiCredentials}>
                  {previewingTrade ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Preview Order
                </Button>
                <Button variant="outline" onClick={() => setTradeDialogOpen(true)} disabled={!orderPreview || placingTrade}>
                  Kirim Order
                </Button>
              </div>

              {orderPreview && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                    <p className="text-xs text-slate-500">Maker Amount</p>
                    <p className="mt-1 text-sm font-semibold text-white">{formatDisplayValue(orderPreview.order?.makerAmount)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                    <p className="text-xs text-slate-500">Taker Amount</p>
                    <p className="mt-1 text-sm font-semibold text-white">{formatDisplayValue(orderPreview.order?.takerAmount)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                    <p className="text-xs text-slate-500">Tick Size</p>
                    <p className="mt-1 text-sm font-semibold text-white">{formatDisplayValue(orderPreview.tickSize)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                    <p className="text-xs text-slate-500">Approval</p>
                    <p className="mt-1 text-sm font-semibold text-white">{orderPreview.requiresApproval ? 'STARTER approval required' : 'Manual submit allowed'}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 md:col-span-2 xl:col-span-4">
                    <p className="text-xs text-slate-500">Interpretasi input</p>
                    <p className="mt-1 text-sm text-white">{tradeForm.side === 'BUY' ? `BUY memakai amount USDC sebagai input utama. Estimasi share saat ini: ${derivedShares !== null ? formatPriceNumber(derivedShares, 6) : '-'} share.` : `SELL memakai size/shares sebagai input utama. Estimasi nilai order saat ini: ${Number(tradeForm.sellSize) > 0 && Number(tradeForm.price) > 0 ? formatPriceNumber(Number(tradeForm.sellSize) * Number(tradeForm.price), 6) : '-'} USDC.`}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="border-slate-800 bg-slate-900">
          <CardHeader>
            <CardTitle>Open Orders</CardTitle>
            <CardDescription>
              Daftar semua open orders aktif dari akun trading Polymarket. Cancel akan menembak endpoint trading nyata, jadi dilakukan satu per satu.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingTradingDesk ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : !tradingSummary?.openOrders?.length ? (
              <p className="text-sm text-slate-400">Belum ada open order aktif.</p>
            ) : tradingSummary.openOrders.map((order) => (
              <div key={order.id} className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-300">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="break-all font-mono text-xs text-slate-400">{formatDisplayValue(order.id)}</p>
                    <p className="mt-1 font-semibold text-white">{formatDisplayValue(order.side)} {formatDisplayValue(order.outcome || order.assetId)}</p>
                  </div>
                  <Button variant="outline" onClick={() => handleCancelOrder(order)} disabled={cancellingOrderId === order.id}>
                    {cancellingOrderId === order.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Cancel
                  </Button>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <p>Price: <span className="text-white">{formatDisplayValue(order.price)}</span></p>
                  <p>Original Size: <span className="text-white">{formatDisplayValue(order.originalSize)}</span></p>
                  <p>Matched: <span className="text-white">{formatDisplayValue(order.sizeMatched)}</span></p>
                  <p>Status: <span className="text-white">{formatDisplayValue(order.status)}</span></p>
                  <p>Type: <span className="text-white">{formatDisplayValue(order.orderType)}</span></p>
                  <p>Dibuat: <span className="text-white">{formatOrderDateTime(order.createdAt)}</span></p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900">
          <CardHeader>
            <CardTitle>Trade Audit</CardTitle>
            <CardDescription>
              Log preview, place, dan cancel order Polymarket untuk workspace ini. Ini fondasi audit trail Fase 6 sebelum monitoring penuh Fase 8.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingTradeAudit ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : tradeAudits.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada audit trading. Buat preview order dulu untuk mulai mengisi log.</p>
            ) : tradeAudits.map((audit) => (
              <div key={audit.id} className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-300">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{formatDisplayValue(audit.action)} • {formatDisplayValue(audit.status)}</p>
                    <p className="mt-1 text-xs text-slate-400">{formatDateTime(audit.createdAt)}</p>
                  </div>
                  {audit.responseOrderId && (
                    <p className="break-all font-mono text-[11px] text-slate-500">{formatDisplayValue(audit.responseOrderId)}</p>
                  )}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <p>Market: <span className="text-white">{formatDisplayValue(audit.marketSlug)}</span></p>
                  <p>Outcome: <span className="text-white">{formatDisplayValue(audit.outcomeLabel)}</span></p>
                  <p>Side: <span className="text-white">{formatDisplayValue(audit.side)}</span></p>
                  <p>Order Type: <span className="text-white">{formatDisplayValue(audit.orderType)}</span></p>
                  <p>Price: <span className="text-white">{formatDisplayValue(audit.price)}</span></p>
                  <p>Size / Amount: <span className="text-white">{formatDisplayValue(audit.size || audit.amount)}</span></p>
                </div>
                {audit.errorMessage && (
                  <p className="mt-3 rounded-lg border border-rose-800/60 bg-rose-950/20 px-3 py-2 text-xs text-rose-200">{formatDisplayValue(audit.errorMessage)}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={tradeDialogOpen} onOpenChange={setTradeDialogOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle>Konfirmasi Order Polymarket</DialogTitle>
            <DialogDescription className="text-slate-400">
              {workspaceTier === 'STARTER'
                ? 'Paket STARTER membutuhkan approval eksplisit. Pastikan preview sudah Anda review sebelum mengirim order nyata.'
                : 'Anda akan mengirim order nyata ke Polymarket. Review ulang semua parameter sebelum lanjut.'}
            </DialogDescription>
          </DialogHeader>

          {orderPreview ? (
            <div className="space-y-3 text-sm text-slate-300">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-slate-500">Market</p>
                  <p className="mt-1 font-semibold text-white">{formatDisplayValue(orderPreview.marketQuestion || orderPreview.marketSlug)}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-slate-500">Outcome</p>
                  <p className="mt-1 font-semibold text-white">{formatDisplayValue(orderPreview.outcomeLabel)}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-slate-500">Order</p>
                  <p className="mt-1 font-semibold text-white">{formatDisplayValue(orderPreview.side)} {formatDisplayValue(orderPreview.orderKind)} {formatDisplayValue(orderPreview.orderType)}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-slate-500">Price</p>
                  <p className="mt-1 font-semibold text-white">{formatDisplayValue(orderPreview.price)}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-slate-500">Size / Amount</p>
                  <p className="mt-1 font-semibold text-white">{formatDisplayValue(orderPreview.size || orderPreview.amount)}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-slate-500">Maker / Taker Amount</p>
                  <p className="mt-1 text-xs font-semibold text-white">{formatDisplayValue(orderPreview.order?.makerAmount)} / {formatDisplayValue(orderPreview.order?.takerAmount)}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-400">Buat preview order dulu sebelum membuka dialog konfirmasi.</p>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTradeDialogOpen(false)} disabled={placingTrade}>Batal</Button>
            <Button onClick={handlePlaceTrade} disabled={!orderPreview || placingTrade}>
              {placingTrade ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Kirim Order Nyata
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
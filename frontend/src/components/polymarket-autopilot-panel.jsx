'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

const DEFAULT_FORM = {
  strategyType: 'PRICE_THRESHOLD_REVERSION',
  sideMode: 'BUY_ONLY',
  referencePriceSource: 'LAST_TRADE',
  buyBelowPrice: '1',
  sellAbovePrice: '',
  orderSizeUsd: '2',
  maxPositionUsd: '10',
  maxOrderSizeUsd: '5',
  maxExposurePerMarketUsd: '10',
  maxTotalExposureUsd: '25',
  maxOpenOrders: '50',
  maxDailyLossUsd: '10',
  maxDailyOrderCount: '100',
  marketCooldownSeconds: '60',
  cancelStaleAfterSeconds: '300',
  maxSlippageBps: '100',
  requirePositiveExpectedValue: 'false',
  allowedTags: '',
  allowedSports: '',
  allowedMarketSlugs: '',
  blockedMarketSlugs: '',
  maxMarketsPerRun: '3',
  minLiquidity: '0',
  minVolume24h: '0',
  excludeNegRisk: 'false',
  excludeClosed: 'true',
  excludeResolved: 'true',
  dryRun: 'true',
  evaluationIntervalSeconds: '300',
  maxRuntimeSeconds: '120',
  cancelStaleOrders: 'true',
};

function toLineValue(items) {
  return Array.isArray(items) ? items.filter(Boolean).join('\n') : '';
}

function toArrayValue(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toNumericString(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function formatDateTime(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return String(value);
  }
}

function formatJsonPreview(value) {
  if (!value) return '-';

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getStatusVariant(status) {
  switch (status) {
    case 'ACTIVE':
    case 'COMPLETED':
      return 'success';
    case 'READY':
    case 'COMPLETED_NO_ACTION':
      return 'outline';
    case 'RUNNING':
      return 'warning';
    case 'PAUSED':
    case 'BLOCKED_BY_GUARDRAIL':
      return 'warning';
    case 'EMERGENCY_STOP':
    case 'FAILED':
      return 'destructive';
    default:
      return 'outline';
  }
}

function getAlertVariant(alert) {
  if (!alert) return 'outline';
  if (alert.status === 'RESOLVED') return 'outline';
  return alert.severity === 'CRITICAL' ? 'destructive' : 'warning';
}

function formatRecommendedAction(value) {
  if (!value) return 'NONE';
  return String(value).replace(/_/g, ' ');
}

function createFormFromConfig(config) {
  if (!config) return DEFAULT_FORM;

  const strategyConfig = config.strategyConfig || {};
  const riskConfig = config.riskConfig || {};
  const marketScope = config.marketScope || {};
  const executionConfig = config.executionConfig || {};

  return {
    strategyType: config.strategyType || DEFAULT_FORM.strategyType,
    sideMode: strategyConfig.sideMode || DEFAULT_FORM.sideMode,
    referencePriceSource: strategyConfig.referencePriceSource || DEFAULT_FORM.referencePriceSource,
    buyBelowPrice: toNumericString(strategyConfig.buyBelowPrice, ''),
    sellAbovePrice: toNumericString(strategyConfig.sellAbovePrice, ''),
    orderSizeUsd: toNumericString(strategyConfig.orderSizeUsd, DEFAULT_FORM.orderSizeUsd),
    maxPositionUsd: toNumericString(strategyConfig.maxPositionUsd, DEFAULT_FORM.maxPositionUsd),
    maxOrderSizeUsd: toNumericString(riskConfig.maxOrderSizeUsd, DEFAULT_FORM.maxOrderSizeUsd),
    maxExposurePerMarketUsd: toNumericString(riskConfig.maxExposurePerMarketUsd, DEFAULT_FORM.maxExposurePerMarketUsd),
    maxTotalExposureUsd: toNumericString(riskConfig.maxTotalExposureUsd, DEFAULT_FORM.maxTotalExposureUsd),
    maxOpenOrders: toNumericString(riskConfig.maxOpenOrders, DEFAULT_FORM.maxOpenOrders),
    maxDailyLossUsd: toNumericString(riskConfig.maxDailyLossUsd, DEFAULT_FORM.maxDailyLossUsd),
    maxDailyOrderCount: toNumericString(riskConfig.maxDailyOrderCount, DEFAULT_FORM.maxDailyOrderCount),
    marketCooldownSeconds: toNumericString(riskConfig.marketCooldownSeconds, DEFAULT_FORM.marketCooldownSeconds),
    cancelStaleAfterSeconds: toNumericString(riskConfig.cancelStaleAfterSeconds, DEFAULT_FORM.cancelStaleAfterSeconds),
    maxSlippageBps: toNumericString(riskConfig.maxSlippageBps, DEFAULT_FORM.maxSlippageBps),
    requirePositiveExpectedValue: String(Boolean(riskConfig.requirePositiveExpectedValue)),
    allowedTags: toLineValue(marketScope.allowedTags),
    allowedSports: toLineValue(marketScope.allowedSports),
    allowedMarketSlugs: toLineValue(marketScope.allowedMarketSlugs),
    blockedMarketSlugs: toLineValue(marketScope.blockedMarketSlugs),
    maxMarketsPerRun: toNumericString(marketScope.maxMarketsPerRun, DEFAULT_FORM.maxMarketsPerRun),
    minLiquidity: toNumericString(marketScope.minLiquidity, DEFAULT_FORM.minLiquidity),
    minVolume24h: toNumericString(marketScope.minVolume24h, DEFAULT_FORM.minVolume24h),
    excludeNegRisk: String(Boolean(marketScope.excludeNegRisk)),
    excludeClosed: String(Boolean(marketScope.excludeClosed)),
    excludeResolved: String(Boolean(marketScope.excludeResolved)),
    dryRun: String(executionConfig.dryRun !== false),
    evaluationIntervalSeconds: toNumericString(executionConfig.evaluationIntervalSeconds, DEFAULT_FORM.evaluationIntervalSeconds),
    maxRuntimeSeconds: toNumericString(executionConfig.maxRuntimeSeconds, DEFAULT_FORM.maxRuntimeSeconds),
    cancelStaleOrders: String(Boolean(executionConfig.cancelStaleOrders)),
  };
}

export default function PolymarketAutopilotPanel({
  workspaceId,
  workspaceTier,
  hasAutopilotSkill,
  autopilotSkillInstalled = false,
}) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [supportedStrategies, setSupportedStrategies] = useState(['PRICE_THRESHOLD_REVERSION']);
  const [config, setConfig] = useState(null);
  const [runs, setRuns] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [contract, setContract] = useState({ liveExecutionEnabled: false });
  const [monitoring, setMonitoring] = useState({
    summary: null,
    latestHealthCheck: null,
    openAlerts: [],
    recentAlerts: [],
  });
  const [validationResult, setValidationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [activating, setActivating] = useState(false);
  const [running, setRunning] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isGrowth = workspaceTier === 'GROWTH';

  function updateForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function buildPayload() {
    return {
      workspaceId,
      strategyType: form.strategyType,
      strategyConfig: {
        sideMode: form.sideMode,
        referencePriceSource: form.referencePriceSource,
        buyBelowPrice: form.buyBelowPrice === '' ? undefined : Number(form.buyBelowPrice),
        sellAbovePrice: form.sellAbovePrice === '' ? undefined : Number(form.sellAbovePrice),
        orderSizeUsd: Number(form.orderSizeUsd),
        maxPositionUsd: Number(form.maxPositionUsd),
      },
      riskConfig: {
        maxOrderSizeUsd: Number(form.maxOrderSizeUsd),
        maxExposurePerMarketUsd: Number(form.maxExposurePerMarketUsd),
        maxTotalExposureUsd: Number(form.maxTotalExposureUsd),
        maxOpenOrders: Number(form.maxOpenOrders),
        maxDailyLossUsd: Number(form.maxDailyLossUsd),
        maxDailyOrderCount: Number(form.maxDailyOrderCount),
        marketCooldownSeconds: Number(form.marketCooldownSeconds),
        cancelStaleAfterSeconds: Number(form.cancelStaleAfterSeconds),
        maxSlippageBps: Number(form.maxSlippageBps),
        requirePositiveExpectedValue: form.requirePositiveExpectedValue === 'true',
      },
      marketScope: {
        allowedTags: toArrayValue(form.allowedTags),
        allowedSports: toArrayValue(form.allowedSports),
        allowedMarketSlugs: toArrayValue(form.allowedMarketSlugs),
        blockedMarketSlugs: toArrayValue(form.blockedMarketSlugs),
        maxMarketsPerRun: Number(form.maxMarketsPerRun),
        minLiquidity: Number(form.minLiquidity),
        minVolume24h: Number(form.minVolume24h),
        excludeNegRisk: form.excludeNegRisk === 'true',
        excludeClosed: form.excludeClosed === 'true',
        excludeResolved: form.excludeResolved === 'true',
      },
      executionConfig: {
        dryRun: form.dryRun === 'true',
        evaluationIntervalSeconds: Number(form.evaluationIntervalSeconds),
        maxRuntimeSeconds: Number(form.maxRuntimeSeconds),
        cancelStaleOrders: form.cancelStaleOrders === 'true',
      },
    };
  }

  async function loadAutopilot(options = {}) {
    const { silent = false } = options;

    if (!workspaceId || !isGrowth || !hasAutopilotSkill) {
      setConfig(null);
      setContract({ liveExecutionEnabled: false });
      setRuns([]);
      setDecisions([]);
      setMonitoring({ summary: null, latestHealthCheck: null, openAlerts: [], recentAlerts: [] });
      setValidationResult(null);
      setForm(DEFAULT_FORM);
      return;
    }

    if (silent) {
      setRefreshingHistory(true);
    } else {
      setLoading(true);
      setError('');
    }

    try {
      const [{ data: configData }, { data: runsData }, { data: decisionsData }, { data: monitoringData }] = await Promise.all([
        api.get('/polymarket/autopilot/config', { params: { workspaceId } }),
        api.get('/polymarket/autopilot/runs', { params: { workspaceId, limit: 8 } }),
        api.get('/polymarket/autopilot/decisions', { params: { workspaceId, limit: 8 } }),
        api.get('/polymarket/autopilot/monitoring', { params: { workspaceId } }),
      ]);

      setSupportedStrategies(Array.isArray(configData.supportedStrategies) && configData.supportedStrategies.length > 0
        ? configData.supportedStrategies
        : ['PRICE_THRESHOLD_REVERSION']);
      setContract(configData.contract || { liveExecutionEnabled: false });
      setConfig(configData.config || null);
      setRuns(Array.isArray(runsData.runs) ? runsData.runs : []);
      setDecisions(Array.isArray(decisionsData.decisions) ? decisionsData.decisions : []);
      setMonitoring({
        summary: monitoringData.summary || null,
        latestHealthCheck: monitoringData.latestHealthCheck || null,
        openAlerts: Array.isArray(monitoringData.openAlerts) ? monitoringData.openAlerts : [],
        recentAlerts: Array.isArray(monitoringData.recentAlerts) ? monitoringData.recentAlerts : [],
      });
      setForm(createFormFromConfig(configData.config || null));
    } catch (err) {
      setConfig(null);
      setContract({ liveExecutionEnabled: false });
      setRuns([]);
      setDecisions([]);
      setMonitoring({ summary: null, latestHealthCheck: null, openAlerts: [], recentAlerts: [] });
      setError(err.response?.data?.message || 'Gagal memuat panel autopilot Growth');
    } finally {
      setLoading(false);
      setRefreshingHistory(false);
    }
  }

  useEffect(() => {
    loadAutopilot();
  }, [workspaceId, workspaceTier, hasAutopilotSkill]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSaveConfig() {
    if (!workspaceId) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = buildPayload();
      const { data } = await api.put('/polymarket/autopilot/config', payload);
      setConfig(data.config || null);
      setForm(createFormFromConfig(data.config || null));
      setValidationResult({
        valid: Boolean(data.valid),
        nextStatus: data.config?.status || null,
        validationErrors: data.validationErrors || [],
      });
      setSuccess(data.message || 'Config autopilot Growth berhasil disimpan.');
      await loadAutopilot({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan config autopilot Growth');
    } finally {
      setSaving(false);
    }
  }

  async function handleValidate() {
    if (!workspaceId) return;

    setValidating(true);
    setError('');
    setSuccess('');

    try {
      const payload = buildPayload();
      const { data } = await api.post('/polymarket/autopilot/validate', payload);
      setValidationResult(data);
      setSuccess(data.valid
        ? (form.dryRun === 'false' ? 'Payload autopilot valid untuk live execution Growth.' : 'Payload autopilot valid untuk dry-run Growth.')
        : 'Payload autopilot masih perlu diperbaiki sebelum bisa diaktifkan.');
    } catch (err) {
      setValidationResult(null);
      setError(err.response?.data?.message || 'Gagal memvalidasi payload autopilot Growth');
    } finally {
      setValidating(false);
    }
  }

  async function handleActivate() {
    if (!workspaceId) return;

    setActivating(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await api.post('/polymarket/autopilot/activate', { workspaceId });
      setSuccess(data.message || (form.dryRun === 'false' ? 'Autopilot Growth aktif dalam mode live execution.' : 'Autopilot Growth aktif dalam mode dry-run.'));
      await loadAutopilot({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal mengaktifkan autopilot Growth');
    } finally {
      setActivating(false);
    }
  }

  async function handleRun() {
    if (!workspaceId) return;

    setRunning(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await api.post('/polymarket/autopilot/run', { workspaceId });
      setSuccess(data.message || 'Dry-run autopilot Growth berhasil diantrikan.');
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await loadAutopilot({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menjalankan dry-run autopilot Growth');
    } finally {
      setRunning(false);
    }
  }

  async function handlePause() {
    if (!workspaceId) return;

    const reason = typeof window !== 'undefined'
      ? window.prompt('Alasan pause autopilot Growth (opsional):', config?.pausedReason || '')
      : '';

    setPausing(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await api.post('/polymarket/autopilot/pause', {
        workspaceId,
        reason: reason || undefined,
      });
      setSuccess(data.message || 'Autopilot Growth dipause.');
      await loadAutopilot({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal mem-pause autopilot Growth');
    } finally {
      setPausing(false);
    }
  }

  async function handleEmergencyStop() {
    if (!workspaceId) return;
    if (typeof window !== 'undefined' && !window.confirm('Aktifkan emergency stop untuk autopilot Growth?')) {
      return;
    }

    const reason = typeof window !== 'undefined'
      ? window.prompt('Catatan emergency stop:', 'Emergency stop manual dari dashboard')
      : 'Emergency stop manual dari dashboard';

    setStopping(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await api.post('/polymarket/autopilot/emergency-stop', {
        workspaceId,
        reason: reason || undefined,
      });
      setSuccess(data.message || 'Emergency stop aktif untuk autopilot Growth.');
      await loadAutopilot({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal mengaktifkan emergency stop autopilot Growth');
    } finally {
      setStopping(false);
    }
  }

  async function handleReconcile() {
    if (!workspaceId) return;

    setReconciling(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await api.post('/polymarket/autopilot/reconcile', { workspaceId });
      setSuccess(
        data.emergencyStopApplied
          ? 'Reconciliation selesai dan emergency stop diterapkan karena drift critical.'
          : `Reconciliation selesai. Recommended action: ${formatRecommendedAction(data.recommendedAction)}.`,
      );
      await loadAutopilot({ silent: true });
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menjalankan reconciliation autopilot Growth');
    } finally {
      setReconciling(false);
    }
  }

  if (!isGrowth) {
    return (
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle>Growth Autopilot</CardTitle>
          <CardDescription>Autopilot Polymarket tetap terkunci untuk paket Growth.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Paket belum memenuhi syarat</AlertTitle>
            <AlertDescription>
              Workspace ini masih <strong>{workspaceTier}</strong>. Upgrade ke Growth jika ingin memakai config, scheduler, dan dry-run autopilot.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!hasAutopilotSkill) {
    return (
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle>Growth Autopilot</CardTitle>
          <CardDescription>UI operator siap, tetapi capability local skill untuk autopilot belum aktif di runtime workspace ini.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{autopilotSkillInstalled ? 'Skill autopilot belum aktif' : 'Skill autopilot belum terpasang'}</AlertTitle>
            <AlertDescription>
              {autopilotSkillInstalled
                ? <>Skill <strong>polymarket-growth-autopilot</strong> sudah terinstall, tetapi belum aktif. Assign ke minimal satu agent di <Link href="/dashboard/skills" className="underline underline-offset-4">halaman Skills</Link> sebelum scheduler atau panel dipakai.</>
                : <>Install built-in skill <strong>polymarket-growth-autopilot</strong> lalu assign ke minimal satu agent di <Link href="/dashboard/skills" className="underline underline-offset-4">halaman Skills</Link> sebelum scheduler atau panel dipakai.</>}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-800 bg-slate-900">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Growth Autopilot</CardTitle>
            <CardDescription>
              Config guardrail, mode eksekusi, riwayat run, dan decision autopilot untuk workspace Growth.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getStatusVariant(config?.status || 'READY')}>
              {config?.status || 'BELUM DIKONFIGURASI'}
            </Badge>
            <Badge variant="outline">Skill local aktif</Badge>
            <Badge variant="outline">
              {contract.liveExecutionEnabled ? (form.dryRun === 'false' ? 'Live mode ready' : 'Dry-run mode') : 'Dry-run only'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="h-auto flex-wrap justify-start gap-2 bg-slate-950 p-1 text-slate-400">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="config">Config</TabsTrigger>
              <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Status config</p>
                  <p className="mt-1 text-lg font-semibold text-white">{config?.status || 'Belum ada'}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Strategi aktif</p>
                  <p className="mt-1 text-lg font-semibold text-white">{config?.strategyType || '-'}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Last validated</p>
                  <p className="mt-1 text-sm font-semibold text-white">{formatDateTime(config?.lastValidatedAt)}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Last run</p>
                  <p className="mt-1 text-sm font-semibold text-white">{formatDateTime(config?.lastRunAt)}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Open critical alerts</p>
                  <p className="mt-1 text-lg font-semibold text-white">{monitoring.summary?.openCriticalCount || 0}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Latest action</p>
                  <p className="mt-1 text-sm font-semibold text-white">{formatRecommendedAction(monitoring.summary?.latestRecommendedAction)}</p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={handleSaveConfig} disabled={saving}>
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      Simpan Config
                    </Button>
                    <Button variant="outline" onClick={handleValidate} disabled={validating}>
                      {validating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Validasi
                    </Button>
                    <Button variant="outline" onClick={handleActivate} disabled={activating}>
                      {activating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                      Activate Autopilot
                    </Button>
                    <Button onClick={handleRun} disabled={running || config?.status !== 'ACTIVE'}>
                      {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
                      Jalankan Sekarang
                    </Button>
                    <Button variant="outline" onClick={handlePause} disabled={pausing || !config}>
                      {pausing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PauseCircle className="mr-2 h-4 w-4" />}
                      Pause
                    </Button>
                    <Button variant="destructive" onClick={handleEmergencyStop} disabled={stopping || !config}>
                      {stopping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />}
                      Emergency Stop
                    </Button>
                    <Button variant="outline" onClick={handleReconcile} disabled={reconciling || !config}>
                      {reconciling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Reconcile
                    </Button>
                  </div>

                  <div className="mt-4 space-y-2 text-sm text-slate-300">
                    <p>Strategi yang saat ini benar-benar siap eksekusi adalah <strong>PRICE_THRESHOLD_REVERSION</strong>.</p>
                    <p>Jika <strong>dryRun=false</strong> dan contract live execution aktif, worker akan mengeksekusi place/cancel order nyata lewat backend. Strategi lain masih akan skip sampai engine-nya diimplementasikan.</p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                  <p className="text-sm font-semibold text-white">Validation Snapshot</p>
                  {validationResult ? (
                    <div className="mt-3 space-y-3 text-sm text-slate-300">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={validationResult.valid ? 'success' : 'warning'}>
                          {validationResult.valid ? 'VALID' : 'PERLU REVISI'}
                        </Badge>
                        {validationResult.nextStatus ? <Badge variant="outline">Next: {validationResult.nextStatus}</Badge> : null}
                      </div>
                      {Array.isArray(validationResult.validationErrors) && validationResult.validationErrors.length > 0 ? (
                        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-yellow-100">
                          {validationResult.validationErrors.map((item) => (
                            <p key={item}>• {item}</p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-slate-400">Tidak ada validation error aktif.</p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-400">Belum ada hasil validasi manual pada sesi ini.</p>
                  )}
                </div>
              </div>

              {runs[0] && (
                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Latest Autopilot Run</p>
                      <p className="text-xs text-slate-500">{formatDateTime(runs[0].createdAt)}</p>
                    </div>
                    <Badge variant={getStatusVariant(runs[0].status)}>{runs[0].status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3 text-sm text-slate-300">
                    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                      <p className="text-slate-500">Markets scanned</p>
                      <p className="mt-1 text-white">{runs[0].summary?.marketsScanned?.length || 0}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                      <p className="text-slate-500">Proposal count</p>
                      <p className="mt-1 text-white">{runs[0].summary?.decisionCounts?.proposed || 0}</p>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                      <p className="text-slate-500">Summary</p>
                      <p className="mt-1 text-white">{runs[0].summary?.message || '-'}</p>
                    </div>
                  </div>
                </div>
              )}

              {monitoring.summary?.openAlertCount > 0 && (
                <Alert variant={monitoring.summary.openCriticalCount > 0 ? 'destructive' : 'default'}>
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle>Monitoring aktif</AlertTitle>
                  <AlertDescription>
                    Ada {monitoring.summary.openAlertCount} alert terbuka untuk autopilot ini. Buka tab Monitoring untuk melihat drift, error history, dan hasil reconciliation terakhir.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            <TabsContent value="monitoring" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Monitoring & Risk Ops</p>
                  <p className="text-xs text-slate-500">Alert persisten, hasil reconciliation terbaru, dan error history untuk operator Growth.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => loadAutopilot({ silent: true })} disabled={refreshingHistory}>
                    {refreshingHistory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Refresh Monitoring
                  </Button>
                  <Button variant="outline" onClick={handleReconcile} disabled={reconciling || !config}>
                    {reconciling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Jalankan Reconcile
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Open alerts</p>
                  <p className="mt-1 text-lg font-semibold text-white">{monitoring.summary?.openAlertCount || 0}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Critical</p>
                  <p className="mt-1 text-lg font-semibold text-white">{monitoring.summary?.openCriticalCount || 0}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Warnings</p>
                  <p className="mt-1 text-lg font-semibold text-white">{monitoring.summary?.openWarningCount || 0}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Failed runs 24h</p>
                  <p className="mt-1 text-lg font-semibold text-white">{monitoring.summary?.failedRunCount24h || 0}</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Last check</p>
                  <p className="mt-1 text-sm font-semibold text-white">{formatDateTime(monitoring.summary?.latestCheckAt)}</p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Latest Reconciliation</p>
                      <p className="text-xs text-slate-500">{formatDateTime(monitoring.latestHealthCheck?.checkedAt)}</p>
                    </div>
                    <Badge variant={getStatusVariant(monitoring.latestHealthCheck?.recommendedAction === 'EMERGENCY_STOP' ? 'EMERGENCY_STOP' : monitoring.latestHealthCheck?.recommendedAction === 'REVIEW' ? 'RUNNING' : 'READY')}>
                      {formatRecommendedAction(monitoring.latestHealthCheck?.recommendedAction)}
                    </Badge>
                  </div>

                  {monitoring.latestHealthCheck ? (
                    <div className="space-y-4 text-sm text-slate-300">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                          <p className="text-slate-500">Trigger</p>
                          <p className="mt-1 text-white">{monitoring.latestHealthCheck.trigger || '-'}</p>
                        </div>
                        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                          <p className="text-slate-500">Open orders</p>
                          <p className="mt-1 text-white">{monitoring.latestHealthCheck.report?.exchange?.openOrderCount || 0}</p>
                        </div>
                        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                          <p className="text-slate-500">Positions</p>
                          <p className="mt-1 text-white">{monitoring.latestHealthCheck.report?.positions?.count || 0}</p>
                        </div>
                        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                          <p className="text-slate-500">Failed audits</p>
                          <p className="mt-1 text-white">{monitoring.latestHealthCheck.report?.audits?.failedActions || 0}</p>
                        </div>
                      </div>

                      {monitoring.latestHealthCheck.emergencyStopApplied && (
                        <Alert variant="destructive">
                          <ShieldAlert className="h-4 w-4" />
                          <AlertTitle>Emergency stop applied</AlertTitle>
                          <AlertDescription>Reconciliation terakhir menerapkan emergency stop otomatis karena drift critical.</AlertDescription>
                        </Alert>
                      )}

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                          <p className="text-sm font-semibold text-white">Critical Reasons</p>
                          {monitoring.latestHealthCheck.report?.drift?.criticalReasons?.length ? monitoring.latestHealthCheck.report.drift.criticalReasons.map((item) => (
                            <div key={item.code} className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-rose-100">
                              <p className="font-medium">{item.code}</p>
                              <pre className="mt-2 overflow-auto text-[11px] leading-5 text-rose-100/90">{formatJsonPreview(item.details)}</pre>
                            </div>
                          )) : <p className="mt-3 text-slate-400">Tidak ada drift critical pada check terakhir.</p>}
                        </div>

                        <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
                          <p className="text-sm font-semibold text-white">Warning Reasons</p>
                          {monitoring.latestHealthCheck.report?.drift?.warningReasons?.length ? monitoring.latestHealthCheck.report.drift.warningReasons.map((item) => (
                            <div key={item.code} className="mt-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-yellow-100">
                              <p className="font-medium">{item.code}</p>
                              <pre className="mt-2 overflow-auto text-[11px] leading-5 text-yellow-100/90">{formatJsonPreview(item.details)}</pre>
                            </div>
                          )) : <p className="mt-3 text-slate-400">Tidak ada warning aktif pada check terakhir.</p>}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">Belum ada health check tersimpan. Jalankan reconcile atau tunggu worker selesai menjalankan dry-run berikutnya.</p>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                    <p className="text-sm font-semibold text-white">Open Alerts</p>
                    {monitoring.openAlerts.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-400">Tidak ada alert terbuka saat ini.</p>
                    ) : monitoring.openAlerts.map((alert) => (
                      <div key={alert.id} className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={getAlertVariant(alert)}>{alert.severity}</Badge>
                            <Badge variant="outline">{alert.code}</Badge>
                          </div>
                          <p className="text-xs text-slate-500">{formatDateTime(alert.lastSeenAt)}</p>
                        </div>
                        <p className="mt-2 font-semibold text-white">{alert.title}</p>
                        <p className="mt-1 text-slate-300">{alert.message}</p>
                        <p className="mt-2 text-xs text-slate-500">Occurrences: {alert.occurrenceCount}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                    <p className="text-sm font-semibold text-white">Recent Alert History</p>
                    {monitoring.recentAlerts.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-400">Belum ada alert history untuk workspace ini.</p>
                    ) : monitoring.recentAlerts.map((alert) => (
                      <div key={alert.id} className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={getAlertVariant(alert)}>{alert.severity}</Badge>
                            <Badge variant="outline">{alert.status}</Badge>
                          </div>
                          <p className="text-xs text-slate-500">{formatDateTime(alert.lastSeenAt)}</p>
                        </div>
                        <p className="mt-2 font-semibold text-white">{alert.title}</p>
                        <p className="mt-1 text-slate-300">{alert.message}</p>
                        <p className="mt-2 text-xs text-slate-500">Resolved: {formatDateTime(alert.resolvedAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="config" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Strategy</Label>
                      <Select value={form.strategyType} onValueChange={(value) => updateForm({ strategyType: value })}>
                        <SelectTrigger className="border-slate-700 bg-slate-800">
                          <SelectValue placeholder="Pilih strategy" />
                        </SelectTrigger>
                        <SelectContent>
                          {supportedStrategies.map((item) => (
                            <SelectItem key={item} value={item}>{item}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Side Mode</Label>
                      <Select value={form.sideMode} onValueChange={(value) => updateForm({ sideMode: value })}>
                        <SelectTrigger className="border-slate-700 bg-slate-800">
                          <SelectValue placeholder="Pilih side mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="BUY_ONLY">BUY_ONLY</SelectItem>
                          <SelectItem value="SELL_ONLY">SELL_ONLY</SelectItem>
                          <SelectItem value="BOTH">BOTH</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Reference Price</Label>
                      <Select value={form.referencePriceSource} onValueChange={(value) => updateForm({ referencePriceSource: value })}>
                        <SelectTrigger className="border-slate-700 bg-slate-800">
                          <SelectValue placeholder="Pilih source" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LAST_TRADE">LAST_TRADE</SelectItem>
                          <SelectItem value="BEST_BID">BEST_BID</SelectItem>
                          <SelectItem value="BEST_ASK">BEST_ASK</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Order Size USD</Label>
                      <Input value={form.orderSizeUsd} onChange={(event) => updateForm({ orderSizeUsd: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Buy Below Price</Label>
                      <Input value={form.buyBelowPrice} onChange={(event) => updateForm({ buyBelowPrice: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Sell Above Price</Label>
                      <Input value={form.sellAbovePrice} onChange={(event) => updateForm({ sellAbovePrice: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Max Position USD</Label>
                      <Input value={form.maxPositionUsd} onChange={(event) => updateForm({ maxPositionUsd: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-white">Market Scope</p>
                    <div className="space-y-2">
                      <Label>Allowed Market Slugs</Label>
                      <Textarea value={form.allowedMarketSlugs} onChange={(event) => updateForm({ allowedMarketSlugs: event.target.value })} className="border-slate-700 bg-slate-800 min-h-[96px]" placeholder="Satu slug per baris" />
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Allowed Tags</Label>
                        <Textarea value={form.allowedTags} onChange={(event) => updateForm({ allowedTags: event.target.value })} className="border-slate-700 bg-slate-800 min-h-[96px]" placeholder="Satu tag per baris" />
                      </div>
                      <div className="space-y-2">
                        <Label>Allowed Sports</Label>
                        <Textarea value={form.allowedSports} onChange={(event) => updateForm({ allowedSports: event.target.value })} className="border-slate-700 bg-slate-800 min-h-[96px]" placeholder="Satu sport per baris" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Blocked Market Slugs</Label>
                      <Textarea value={form.blockedMarketSlugs} onChange={(event) => updateForm({ blockedMarketSlugs: event.target.value })} className="border-slate-700 bg-slate-800 min-h-[80px]" placeholder="Opsional, satu slug per baris" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                  <p className="text-sm font-semibold text-white">Risk & Execution Guardrails</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Max Order Size USD</Label>
                      <Input value={form.maxOrderSizeUsd} onChange={(event) => updateForm({ maxOrderSizeUsd: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Exposure / Market USD</Label>
                      <Input value={form.maxExposurePerMarketUsd} onChange={(event) => updateForm({ maxExposurePerMarketUsd: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Total Exposure USD</Label>
                      <Input value={form.maxTotalExposureUsd} onChange={(event) => updateForm({ maxTotalExposureUsd: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Open Orders</Label>
                      <Input value={form.maxOpenOrders} onChange={(event) => updateForm({ maxOpenOrders: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Daily Loss USD</Label>
                      <Input value={form.maxDailyLossUsd} onChange={(event) => updateForm({ maxDailyLossUsd: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Daily Order Count</Label>
                      <Input value={form.maxDailyOrderCount} onChange={(event) => updateForm({ maxDailyOrderCount: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Market Cooldown Seconds</Label>
                      <Input value={form.marketCooldownSeconds} onChange={(event) => updateForm({ marketCooldownSeconds: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Cancel Stale After Seconds</Label>
                      <Input value={form.cancelStaleAfterSeconds} onChange={(event) => updateForm({ cancelStaleAfterSeconds: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Slippage Bps</Label>
                      <Input value={form.maxSlippageBps} onChange={(event) => updateForm({ maxSlippageBps: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Require Positive EV</Label>
                      <Select value={form.requirePositiveExpectedValue} onValueChange={(value) => updateForm({ requirePositiveExpectedValue: value })}>
                        <SelectTrigger className="border-slate-700 bg-slate-800">
                          <SelectValue placeholder="Pilih mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="false">false</SelectItem>
                          <SelectItem value="true">true</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Max Markets / Run</Label>
                      <Input value={form.maxMarketsPerRun} onChange={(event) => updateForm({ maxMarketsPerRun: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Execution Mode</Label>
                      <Select value={form.dryRun} onValueChange={(value) => updateForm({ dryRun: value })}>
                        <SelectTrigger className="border-slate-700 bg-slate-800">
                          <SelectValue placeholder="Pilih mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">dry-run</SelectItem>
                          <SelectItem value="false" disabled={!contract.liveExecutionEnabled}>live execution</SelectItem>
                        </SelectContent>
                      </Select>
                      {!contract.liveExecutionEnabled ? (
                        <p className="text-xs text-slate-500">Live execution contract belum aktif di backend runtime ini.</p>
                      ) : (
                        <p className="text-xs text-slate-500">Mode live hanya disarankan untuk config Growth yang sudah tervalidasi dan dipantau di tab Monitoring.</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Evaluation Interval Seconds</Label>
                      <Input value={form.evaluationIntervalSeconds} onChange={(event) => updateForm({ evaluationIntervalSeconds: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Runtime Seconds</Label>
                      <Input value={form.maxRuntimeSeconds} onChange={(event) => updateForm({ maxRuntimeSeconds: event.target.value })} className="border-slate-700 bg-slate-800" />
                    </div>
                    <div className="space-y-2">
                      <Label>Cancel Stale Orders</Label>
                      <Select value={form.cancelStaleOrders} onValueChange={(value) => updateForm({ cancelStaleOrders: value })}>
                        <SelectTrigger className="border-slate-700 bg-slate-800">
                          <SelectValue placeholder="Pilih mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">true</SelectItem>
                          <SelectItem value="false">false</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Exclude Neg Risk</Label>
                      <Select value={form.excludeNegRisk} onValueChange={(value) => updateForm({ excludeNegRisk: value })}>
                        <SelectTrigger className="border-slate-700 bg-slate-800">
                          <SelectValue placeholder="Pilih mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">true</SelectItem>
                          <SelectItem value="false">false</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Exclude Closed</Label>
                      <Select value={form.excludeClosed} onValueChange={(value) => updateForm({ excludeClosed: value })}>
                        <SelectTrigger className="border-slate-700 bg-slate-800">
                          <SelectValue placeholder="Pilih mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">true</SelectItem>
                          <SelectItem value="false">false</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Exclude Resolved</Label>
                      <Select value={form.excludeResolved} onValueChange={(value) => updateForm({ excludeResolved: value })}>
                        <SelectTrigger className="border-slate-700 bg-slate-800">
                          <SelectValue placeholder="Pilih mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">true</SelectItem>
                          <SelectItem value="false">false</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Run & Decision History</p>
                  <p className="text-xs text-slate-500">Refresh setelah trigger manual jika ingin melihat proposal terbaru.</p>
                </div>
                <Button variant="outline" onClick={() => loadAutopilot({ silent: true })} disabled={refreshingHistory}>
                  {refreshingHistory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Refresh History
                </Button>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                  <p className="text-sm font-semibold text-white">Recent Runs</p>
                  {runs.length === 0 ? (
                    <p className="text-sm text-slate-400">Belum ada run autopilot untuk workspace ini.</p>
                  ) : runs.map((run) => (
                    <div key={run.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-xs text-slate-400">{run.id}</p>
                        <Badge variant={getStatusVariant(run.status)}>{run.status}</Badge>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">Mulai: {formatDateTime(run.startedAt)}</p>
                      <p className="text-xs text-slate-500">Selesai: {formatDateTime(run.finishedAt)}</p>
                      <p className="mt-2 text-slate-200">{run.summary?.message || 'Belum ada summary run.'}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                  <p className="text-sm font-semibold text-white">Recent Decisions</p>
                  {decisions.length === 0 ? (
                    <p className="text-sm text-slate-400">Belum ada decision autopilot untuk workspace ini.</p>
                  ) : decisions.map((decision) => (
                    <div key={decision.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{decision.decisionType}</Badge>
                          <Badge variant={getStatusVariant(decision.status)}>{decision.status}</Badge>
                        </div>
                        <p className="text-xs text-slate-500">{formatDateTime(decision.createdAt)}</p>
                      </div>
                      <p className="mt-2 break-all text-xs text-slate-400">{decision.marketSlug || '-'}</p>
                      <p className="mt-1 text-slate-200">
                        {decision.side ? `${decision.side} ` : ''}
                        {decision.reasonCode || 'Tanpa reason code'}
                      </p>
                      <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950/90 p-3 text-[11px] leading-5 text-slate-300">
                        {formatJsonPreview(decision.payload)}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
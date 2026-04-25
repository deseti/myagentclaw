'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  CalendarDays,
  CircleAlert,
  Clock3,
  GitBranch,
  LineChart,
  Loader2,
  MessagesSquare,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

const FILTER_ALL_VALUE = 'all';
const DATE_PRESET_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom Range' },
];
const ACTIVITY_OPTIONS = [
  { value: FILTER_ALL_VALUE, label: 'All Activity' },
  { value: 'customer-created', label: 'Customer Created' },
  { value: 'lead-stage-changed', label: 'Lead Stage Changed' },
  { value: 'appointment-created', label: 'Appointment Created' },
  { value: 'appointment-missed', label: 'Appointment Missed' },
  { value: 'payment-reminder-sent', label: 'Payment Reminder Sent' },
  { value: 'broadcast-campaign-sent', label: 'Broadcast Sent' },
  { value: 'broadcast-campaign-delivered', label: 'Broadcast Delivered' },
  { value: 'broadcast-campaign-failed', label: 'Broadcast Failed' },
  { value: 'skill-installed', label: 'Skill Installed' },
  { value: 'agent-assigned-skill', label: 'Agent Assigned Skill' },
  { value: 'conversation-started', label: 'Conversation Started' },
];
const SKILL_TREND_SERIES = [
  { key: 'crmPipeline', label: 'CRM Pipeline' },
  { key: 'broadcastCampaign', label: 'Broadcast Campaign' },
  { key: 'appointmentScheduler', label: 'Appointment Scheduler' },
  { key: 'paymentReminder', label: 'Payment Reminder' },
  { key: 'polymarketReadOnly', label: 'Polymarket Read-Only' },
  { key: 'polymarketGrowthAutopilot', label: 'Polymarket Growth Autopilot' },
  { key: 'analyticsDashboard', label: 'Analytics Dashboard' },
];

function getErrorMessage(error, fallbackMessage) {
  return error?.response?.data?.message || fallbackMessage;
}

function buildAnalyticsParams(workspaceId, filters) {
  return {
    workspaceId,
    preset: filters.preset,
    startDate: filters.preset === 'custom' ? filters.startDate || undefined : undefined,
    endDate: filters.preset === 'custom' ? filters.endDate || undefined : undefined,
    agentId: filters.agentId !== FILTER_ALL_VALUE ? filters.agentId : undefined,
    skillType: filters.skillType !== FILTER_ALL_VALUE ? filters.skillType : undefined,
    activityType: filters.activityType !== FILTER_ALL_VALUE ? filters.activityType : undefined,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value || 0));
}

function formatCurrency(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatDurationMinutes(value) {
  if (value === null || value === undefined) return '-';
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '-';
  if (numericValue < 60) return `${numericValue.toFixed(1)} min`;
  return `${(numericValue / 60).toFixed(1)} hr`;
}

function StatusBadge({ label, tone = 'default' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
        tone === 'success' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
        tone === 'warning' && 'border-amber-500/40 bg-amber-500/10 text-amber-200',
        tone === 'danger' && 'border-red-500/40 bg-red-500/10 text-red-200',
        tone === 'info' && 'border-sky-500/40 bg-sky-500/10 text-sky-200',
        tone === 'default' && 'border-slate-700 bg-slate-900/70 text-slate-200',
      )}
    >
      {label}
    </span>
  );
}

function KpiCard({ label, value, helper, icon: Icon, tone = 'default' }) {
  return (
    <Card className="overflow-hidden border-slate-800 bg-slate-900/90">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
            <p className="mt-2 text-sm text-slate-400">{helper}</p>
          </div>
          <div
            className={cn(
              'rounded-2xl border p-3',
              tone === 'success' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
              tone === 'warning' && 'border-amber-500/30 bg-amber-500/10 text-amber-200',
              tone === 'info' && 'border-sky-500/30 bg-sky-500/10 text-sky-200',
              tone === 'default' && 'border-slate-700 bg-slate-950/70 text-slate-200',
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionCard({ title, description, action, children, className }) {
  return (
    <Card className={cn('border-slate-800 bg-slate-900/85', className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-slate-400">{description}</p>
          </div>
          {action}
        </div>
        <div className="mt-5">{children}</div>
      </CardContent>
    </Card>
  );
}

function MiniBars({ points = [], primaryKey = 'value', secondaryKey = null, primaryColor = 'bg-sky-400', secondaryColor = 'bg-emerald-400', valueFormatter }) {
  const maxValue = Math.max(
    ...points.flatMap((point) => [Number(point?.[primaryKey] || 0), secondaryKey ? Number(point?.[secondaryKey] || 0) : 0]),
    1,
  );

  if (!points.length) {
    return <p className="text-sm text-slate-500">Belum ada data pada rentang filter ini.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max items-end gap-3 pb-2">
        {points.map((point) => {
          const primaryValue = Number(point?.[primaryKey] || 0);
          const secondaryValue = secondaryKey ? Number(point?.[secondaryKey] || 0) : 0;
          return (
            <div key={point.key || point.label} className="w-10 shrink-0 text-center">
              <div className="flex h-32 items-end justify-center gap-1 rounded-2xl border border-slate-800 bg-slate-950/70 px-2 py-3">
                <div
                  className={cn('w-2 rounded-full', primaryColor)}
                  style={{ height: `${Math.max(6, (primaryValue / maxValue) * 100)}%` }}
                  title={valueFormatter ? valueFormatter(primaryValue) : primaryValue}
                />
                {secondaryKey ? (
                  <div
                    className={cn('w-2 rounded-full', secondaryColor)}
                    style={{ height: `${Math.max(6, (secondaryValue / maxValue) * 100)}%` }}
                    title={valueFormatter ? valueFormatter(secondaryValue) : secondaryValue}
                  />
                ) : null}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">{point.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RankedList({ rows = [], labelKey = 'label', valueKey = 'value', formatter = formatNumber, helperRenderer = null }) {
  const maxValue = Math.max(...rows.map((row) => Number(row?.[valueKey] || 0)), 1);

  if (!rows.length) {
    return <p className="text-sm text-slate-500">Belum ada data untuk ditampilkan.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.id || row.skillKey || row.stageId || row[labelKey]} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-slate-100">{row[labelKey]}</span>
            <span className="shrink-0 text-slate-400">{formatter(row[valueKey])}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-800">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-sky-400 to-emerald-400"
              style={{ width: `${Math.max(8, (Number(row[valueKey] || 0) / maxValue) * 100)}%` }}
            />
          </div>
          {helperRenderer ? <div className="text-xs text-slate-500">{helperRenderer(row)}</div> : null}
        </div>
      ))}
    </div>
  );
}

function Timeline({ items = [] }) {
  if (!items.length) {
    return <p className="text-sm text-slate-500">Belum ada activity pada rentang ini.</p>;
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id} className="relative pl-6">
          <div className="absolute left-0 top-1 h-3 w-3 rounded-full border border-sky-400/40 bg-sky-400/20" />
          <div className="absolute left-[5px] top-4 h-full w-px bg-slate-800 last:hidden" />
          <p className="text-sm font-medium text-white">{item.title}</p>
          <p className="mt-1 text-sm text-slate-400">{item.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
            <span>{formatDateTime(item.occurredAt)}</span>
            {item.agentName ? <span>{item.agentName}</span> : null}
            {item.skillType ? <span>{item.skillType}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function SkillTrendMatrix({ points = [] }) {
  if (!points.length) {
    return <p className="text-sm text-slate-500">Belum ada data trend skill pada rentang ini.</p>;
  }

  return (
    <div className="space-y-4">
      {SKILL_TREND_SERIES.map((series) => {
        const maxValue = Math.max(...points.map((point) => Number(point?.[series.key] || 0)), 1);
        const totalValue = points.reduce((sum, point) => sum + Number(point?.[series.key] || 0), 0);

        return (
          <div key={series.key} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-100">{series.label}</span>
              <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{formatNumber(totalValue)} events</span>
            </div>
            <div className="flex items-end gap-1 overflow-x-auto">
              {points.map((point) => (
                <div key={`${series.key}-${point.key}`} className="flex w-4 shrink-0 flex-col items-center gap-2">
                  <div className="flex h-14 w-full items-end rounded-full bg-slate-900/80">
                    <div
                      className="w-full rounded-full bg-gradient-to-t from-sky-500 to-emerald-400"
                      style={{ height: `${Math.max(6, (Number(point?.[series.key] || 0) / maxValue) * 100)}%` }}
                      title={`${series.label}: ${formatNumber(point?.[series.key] || 0)} on ${point.label}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadingDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-36 animate-pulse rounded-3xl border border-slate-800 bg-slate-900/80" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="h-80 animate-pulse rounded-3xl border border-slate-800 bg-slate-900/80 xl:col-span-2" />
        <div className="h-80 animate-pulse rounded-3xl border border-slate-800 bg-slate-900/80" />
      </div>
      <div className="h-96 animate-pulse rounded-3xl border border-slate-800 bg-slate-900/80" />
    </div>
  );
}

function ActivationState({ status }) {
  return (
    <SectionCard
      title="Analytics Dashboard Installed, Waiting for Activation"
      description="Sidebar sudah tersedia karena skill terinstall. Untuk menyalakan semua widget analytics, assign skill ini ke minimal satu agent Approval Required."
      action={<StatusBadge label="setup required" tone="warning" />}
      className="border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-slate-900/90 to-slate-950"
    >
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Activation Checklist</h3>
          <div className="mt-4 space-y-3 text-sm text-slate-300">
            <p>1. Buka halaman agent dan pilih agent dengan access mode Approval Required.</p>
            <p>2. Aktifkan skill Analytics Dashboard pada agent tersebut.</p>
            <p>3. Nyalakan capability yang dibutuhkan seperti revenue, broadcast, appointment, atau payment analytics sesuai tier workspace.</p>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/dashboard/agents">
              <Button>Open Agents</Button>
            </Link>
            <Link href="/dashboard/skills">
              <Button variant="outline" className="border-slate-700 bg-slate-900/70 text-slate-100 hover:bg-slate-800">
                Review Skill Setup
              </Button>
            </Link>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Current Status</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Assigned Agents</p>
              <p className="mt-2 text-2xl font-semibold text-white">{formatNumber(status?.skillStatus?.assignedCount)}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Enabled Tier</p>
              <p className="mt-2 text-2xl font-semibold text-white">{status?.tierAccess?.tier || 'STARTER'}</p>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

export default function AnalyticsDashboardPage() {
  const [workspaceId, setWorkspaceId] = useState(null);
  const [status, setStatus] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingBundle, setLoadingBundle] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [bundleError, setBundleError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [filters, setFilters] = useState({
    preset: '30d',
    startDate: '',
    endDate: '',
    agentId: FILTER_ALL_VALUE,
    skillType: FILTER_ALL_VALUE,
    activityType: FILTER_ALL_VALUE,
  });

  const customRangeReady = filters.preset !== 'custom' || (filters.startDate && filters.endDate);

  useEffect(() => {
    let cancelled = false;

    setLoadingStatus(true);
    setStatusError('');

    api.get('/auth/me')
      .then(({ data }) => {
        if (cancelled) return;
        const nextWorkspaceId = data.workspace?.id || null;
        if (!nextWorkspaceId) {
          throw new Error('Workspace tidak ditemukan untuk owner ini.');
        }
        setWorkspaceId(nextWorkspaceId);
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusError(getErrorMessage(error, 'Gagal memuat konteks workspace analytics.'));
          setLoadingStatus(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!workspaceId) {
      return undefined;
    }

    setLoadingStatus(true);
    setStatusError('');

    api.get('/analytics/status', {
      params: { workspaceId },
    })
      .then(({ data }) => {
        if (cancelled) return;
        setStatus(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(null);
          setStatusError(getErrorMessage(error, 'Gagal memuat status Analytics Dashboard.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingStatus(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshVersion]);

  useEffect(() => {
    let cancelled = false;

    if (!workspaceId || !status?.skillStatus?.active) {
      setBundle(null);
      setLoadingBundle(false);
      setBundleError('');
      return undefined;
    }

    if (!customRangeReady) {
      setBundle(null);
      setLoadingBundle(false);
      setBundleError('Pilih start date dan end date untuk custom range.');
      return undefined;
    }

    setLoadingBundle(true);
    setBundleError('');

    api.get('/analytics/dashboard-data', {
      params: buildAnalyticsParams(workspaceId, filters),
    })
      .then(({ data }) => {
        if (cancelled) return;
        setBundle(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setBundle(null);
          setBundleError(getErrorMessage(error, 'Gagal memuat data dashboard analytics.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBundle(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, status?.skillStatus?.active, filters, refreshVersion, customRangeReady]);

  const handleRefresh = () => {
    setRefreshVersion((current) => current + 1);
  };

  const availableAgents = status?.availableAgents || [];
  const availableSkills = (status?.availableSkills || []).filter((skill) => skill.installed || skill.skillKey === 'analytics-dashboard');
  const tierAccess = bundle?.tierAccess || status?.tierAccess || {};
  const capabilityCoverage = bundle?.capabilityCoverage || status?.capabilityCoverage || {};
  const summary = bundle?.summary || {};
  const workspaceSummary = bundle?.workspaceSummary || status?.workspaceSummary || {};
  const recentActivity = bundle?.recentActivity || [];
  const topAgents = bundle?.topAgents || { agents: [] };
  const topSkills = bundle?.topSkills || { skills: [] };
  const revenueEstimate = bundle?.revenueEstimate || {};
  const leadConversion = bundle?.leadConversion || {};
  const broadcastPerformance = bundle?.broadcastPerformance || {};
  const appointmentPerformance = bundle?.appointmentPerformance || {};
  const paymentPerformance = bundle?.paymentPerformance || {};
  const charts = bundle?.charts || {};

  const pageError = statusError || bundleError;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 xl:px-8">
        <section className="relative overflow-hidden rounded-[2rem] border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.2),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.18),_transparent_30%),linear-gradient(180deg,_rgba(15,23,42,0.96),_rgba(2,6,23,0.98))] p-6 sm:p-8">
          <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(148,163,184,0.04)_50%,transparent_100%)]" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={status?.skillStatus?.installed ? 'installed' : 'not installed'} tone={status?.skillStatus?.installed ? 'info' : 'danger'} />
                <StatusBadge label={status?.skillStatus?.active ? 'active' : 'inactive'} tone={status?.skillStatus?.active ? 'success' : 'warning'} />
                <StatusBadge label={`${workspaceSummary.subscriptionTier || status?.tierAccess?.tier || 'STARTER'} tier`} tone="default" />
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Analytics Dashboard</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                KPI workspace, trend lintas skill, recent activity, performa agent, dan estimasi revenue untuk operasi internal MyAgentClaw.
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                <span>Workspace: <span className="text-slate-200">{workspaceSummary.workspaceName || '-'}</span></span>
                <span>Assigned analytics agents: <span className="text-slate-200">{formatNumber(status?.skillStatus?.assignedCount)}</span></span>
                <span>Usage snapshots: <span className="text-slate-200">{formatNumber(status?.skillStatus?.usageCount)}</span></span>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={handleRefresh}
                variant="outline"
                className="border-slate-700 bg-slate-950/60 text-slate-100 hover:bg-slate-900"
                disabled={loadingStatus || loadingBundle}
              >
                {loadingStatus || loadingBundle ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
              <Link href="/dashboard/agents">
                <Button className="bg-sky-500 text-slate-950 hover:bg-sky-400">Manage Agent Access</Button>
              </Link>
            </div>
          </div>

          <div className="relative mt-8 grid gap-4 rounded-[1.5rem] border border-slate-800 bg-slate-950/60 p-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2 xl:col-span-1">
              <Label htmlFor="analytics-preset" className="text-xs uppercase tracking-[0.18em] text-slate-500">Date Range</Label>
              <Select value={filters.preset} onValueChange={(value) => setFilters((current) => ({ ...current, preset: value }))}>
                <SelectTrigger id="analytics-preset" className="border-slate-700 bg-slate-900/90 text-slate-100">
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent>
                  {DATE_PRESET_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {filters.preset === 'custom' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="analytics-start-date" className="text-xs uppercase tracking-[0.18em] text-slate-500">Start Date</Label>
                  <Input
                    id="analytics-start-date"
                    type="date"
                    value={filters.startDate}
                    onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
                    className="border-slate-700 bg-slate-900/90 text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="analytics-end-date" className="text-xs uppercase tracking-[0.18em] text-slate-500">End Date</Label>
                  <Input
                    id="analytics-end-date"
                    type="date"
                    value={filters.endDate}
                    onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
                    className="border-slate-700 bg-slate-900/90 text-slate-100"
                  />
                </div>
              </>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="analytics-agent-filter" className="text-xs uppercase tracking-[0.18em] text-slate-500">Agent</Label>
              <Select value={filters.agentId} onValueChange={(value) => setFilters((current) => ({ ...current, agentId: value }))}>
                <SelectTrigger id="analytics-agent-filter" className="border-slate-700 bg-slate-900/90 text-slate-100">
                  <SelectValue placeholder="All agents" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL_VALUE}>All agents</SelectItem>
                  {availableAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="analytics-skill-filter" className="text-xs uppercase tracking-[0.18em] text-slate-500">Skill</Label>
              <Select value={filters.skillType} onValueChange={(value) => setFilters((current) => ({ ...current, skillType: value }))}>
                <SelectTrigger id="analytics-skill-filter" className="border-slate-700 bg-slate-900/90 text-slate-100">
                  <SelectValue placeholder="All skills" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL_VALUE}>All skills</SelectItem>
                  {availableSkills.map((skill) => (
                    <SelectItem key={skill.skillKey} value={skill.skillKey}>{skill.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="analytics-activity-filter" className="text-xs uppercase tracking-[0.18em] text-slate-500">Timeline Focus</Label>
              <Select value={filters.activityType} onValueChange={(value) => setFilters((current) => ({ ...current, activityType: value }))}>
                <SelectTrigger id="analytics-activity-filter" className="border-slate-700 bg-slate-900/90 text-slate-100">
                  <SelectValue placeholder="All activity" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {pageError ? (
          <Alert className="border-red-500/30 bg-red-500/10 text-red-50">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Analytics unavailable</AlertTitle>
            <AlertDescription>{pageError}</AlertDescription>
          </Alert>
        ) : null}

        {loadingStatus ? <LoadingDashboard /> : null}

        {!loadingStatus && status?.skillStatus?.installed && !status?.skillStatus?.active ? <ActivationState status={status} /> : null}

        {!loadingStatus && status?.skillStatus?.active && loadingBundle ? <LoadingDashboard /> : null}

        {!loadingStatus && status?.skillStatus?.active && !loadingBundle && bundle ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Conversations"
                value={formatNumber(summary.totalConversations)}
                helper={`${formatNumber(summary.totalCustomers)} customers in scope`}
                icon={MessagesSquare}
                tone="info"
              />
              <KpiCard
                label="Lead + Pipeline"
                value={formatNumber(summary.totalLeads)}
                helper={`${formatCurrency(summary.totalPipelineValue)} open pipeline value`}
                icon={GitBranch}
                tone="warning"
              />
              <KpiCard
                label="Appointments"
                value={formatNumber(summary.totalAppointments)}
                helper={`${formatPercent(appointmentPerformance.completionRate)} completion rate`}
                icon={CalendarDays}
                tone="success"
              />
              <KpiCard
                label="Broadcasts"
                value={formatNumber(summary.totalBroadcasts)}
                helper={`${formatPercent(broadcastPerformance.deliveryRate)} delivery rate`}
                icon={RadioTower}
                tone="info"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
              <SectionCard
                title="Workspace Summary"
                description="Snapshot operasional workspace untuk rentang filter aktif."
                action={<StatusBadge label={`cache ${bundle.meta?.cache?.hit ? 'hit' : 'refresh'}`} tone={bundle.meta?.cache?.hit ? 'success' : 'info'} />}
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Active Agents</p>
                    <p className="mt-3 text-3xl font-semibold text-white">{formatNumber(summary.totalActiveAgents)}</p>
                    <p className="mt-2 text-sm text-slate-400">Installed skills active: {formatNumber(summary.totalActiveSkills)}</p>
                  </div>
                  <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Revenue Estimate</p>
                    <p className="mt-3 text-3xl font-semibold text-white">{formatCurrency(revenueEstimate.estimatedRevenue)}</p>
                    <p className="mt-2 text-sm text-slate-400">Paid revenue: {formatCurrency(revenueEstimate.paidRevenue)}</p>
                  </div>
                  <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Lead Conversion</p>
                    <p className="mt-3 text-3xl font-semibold text-white">{formatPercent(leadConversion.conversionRate)}</p>
                    <p className="mt-2 text-sm text-slate-400">Won leads: {formatNumber(leadConversion.wonLeads)}</p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Tier + Capability"
                description="Analytics access yang aktif mengikuti tier workspace dan konfigurasi agent."
                action={<StatusBadge label={tierAccess.tier || 'starter'} tone="default" />}
              >
                <div className="space-y-3">
                  {(tierAccess.enabledCapabilities || []).map((capability) => (
                    <div key={capability} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-100">{capability}</p>
                        <p className="text-xs text-slate-500">Assigned agents with access: {formatNumber(capabilityCoverage?.[capability]?.assignedAgents)}</p>
                      </div>
                      <ShieldCheck className="h-4 w-4 text-emerald-300" />
                    </div>
                  ))}
                  {!(tierAccess.enabledCapabilities || []).length ? (
                    <p className="text-sm text-slate-500">Tier ini baru membuka capability dasar Analytics Dashboard.</p>
                  ) : null}
                </div>
              </SectionCard>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <SectionCard title="Conversation Trend" description="Volume percakapan per hari pada rentang filter aktif.">
                <MiniBars points={charts.conversationTrend || []} />
              </SectionCard>
              <SectionCard title="Customer Growth" description="Pertumbuhan customer baru dan total kumulatif.">
                <MiniBars points={charts.customerGrowth || []} primaryKey="newValue" primaryColor="bg-emerald-400" />
              </SectionCard>
              <SectionCard title="Broadcast Sent vs Delivered" description="Perbandingan recipient terkirim dan delivered per hari.">
                <MiniBars points={charts.broadcastSentVsDelivered || []} primaryKey="sent" secondaryKey="delivered" primaryColor="bg-sky-400" secondaryColor="bg-emerald-400" />
              </SectionCard>
              <SectionCard title="Appointments Created vs Completed" description="Monitoring volume appointment dan penyelesaian.">
                <MiniBars points={charts.appointmentCreatedVsCompleted || []} primaryKey="created" secondaryKey="completed" primaryColor="bg-amber-400" secondaryColor="bg-emerald-400" />
              </SectionCard>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
              <SectionCard title="Revenue Estimate Trend" description="Gabungan weighted pipeline, closed won, dan paid revenue.">
                <MiniBars points={charts.revenueEstimateTrend || []} primaryKey="estimatedRevenue" primaryColor="bg-emerald-400" valueFormatter={formatCurrency} />
              </SectionCard>
              <SectionCard title="Top Performing Agents" description="Peringkat agent berdasarkan performa lintas conversations, conversion, appointment, dan campaign.">
                <RankedList
                  rows={topAgents.agents || []}
                  labelKey="name"
                  valueKey="performanceScore"
                  formatter={(value) => value.toFixed(2)}
                  helperRenderer={(row) => `${formatNumber(row.totalCustomersHandled)} customers handled • ${formatDurationMinutes(row.averageResponseTimeMinutes)} avg response`}
                />
              </SectionCard>
              <SectionCard title="Top Used Skills" description="Perbandingan penggunaan skill internal yang paling aktif di workspace.">
                <RankedList
                  rows={topSkills.skills || []}
                  labelKey="displayName"
                  valueKey="totalUsage"
                  helperRenderer={(row) => `${formatNumber(row.totalActiveAgents)} assigned agents`}
                />
              </SectionCard>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
              <SectionCard title="Recent Activity Timeline" description="Feed aktivitas terbaru lintas customer, lead, appointment, reminder, broadcast, skill, dan conversation.">
                <Timeline items={recentActivity.slice(0, 14)} />
              </SectionCard>

              <div className="space-y-4">
                <SectionCard title="Top CRM Stages" description="Distribusi lead aktif berdasarkan stage pipeline.">
                  <RankedList
                    rows={bundle.topCrmStages || []}
                    labelKey="label"
                    valueKey="totalLeads"
                    helperRenderer={(row) => `${formatCurrency(row.totalValue)} value • ${formatPercent(row.share)} share`}
                  />
                </SectionCard>

                <SectionCard title="Usage Trend by Skill" description="Intensitas penggunaan workflow internal per hari.">
                  <SkillTrendMatrix points={charts.usageTrendBySkill || []} />
                </SectionCard>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              <SectionCard title="Agent Performance" description="Highlight agent terbaik dan agent paling aktif.">
                <div className="space-y-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Top Performing</p>
                    <p className="mt-2 text-lg font-semibold text-white">{topAgents.topPerformingAgent?.name || '-'}</p>
                    <p className="mt-1 text-sm text-slate-400">Score {topAgents.topPerformingAgent?.performanceScore?.toFixed?.(2) || '0.00'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Most Active</p>
                    <p className="mt-2 text-lg font-semibold text-white">{topAgents.mostActiveAgent?.name || '-'}</p>
                    <p className="mt-1 text-sm text-slate-400">{formatNumber(topAgents.mostActiveAgent?.totalConversationsHandled)} conversations handled</p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Broadcast Performance" description="Ringkasan delivery dan failure rate campaign.">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between text-slate-300"><span>Campaigns</span><span>{formatNumber(broadcastPerformance.totalCampaigns)}</span></div>
                  <div className="flex items-center justify-between text-slate-300"><span>Sent</span><span>{formatNumber(broadcastPerformance.totalSent)}</span></div>
                  <div className="flex items-center justify-between text-slate-300"><span>Delivered</span><span>{formatNumber(broadcastPerformance.totalDelivered)}</span></div>
                  <div className="flex items-center justify-between text-slate-300"><span>Failure Rate</span><span>{formatPercent(broadcastPerformance.failureRate)}</span></div>
                </div>
              </SectionCard>

              <SectionCard title="Appointment Performance" description="Volume, completion rate, dan missed rate.">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between text-slate-300"><span>Created</span><span>{formatNumber(appointmentPerformance.totalCreated)}</span></div>
                  <div className="flex items-center justify-between text-slate-300"><span>Completed</span><span>{formatNumber(appointmentPerformance.completed)}</span></div>
                  <div className="flex items-center justify-between text-slate-300"><span>Missed</span><span>{formatNumber(appointmentPerformance.missed)}</span></div>
                  <div className="flex items-center justify-between text-slate-300"><span>Completion Rate</span><span>{formatPercent(appointmentPerformance.completionRate)}</span></div>
                </div>
              </SectionCard>

              <SectionCard title="Payment Reminder" description="Status reminder terkirim, gagal, dan pending.">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between text-slate-300"><span>Total</span><span>{formatNumber(paymentPerformance.totalCreated)}</span></div>
                  <div className="flex items-center justify-between text-slate-300"><span>Sent</span><span>{formatNumber(paymentPerformance.sent)}</span></div>
                  <div className="flex items-center justify-between text-slate-300"><span>Failed</span><span>{formatNumber(paymentPerformance.failed)}</span></div>
                  <div className="flex items-center justify-between text-slate-300"><span>Send Rate</span><span>{formatPercent(paymentPerformance.sendRate)}</span></div>
                </div>
              </SectionCard>
            </div>

            {!tierAccess.supportsRevenueAnalytics || !tierAccess.supportsAgentPerformance ? (
              <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-50">
                <Sparkles className="h-4 w-4" />
                <AlertTitle>Tier-limited analytics</AlertTitle>
                <AlertDescription>
                  Starter hanya membuka KPI dasar. Growth membuka chart lanjutan operational analytics. Pro membuka revenue analytics penuh, agent performance lengkap, dan forecasting-ready data.
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
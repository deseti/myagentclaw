'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowRightLeft,
  BarChart3,
  Briefcase,
  CalendarDays,
  CircleAlert,
  Clock3,
  DollarSign,
  GitBranch,
  ListX,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  StickyNote,
  Trash2,
  Undo2,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import api from '@/lib/api';
import {
  CRM_PRIORITY_OPTIONS,
  formatCrmCurrency,
  formatCrmDate,
  formatCrmRelativeTime,
  getCrmActivityLabel,
  getCrmPriorityTone,
  getCrmStageAccent,
} from '@/lib/crmPipeline';
import {
  getInstalledInternalSkill,
  INTERNAL_SKILL_KEYS,
  isInternalSkillActive,
} from '@/lib/internalSkills';
import { cn } from '@/lib/utils';

const FILTER_ALL_VALUE = 'all';
const DEFAULT_STAGE_COLOR = '#2563eb';
const REFRESH_INTERVAL_MS = 60_000;
const STORAGE_KEY_PIPELINE = 'crm_selected_pipeline_id';

function createToastId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getErrorMessage(error, fallbackMessage) {
  return error?.response?.data?.message || fallbackMessage;
}

function toDateInputValue(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
}

function buildApiFilters(workspaceId, pipelineId, filters) {
  return {
    workspaceId,
    pipelineId: pipelineId || undefined,
    assignedAgentId: filters.assignedAgentId !== FILTER_ALL_VALUE ? filters.assignedAgentId : undefined,
    stageId: filters.stageId !== FILTER_ALL_VALUE ? filters.stageId : undefined,
    priority: filters.priority !== FILTER_ALL_VALUE ? filters.priority : undefined,
    source: filters.source !== FILTER_ALL_VALUE ? filters.source : undefined,
    search: filters.search.trim() || undefined,
  };
}

function buildDefaultEntryForm(pipelineId = '', stageId = '') {
  return {
    customerId: '',
    pipelineId,
    stageId,
    assignedAgentId: FILTER_ALL_VALUE,
    title: '',
    valueAmount: '',
    currency: 'IDR',
    priority: 'MEDIUM',
    expectedCloseDate: '',
    source: '',
    notes: '',
  };
}

function ToastStack({ toasts }) {
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[80] space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'max-w-sm rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur',
            toast.variant === 'danger'
              ? 'border-red-500/40 bg-red-500/15 text-red-50'
              : toast.variant === 'warning'
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-50'
                : 'border-sky-500/30 bg-slate-900/90 text-slate-100',
          )}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

function StatsCard({ label, value, helper, icon: Icon, accentClass }) {
  return (
    <Card className={cn('overflow-hidden border-slate-800 bg-slate-900/85', accentClass)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
            <p className="mt-2 text-sm text-slate-400">{helper}</p>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-3">
            <Icon className="h-5 w-5 text-slate-200" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniBarChart({ title, subtitle, data = [], formatValue }) {
  const maxValue = Math.max(...data.map((item) => Number(item.value || 0)), 1);

  return (
    <Card className="border-slate-800 bg-slate-900/85">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
          </div>
          <BarChart3 className="h-5 w-5 text-slate-500" />
        </div>

        <div className="mt-5 space-y-3">
          {data.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada data untuk ditampilkan.</p>
          ) : (
            data.map((item) => (
              <div key={item.stageId || item.label} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-slate-200">{item.label}</span>
                  <span className="text-slate-400">
                    {formatValue ? formatValue(item.value) : item.value}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-800">
                  <div
                    className="h-2 rounded-full bg-sky-400"
                    style={{ width: `${Math.max(8, (Number(item.value || 0) / maxValue) * 100)}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TrendBars({ data = [] }) {
  const maxValue = Math.max(
    ...data.flatMap((item) => [Number(item.created || 0), Number(item.won || 0), Number(item.lost || 0)]),
    1,
  );

  return (
    <Card className="border-slate-800 bg-slate-900/85">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-white">Conversion Trend</h3>
            <p className="mt-1 text-sm text-slate-400">Lead created, won, dan lost per bulan.</p>
          </div>
          <TrendingUp className="h-5 w-5 text-slate-500" />
        </div>

        <div className="mt-6 grid grid-cols-6 gap-3">
          {data.map((point) => (
            <div key={point.key} className="flex min-w-0 flex-col items-center gap-2">
              <div className="flex h-40 w-full items-end justify-center gap-1 rounded-2xl border border-slate-800 bg-slate-950/70 px-2 py-3">
                <div
                  className="w-2 rounded-full bg-slate-500"
                  style={{ height: `${Math.max(6, (Number(point.created || 0) / maxValue) * 100)}%` }}
                  title={`Created: ${point.created}`}
                />
                <div
                  className="w-2 rounded-full bg-emerald-400"
                  style={{ height: `${Math.max(6, (Number(point.won || 0) / maxValue) * 100)}%` }}
                  title={`Won: ${point.won}`}
                />
                <div
                  className="w-2 rounded-full bg-red-400"
                  style={{ height: `${Math.max(6, (Number(point.lost || 0) / maxValue) * 100)}%` }}
                  title={`Lost: ${point.lost}`}
                />
              </div>
              <span className="text-xs text-slate-400">{point.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function LeadCard({ entry, onOpen }) {
  const accentColor = getCrmStageAccent(entry.stage);

  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', entry.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onOpen(entry)}
      className="group w-full rounded-2xl border border-slate-800 bg-slate-950/85 p-4 text-left transition hover:border-slate-600 hover:bg-slate-950"
      style={{ boxShadow: `inset 0 1px 0 ${accentColor}55` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{entry.customer?.name || entry.title}</p>
          <p className="mt-1 truncate text-xs text-slate-500">{entry.title}</p>
        </div>
        <div className="rounded-full border border-slate-800 bg-slate-900/80 p-1 text-slate-500">
          <GripVertical className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant={getCrmPriorityTone(entry.priority)}>{entry.priority}</Badge>
        {entry.flags?.isOverdue && <Badge variant="destructive">Overdue</Badge>}
        {entry.flags?.isStale && <Badge variant="warning">Stale</Badge>}
      </div>

      <div className="mt-4 space-y-2 text-sm text-slate-300">
        <div className="flex items-center gap-2 text-slate-400">
          <UserRound className="h-4 w-4" />
          <span className="truncate">{entry.assignedAgent?.name || 'Belum ada agent'}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <DollarSign className="h-4 w-4" />
          <span>{formatCrmCurrency(entry.valueAmount, entry.currency)}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <CalendarDays className="h-4 w-4" />
          <span>{entry.expectedCloseDate ? formatCrmDate(entry.expectedCloseDate) : 'Belum ada target close'}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <Clock3 className="h-4 w-4" />
          <span>{formatCrmRelativeTime(entry.lastActivityAt)}</span>
        </div>
      </div>
    </button>
  );
}

function KanbanColumn({ stage, entries, onOpenEntry, onDropEntry }) {
  const accentColor = getCrmStageAccent(stage);

  return (
    <div
      className="flex min-h-[28rem] w-[20rem] shrink-0 flex-col rounded-3xl border border-slate-800 bg-slate-900/85"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const entryId = event.dataTransfer.getData('text/plain');
        if (entryId) {
          onDropEntry(entryId, stage);
        }
      }}
    >
      <div className="rounded-t-3xl border-b border-slate-800 px-4 py-4" style={{ background: `linear-gradient(180deg, ${accentColor}22, transparent)` }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">{stage.name}</p>
            <p className="mt-1 text-xs text-slate-400">{stage.probabilityPercent}% probability</p>
          </div>
          <Badge variant={stage.isClosedWon ? 'success' : stage.isClosedLost ? 'destructive' : 'outline'}>
            {entries.length}
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {entries.length === 0 ? (
          <div className="flex h-full min-h-[12rem] items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/60 p-4 text-center text-sm text-slate-500">
            Drop lead di sini atau gunakan tombol New Lead.
          </div>
        ) : (
          entries.map((entry) => (
            <LeadCard key={entry.id} entry={entry} onOpen={onOpenEntry} />
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ onCreateLead, onCreatePipeline }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/70 p-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-950/80">
        <Briefcase className="h-6 w-6 text-slate-300" />
      </div>
      <h2 className="mt-5 text-2xl font-semibold text-white">Belum ada lead di pipeline ini</h2>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-400">
        Mulai dari membuat lead baru, atau buat pipeline terpisah untuk tim dan alur sales yang berbeda.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={onCreateLead}>
          <Plus className="mr-2 h-4 w-4" />
          New Lead
        </Button>
        <Button variant="outline" onClick={onCreatePipeline}>
          <GitBranch className="mr-2 h-4 w-4" />
          New Pipeline
        </Button>
      </div>
    </div>
  );
}

function PipelineDot({ color, className = '' }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color || '#2563eb' }}
    />
  );
}

function ArchivedLeadsPanel({ archivedState, pipelines, onSearch, onPipelineFilter, onRefresh, onRestore, onDelete }) {
  const { entries, loading, search, pipelineId } = archivedState;

  const displayedEntries = entries;

  return (
    <div className="space-y-4">
      <Card className="border-slate-800 bg-slate-900/85">
        <CardContent className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cari lead diarsipkan..."
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950/80 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-600"
                />
              </div>
              <Select value={pipelineId || '__all__'} onValueChange={(v) => onPipelineFilter(v === '__all__' ? '' : v)}>
                <SelectTrigger className="border-slate-700 bg-slate-950/80 w-48">
                  <SelectValue placeholder="Semua pipeline" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Semua Pipeline</SelectItem>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <PipelineDot color={p.color} />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : displayedEntries.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900/60">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <Archive className="h-10 w-10 text-slate-600" />
            <p className="text-base font-medium text-slate-300">
              {search ? 'Tidak ada hasil ditemukan' : 'Tidak ada lead yang diarsipkan'}
            </p>
            <p className="text-sm text-slate-500">
              {search ? 'Coba kata kunci lain atau hapus filter pencarian.' : 'Lead yang diarsipkan akan muncul di sini. Arsipkan lead dari detail view untuk menyimpannya di sini.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {displayedEntries.map((entry) => (
            <ArchivedLeadRow key={entry.id} entry={entry} onRestore={onRestore} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArchivedLeadRow({ entry, onRestore, onDelete }) {
  const [restoring, setRestoring] = useState(false);

  async function handleRestore() {
    setRestoring(true);
    try {
      await onRestore(entry);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Card className="border-slate-800 bg-slate-900/70 transition-colors hover:border-slate-700">
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-white truncate">{entry.title}</p>
              {entry.stage && (
                <Badge variant="outline" className="shrink-0 text-xs" style={{ borderColor: entry.stage.color || '#334155', color: entry.stage.color || '#94a3b8' }}>
                  {entry.stage.name}
                </Badge>
              )}
              {entry.priority && (
                <Badge variant="outline" className={`shrink-0 text-xs ${entry.priority === 'URGENT' ? 'border-red-700 text-red-400' : entry.priority === 'HIGH' ? 'border-orange-700 text-orange-400' : 'border-slate-700 text-slate-400'}`}>
                  {entry.priority}
                </Badge>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              {entry.customer?.name && (
                <span>{entry.customer.name}</span>
              )}
              {entry.assignedAgent?.name && (
                <span>Agent: {entry.assignedAgent.name}</span>
              )}
              {entry.valueAmount != null && (
                <span>{formatCrmCurrency(entry.valueAmount, entry.currency || 'IDR')}</span>
              )}
              {entry.source && (
                <span>Source: {entry.source}</span>
              )}
              {entry.expectedCloseDate && (
                <span>Close: {formatCrmDate(entry.expectedCloseDate)}</span>
              )}
              {entry.archivedAt && (
                <span className="text-slate-600">Diarsipkan {formatCrmRelativeTime(entry.archivedAt)}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRestore}
              disabled={restoring}
            >
              {restoring ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Undo2 className="mr-1.5 h-3.5 w-3.5" />}
              Restore
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-red-800 text-red-400 hover:bg-red-950 hover:text-red-300"
              onClick={() => onDelete(entry)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CrmPipelinePage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceTier, setWorkspaceTier] = useState('FREE');
  const [skillActive, setSkillActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [activeTab, setActiveTab] = useState('active');
  const [pipelines, setPipelines] = useState([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState(
    () => (typeof window !== 'undefined' ? (localStorage.getItem(STORAGE_KEY_PIPELINE) || '') : ''),
  );
  const [agents, setAgents] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState(null);
  const [entryDialog, setEntryDialog] = useState({
    open: false,
    mode: 'create',
    saving: false,
    error: '',
    entryId: null,
    form: buildDefaultEntryForm(),
  });
  const [pipelineDialog, setPipelineDialog] = useState({
    open: false,
    saving: false,
    error: '',
    form: {
      name: '',
      description: '',
      color: '#2563eb',
      isDefault: false,
      isActive: true,
    },
  });
  const [stageDialog, setStageDialog] = useState({
    open: false,
    saving: false,
    error: '',
    form: {
      name: '',
      description: '',
      color: DEFAULT_STAGE_COLOR,
      probabilityPercent: 50,
    },
  });
  const [detailState, setDetailState] = useState({
    open: false,
    loading: false,
    saving: false,
    entry: null,
    error: '',
    stageId: '',
    assignedAgentId: FILTER_ALL_VALUE,
    note: '',
  });
  const [archivedState, setArchivedState] = useState({
    entries: [],
    loading: false,
    search: '',
    pipelineId: '',
  });
  const [deleteConfirm, setDeleteConfirm] = useState({
    open: false,
    entry: null,
    deleting: false,
    error: '',
  });
  const [filters, setFilters] = useState({
    assignedAgentId: FILTER_ALL_VALUE,
    stageId: FILTER_ALL_VALUE,
    priority: FILTER_ALL_VALUE,
    source: FILTER_ALL_VALUE,
    search: '',
  });

  const latestRef = useRef({
    workspaceId: '',
    selectedPipelineId: '',
    filters,
    skillActive: false,
  });

  const selectedPipeline = pipelines.find((pipeline) => pipeline.id === selectedPipelineId) || pipelines[0] || null;
  const currentStages = Array.isArray(selectedPipeline?.stages) ? [...selectedPipeline.stages].sort((left, right) => left.position - right.position) : [];
  const sourceOptions = [...new Set(entries.map((entry) => entry.source).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const wonStage = currentStages.find((stage) => stage.isClosedWon) || null;
  const lostStage = currentStages.find((stage) => stage.isClosedLost) || null;

  useEffect(() => {
    latestRef.current = {
      workspaceId,
      selectedPipelineId,
      filters,
      skillActive,
    };
  }, [workspaceId, selectedPipelineId, filters, skillActive]);

  function addToast(message, variant = 'default') {
    const id = createToastId();
    setToasts((current) => [...current, { id, message, variant }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3500);
  }

  async function loadReferenceData(currentWorkspaceId, preferredPipelineId) {
    const [pipelinesRes, agentsRes, customersRes] = await Promise.all([
      api.get('/crm/pipelines', { params: { workspaceId: currentWorkspaceId } }),
      api.get('/agents', { params: { workspaceId: currentWorkspaceId } }),
      api.get('/customers', { params: { workspaceId: currentWorkspaceId, status: 'ALL', limit: '100' } }),
    ]);

    const nextPipelines = Array.isArray(pipelinesRes.data?.pipelines) ? pipelinesRes.data.pipelines : [];
    const nextAgents = Array.isArray(agentsRes.data?.agents) ? agentsRes.data.agents : [];
    const nextCustomers = Array.isArray(customersRes.data?.customers) ? customersRes.data.customers : [];

    setPipelines(nextPipelines);
    setAgents(nextAgents);
    setCustomers(nextCustomers);

    return preferredPipelineId && nextPipelines.some((pipeline) => pipeline.id === preferredPipelineId)
      ? preferredPipelineId
      : nextPipelines.find((pipeline) => pipeline.isDefault)?.id || nextPipelines[0]?.id || '';
  }

  async function loadBoardData(currentWorkspaceId, pipelineId, nextFilters = filters, options = {}) {
    if (!currentWorkspaceId || !pipelineId) {
      setEntries([]);
      setSummary(null);
      return;
    }

    if (!options.silent) {
      setRefreshing(true);
    }

    try {
      const params = buildApiFilters(currentWorkspaceId, pipelineId, nextFilters);
      const [entriesRes, summaryRes] = await Promise.all([
        api.get('/crm/entries', { params }),
        api.get('/crm/dashboard-summary', { params }),
      ]);

      setEntries(Array.isArray(entriesRes.data?.entries) ? entriesRes.data.entries : []);
      setSummary(summaryRes.data?.summary || null);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Gagal memuat CRM Pipeline dashboard'));
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshEverything(options = {}) {
    const preferredPipelineId = options.preferredPipelineId || selectedPipelineId;
    const nextPipelineId = await loadReferenceData(workspaceId, preferredPipelineId);
    setSelectedPipelineId(nextPipelineId);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY_PIPELINE, nextPipelineId);
    await loadBoardData(workspaceId, nextPipelineId, filters, { silent: Boolean(options.silent) });
  }

  async function bootstrap() {
    setLoading(true);
    setError('');

    try {
      const { data: me } = await api.get('/auth/me');
      const currentWorkspaceId = me.workspace?.id || '';
      const currentTier = me.workspace?.subTier || me.workspace?.tier || 'FREE';
      setWorkspaceId(currentWorkspaceId);
      setWorkspaceTier(currentTier);

      if (!currentWorkspaceId || currentTier === 'FREE') {
        setSkillActive(false);
        setError('CRM Pipeline hanya tersedia untuk workspace tier Starter atau lebih tinggi.');
        return;
      }

      const { data: skillsData } = await api.get('/skills/installed');
      const installedSkills = Array.isArray(skillsData?.skills) ? skillsData.skills : [];
      const crmSkill = getInstalledInternalSkill(installedSkills, INTERNAL_SKILL_KEYS.CRM_PIPELINE);
      const active = isInternalSkillActive(crmSkill);
      setSkillActive(active);

      if (!active) {
        setError('CRM Pipeline belum aktif. Install skill ini lalu assign ke minimal satu agent di halaman Skills untuk membuka dashboard dan worker.');
        return;
      }

      const storedPipelineId = typeof window !== 'undefined' ? (localStorage.getItem(STORAGE_KEY_PIPELINE) || '') : '';
      const nextPipelineId = await loadReferenceData(currentWorkspaceId, storedPipelineId || selectedPipelineId);
      setSelectedPipelineId(nextPipelineId);
      if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY_PIPELINE, nextPipelineId);
      await loadBoardData(currentWorkspaceId, nextPipelineId, filters, { silent: false });
    } catch (err) {
      setError(getErrorMessage(err, 'Gagal memuat CRM Pipeline'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    bootstrap();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'archived' && workspaceId && skillActive) {
      // Sync pipelineId to the currently selected pipeline when switching to archived tab
      const syncedPipelineId = archivedState.pipelineId || selectedPipelineId;
      setArchivedState((current) => ({ ...current, pipelineId: syncedPipelineId }));
      loadArchivedEntries(workspaceId, syncedPipelineId, archivedState.search);
    }
  }, [activeTab, workspaceId, skillActive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!skillActive) return undefined;

    const intervalId = window.setInterval(() => {
      const current = latestRef.current;
      if (!current.skillActive || !current.workspaceId || !current.selectedPipelineId) {
        return;
      }

      loadBoardData(current.workspaceId, current.selectedPipelineId, current.filters, { silent: true });
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [skillActive]);

  async function handlePipelineChange(nextPipelineId) {
    const nextFilters = { ...filters, stageId: FILTER_ALL_VALUE };
    setSelectedPipelineId(nextPipelineId);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY_PIPELINE, nextPipelineId);
    setFilters(nextFilters);
    // Keep archived panel synced to the newly selected pipeline if user is on archived tab
    setArchivedState((current) => ({ ...current, pipelineId: nextPipelineId }));
    await loadBoardData(workspaceId, nextPipelineId, nextFilters, { silent: false });
  }

  async function handleFilterChange(field, value) {
    const nextFilters = { ...filters, [field]: value };
    setFilters(nextFilters);
    await loadBoardData(workspaceId, selectedPipelineId, nextFilters, { silent: true });
  }

  function openCreateLeadDialog() {
    const defaultStageId = currentStages[0]?.id || '';
    setEntryDialog({
      open: true,
      mode: 'create',
      saving: false,
      error: '',
      entryId: null,
      form: buildDefaultEntryForm(selectedPipelineId, defaultStageId),
    });
  }

  function openEditLeadDialog(entry) {
    setDetailState((current) => ({ ...current, open: false }));
    setEntryDialog({
      open: true,
      mode: 'edit',
      saving: false,
      error: '',
      entryId: entry.id,
      form: {
        customerId: entry.customerId,
        pipelineId: entry.pipelineId,
        stageId: entry.stageId,
        assignedAgentId: entry.assignedAgentId || FILTER_ALL_VALUE,
        title: entry.title,
        valueAmount: entry.valueAmount ?? '',
        currency: entry.currency || 'IDR',
        priority: entry.priority || 'MEDIUM',
        expectedCloseDate: toDateInputValue(entry.expectedCloseDate),
        source: entry.source || '',
        notes: entry.notes || '',
      },
    });
  }

  async function handleSubmitEntry() {
    if (!entryDialog.form.customerId) {
      setEntryDialog((current) => ({ ...current, error: 'Pilih customer terlebih dahulu.' }));
      return;
    }

    if (!entryDialog.form.pipelineId) {
      setEntryDialog((current) => ({ ...current, error: 'Pilih pipeline terlebih dahulu.' }));
      return;
    }

    setEntryDialog((current) => ({ ...current, saving: true, error: '' }));

    try {
      const payload = {
        workspaceId,
        customerId: entryDialog.form.customerId,
        pipelineId: entryDialog.form.pipelineId,
        stageId: entryDialog.form.stageId || undefined,
        assignedAgentId: entryDialog.form.assignedAgentId !== FILTER_ALL_VALUE ? entryDialog.form.assignedAgentId : null,
        title: entryDialog.form.title,
        valueAmount: entryDialog.form.valueAmount === '' ? null : Number(entryDialog.form.valueAmount),
        currency: entryDialog.form.currency || 'IDR',
        priority: entryDialog.form.priority,
        expectedCloseDate: entryDialog.form.expectedCloseDate || undefined,
        source: entryDialog.form.source || null,
        notes: entryDialog.form.notes || null,
      };

      if (entryDialog.mode === 'create') {
        await api.post('/crm/entries', payload);
        addToast('Lead CRM berhasil dibuat.');
      } else {
        await api.put(`/crm/entries/${entryDialog.entryId}`, payload);
        addToast('Lead CRM berhasil diupdate.');
      }

      const preferredPipelineId = entryDialog.form.pipelineId;
      setEntryDialog((current) => ({ ...current, open: false, saving: false }));
      await refreshEverything({ preferredPipelineId, silent: true });
    } catch (err) {
      setEntryDialog((current) => ({
        ...current,
        saving: false,
        error: getErrorMessage(err, entryDialog.mode === 'create' ? 'Gagal membuat lead CRM' : 'Gagal mengupdate lead CRM'),
      }));
    }
  }

  async function handleSubmitPipeline() {
    setPipelineDialog((current) => ({ ...current, saving: true, error: '' }));

    try {
      const payload = {
        workspaceId,
        name: pipelineDialog.form.name,
        description: pipelineDialog.form.description || null,
        color: pipelineDialog.form.color || '#2563eb',
        isDefault: pipelineDialog.form.isDefault,
        isActive: pipelineDialog.form.isActive,
      };

      const { data } = await api.post('/crm/pipelines', payload);
      const nextPipelineId = data?.pipeline?.id || selectedPipelineId;
      setPipelineDialog({
        open: false,
        saving: false,
        error: '',
        form: {
          name: '',
          description: '',
          color: '#2563eb',
          isDefault: false,
          isActive: true,
        },
      });
      addToast('Pipeline CRM berhasil dibuat.');
      await refreshEverything({ preferredPipelineId: nextPipelineId, silent: true });
    } catch (err) {
      setPipelineDialog((current) => ({ ...current, saving: false, error: getErrorMessage(err, 'Gagal membuat pipeline CRM') }));
    }
  }

  async function handleCreateStage() {
    if (!selectedPipelineId) return;
    setStageDialog((current) => ({ ...current, saving: true, error: '' }));

    try {
      await api.post(`/crm/pipelines/${selectedPipelineId}/stages`, {
        workspaceId,
        name: stageDialog.form.name,
        description: stageDialog.form.description || null,
        color: stageDialog.form.color || DEFAULT_STAGE_COLOR,
        probabilityPercent: Number(stageDialog.form.probabilityPercent || 0),
      });
      addToast('Stage CRM berhasil dibuat.');
      setStageDialog((current) => ({
        ...current,
        saving: false,
        error: '',
        form: {
          name: '',
          description: '',
          color: DEFAULT_STAGE_COLOR,
          probabilityPercent: 50,
        },
      }));
      await refreshEverything({ preferredPipelineId: selectedPipelineId, silent: true });
    } catch (err) {
      setStageDialog((current) => ({ ...current, saving: false, error: getErrorMessage(err, 'Gagal membuat stage CRM') }));
    }
  }

  async function handleReorderStage(stageId, direction) {
    const currentIndex = currentStages.findIndex((stage) => stage.id === stageId);
    if (currentIndex < 0) return;
    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= currentStages.length) return;

    const nextStageIds = currentStages.map((stage) => stage.id);
    const [movedStageId] = nextStageIds.splice(currentIndex, 1);
    nextStageIds.splice(nextIndex, 0, movedStageId);

    setStageDialog((current) => ({ ...current, saving: true, error: '' }));

    try {
      await api.post('/crm/stages/reorder', {
        workspaceId,
        pipelineId: selectedPipelineId,
        stageIds: nextStageIds,
      });
      addToast('Urutan stage berhasil diupdate.');
      await refreshEverything({ preferredPipelineId: selectedPipelineId, silent: true });
      setStageDialog((current) => ({ ...current, saving: false }));
    } catch (err) {
      setStageDialog((current) => ({ ...current, saving: false, error: getErrorMessage(err, 'Gagal mengurutkan stage CRM') }));
    }
  }

  async function openEntryDetail(entry) {
    setDetailState({
      open: true,
      loading: true,
      saving: false,
      entry: null,
      error: '',
      stageId: entry.stageId,
      assignedAgentId: entry.assignedAgentId || FILTER_ALL_VALUE,
      note: '',
    });

    try {
      const { data } = await api.get(`/crm/entries/${entry.id}`, { params: { workspaceId } });
      const detailEntry = data?.entry || null;
      setDetailState({
        open: true,
        loading: false,
        saving: false,
        entry: detailEntry,
        error: '',
        stageId: detailEntry?.stageId || entry.stageId,
        assignedAgentId: detailEntry?.assignedAgentId || FILTER_ALL_VALUE,
        note: '',
      });
    } catch (err) {
      setDetailState((current) => ({ ...current, loading: false, error: getErrorMessage(err, 'Gagal memuat detail lead CRM') }));
    }
  }

  async function reloadDetail(entryId) {
    try {
      const { data } = await api.get(`/crm/entries/${entryId}`, { params: { workspaceId } });
      const detailEntry = data?.entry || null;
      setDetailState((current) => ({
        ...current,
        entry: detailEntry,
        stageId: detailEntry?.stageId || current.stageId,
        assignedAgentId: detailEntry?.assignedAgentId || FILTER_ALL_VALUE,
        error: '',
      }));
    } catch (err) {
      setDetailState((current) => ({ ...current, error: getErrorMessage(err, 'Gagal memuat ulang detail lead CRM') }));
    }
  }

  async function handleMoveStage(entryId, targetStage) {
    const previousEntries = entries;
    const previousEntry = entries.find((entry) => entry.id === entryId) || null;
    setEntries((current) => current.map((entry) => (
      entry.id === entryId
        ? {
          ...entry,
          stageId: targetStage.id,
          stage: targetStage,
          lastActivityAt: new Date().toISOString(),
          flags: {
            ...entry.flags,
            isClosedWon: Boolean(targetStage.isClosedWon),
            isClosedLost: Boolean(targetStage.isClosedLost),
            isClosed: Boolean(targetStage.isClosedWon || targetStage.isClosedLost),
          },
        }
        : entry
    )));

    try {
      await api.post(`/crm/entries/${entryId}/move-stage`, {
        workspaceId,
        stageId: targetStage.id,
      });
      addToast(`Lead dipindahkan ke ${targetStage.name}.`);
      await loadBoardData(workspaceId, selectedPipelineId, filters, { silent: true });
      if (detailState.open && detailState.entry?.id === entryId) {
        await reloadDetail(entryId);
      }
    } catch (err) {
      setEntries(previousEntries);
      if (previousEntry) {
        addToast(getErrorMessage(err, `Gagal memindahkan lead ke ${targetStage.name}`), 'warning');
      }
    }
  }

  async function handleAssignLeadFromDetail() {
    if (!detailState.entry) return;
    setDetailState((current) => ({ ...current, saving: true, error: '' }));

    try {
      await api.post(`/crm/entries/${detailState.entry.id}/assign-agent`, {
        workspaceId,
        assignedAgentId: detailState.assignedAgentId !== FILTER_ALL_VALUE ? detailState.assignedAgentId : null,
      });
      addToast('Assignment lead berhasil diupdate.');
      await refreshEverything({ preferredPipelineId: selectedPipelineId, silent: true });
      await reloadDetail(detailState.entry.id);
      setDetailState((current) => ({ ...current, saving: false }));
    } catch (err) {
      setDetailState((current) => ({ ...current, saving: false, error: getErrorMessage(err, 'Gagal mengganti assignment lead') }));
    }
  }

  async function handleMoveStageFromDetail() {
    if (!detailState.entry || !detailState.stageId) return;
    setDetailState((current) => ({ ...current, saving: true, error: '' }));

    try {
      await api.post(`/crm/entries/${detailState.entry.id}/move-stage`, {
        workspaceId,
        stageId: detailState.stageId,
      });
      addToast('Stage lead berhasil diupdate.');
      await refreshEverything({ preferredPipelineId: selectedPipelineId, silent: true });
      await reloadDetail(detailState.entry.id);
      setDetailState((current) => ({ ...current, saving: false }));
    } catch (err) {
      setDetailState((current) => ({ ...current, saving: false, error: getErrorMessage(err, 'Gagal memindahkan stage lead') }));
    }
  }

  async function handleAddNoteFromDetail() {
    if (!detailState.entry || !detailState.note.trim()) return;
    setDetailState((current) => ({ ...current, saving: true, error: '' }));

    try {
      await api.post(`/crm/entries/${detailState.entry.id}/notes`, {
        workspaceId,
        content: detailState.note,
      });
      addToast('Note CRM berhasil ditambahkan.');
      await refreshEverything({ preferredPipelineId: selectedPipelineId, silent: true });
      await reloadDetail(detailState.entry.id);
      setDetailState((current) => ({ ...current, saving: false, note: '' }));
    } catch (err) {
      setDetailState((current) => ({ ...current, saving: false, error: getErrorMessage(err, 'Gagal menambahkan note CRM') }));
    }
  }

  async function handleMarkOutcome(targetStage) {
    if (!detailState.entry || !targetStage) return;
    setDetailState((current) => ({ ...current, saving: true, error: '' }));

    try {
      await api.post(`/crm/entries/${detailState.entry.id}/move-stage`, {
        workspaceId,
        stageId: targetStage.id,
      });
      addToast(`Lead ditandai sebagai ${targetStage.name}.`);
      await refreshEverything({ preferredPipelineId: selectedPipelineId, silent: true });
      await reloadDetail(detailState.entry.id);
      setDetailState((current) => ({ ...current, saving: false, stageId: targetStage.id }));
    } catch (err) {
      setDetailState((current) => ({ ...current, saving: false, error: getErrorMessage(err, 'Gagal mengubah outcome lead') }));
    }
  }

  async function handleArchiveFromDetail() {
    if (!detailState.entry) return;
    if (detailState.entry.isArchived) return; // use restore in archived tab
    setDetailState((current) => ({ ...current, saving: true, error: '' }));

    try {
      await api.post(`/crm/entries/${detailState.entry.id}/archive`, {
        workspaceId,
      });
      addToast('Lead berhasil diarsipkan.');
      setDetailState((current) => ({ ...current, saving: false, open: false }));
      await refreshEverything({ preferredPipelineId: selectedPipelineId, silent: true });
    } catch (err) {
      setDetailState((current) => ({ ...current, saving: false, error: getErrorMessage(err, 'Gagal mengarsipkan lead') }));
    }
  }

  async function loadArchivedEntries(currentWorkspaceId, pipelineId, search) {
    if (!currentWorkspaceId) return;
    setArchivedState((current) => ({ ...current, loading: true }));
    try {
      const params = { workspaceId: currentWorkspaceId };
      if (pipelineId) params.pipelineId = pipelineId;
      if (search) params.search = search;
      const res = await api.get('/crm/entries/archived', { params });
      setArchivedState((current) => ({
        ...current,
        entries: Array.isArray(res.data?.entries) ? res.data.entries : [],
        loading: false,
      }));
    } catch (err) {
      setArchivedState((current) => ({ ...current, loading: false }));
      addToast(getErrorMessage(err, 'Gagal memuat arsip lead'), 'destructive');
    }
  }

  async function handleRestoreEntry(entry) {
    try {
      await api.post(`/crm/entries/${entry.id}/restore`, { workspaceId });
      addToast('Lead berhasil dikembalikan ke board aktif.');
      await Promise.all([
        loadArchivedEntries(workspaceId, archivedState.pipelineId, archivedState.search),
        refreshEverything({ preferredPipelineId: selectedPipelineId, silent: true }),
      ]);
    } catch (err) {
      addToast(getErrorMessage(err, 'Gagal mengembalikan lead'), 'destructive');
    }
  }

  function openDeleteConfirm(entry) {
    setDeleteConfirm({ open: true, entry, deleting: false, error: '' });
  }

  async function handlePermanentDelete() {
    if (!deleteConfirm.entry) return;
    setDeleteConfirm((current) => ({ ...current, deleting: true, error: '' }));
    try {
      await api.delete(`/crm/entries/${deleteConfirm.entry.id}/permanent`, {
        params: { workspaceId },
      });
      addToast('Lead berhasil dihapus permanen.');
      setDeleteConfirm({ open: false, entry: null, deleting: false, error: '' });
      await loadArchivedEntries(workspaceId, archivedState.pipelineId, archivedState.search);
    } catch (err) {
      setDeleteConfirm((current) => ({ ...current, deleting: false, error: getErrorMessage(err, 'Gagal menghapus lead') }));
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <>
      <ToastStack toasts={toasts} />

      <div className="space-y-6 pb-8">
        <div className="rounded-[2rem] border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.15),_transparent_36%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(2,6,23,0.98))] p-6 md:p-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1 text-xs uppercase tracking-[0.24em] text-slate-400">
                <GitBranch className="h-3.5 w-3.5" />
                CRM Pipeline
              </div>
              <h1 className="mt-4 text-3xl font-bold text-white md:text-4xl">Workspace sales board dengan automation dan analytics.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Kelola lead per pipeline, pantau deal yang stale atau overdue, dan sinkronkan perpindahan stage dari workflow appointment serta payment reminder.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={openCreateLeadDialog}>
                <Plus className="mr-2 h-4 w-4" />
                New Lead
              </Button>
              <Button variant="outline" onClick={() => setPipelineDialog((current) => ({ ...current, open: true }))}>
                <GitBranch className="mr-2 h-4 w-4" />
                New Pipeline
              </Button>
              <Button variant="outline" onClick={() => setStageDialog((current) => ({ ...current, open: true }))} disabled={!selectedPipelineId}>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                Manage Stages
              </Button>
              <Button variant="outline" onClick={() => refreshEverything({ preferredPipelineId: selectedPipelineId, silent: false })} disabled={refreshing}>
                {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TrendingUp className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="warning">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>CRM Pipeline belum siap</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              {workspaceTier !== 'FREE' && (
                <p className="mt-2">
                  Buka <Link href="/dashboard/skills" className="underline underline-offset-4">halaman Skills</Link> untuk install atau mengaktifkan skill CRM Pipeline.
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {skillActive && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('active')}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'active' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                <Briefcase className="h-4 w-4" />
                Active Leads
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('archived')}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'archived' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                <Archive className="h-4 w-4" />
                Archived Leads
                {archivedState.entries.length > 0 && (
                  <span className="ml-1 rounded-full bg-slate-600 px-1.5 py-0.5 text-xs text-slate-200">{archivedState.entries.length}</span>
                )}
              </button>
            </div>
            {selectedPipeline && (
              <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
                <PipelineDot color={selectedPipeline.color} />
                <span className="font-medium">{selectedPipeline.name}</span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-500">{entries.length} lead{entries.length !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>
        )}

        {skillActive && activeTab === 'archived' && (
          <ArchivedLeadsPanel
            archivedState={archivedState}
            pipelines={pipelines}
            workspaceId={workspaceId}
            onSearch={(search) => {
              setArchivedState((current) => ({ ...current, search }));
              loadArchivedEntries(workspaceId, archivedState.pipelineId, search);
            }}
            onPipelineFilter={(pipelineId) => {
              setArchivedState((current) => ({ ...current, pipelineId }));
              loadArchivedEntries(workspaceId, pipelineId, archivedState.search);
            }}
            onRefresh={() => loadArchivedEntries(workspaceId, archivedState.pipelineId, archivedState.search)}
            onRestore={handleRestoreEntry}
            onDelete={openDeleteConfirm}
          />
        )}

        {skillActive && activeTab === 'active' && summary && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <StatsCard label="Total Leads" value={summary.stats.totalLeads} helper="Lead aktif pada filter saat ini" icon={Briefcase} accentClass="bg-[linear-gradient(180deg,rgba(59,130,246,0.12),rgba(15,23,42,0.92))]" />
            <StatsCard label="Won Deals" value={summary.stats.wonDeals} helper="Deal yang sudah close won" icon={TrendingUp} accentClass="bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(15,23,42,0.92))]" />
            <StatsCard label="Lost Deals" value={summary.stats.lostDeals} helper="Lead yang berakhir lost" icon={ShieldAlert} accentClass="bg-[linear-gradient(180deg,rgba(239,68,68,0.10),rgba(15,23,42,0.92))]" />
            <StatsCard label="Conversion Rate" value={`${summary.stats.conversionRate}%`} helper="Won dibanding closed deals" icon={BarChart3} accentClass="bg-[linear-gradient(180deg,rgba(14,165,233,0.10),rgba(15,23,42,0.92))]" />
            <StatsCard label="Pipeline Value" value={formatCrmCurrency(summary.stats.totalPipelineValue, 'IDR')} helper="Nilai open deal saat ini" icon={DollarSign} accentClass="bg-[linear-gradient(180deg,rgba(245,158,11,0.10),rgba(15,23,42,0.92))]" />
            <StatsCard label="Stale Leads" value={summary.analytics?.staleLeadsCount ?? 0} helper="Lead tanpa aktivitas bermakna > 7 hari" icon={Clock3} accentClass="bg-[linear-gradient(180deg,rgba(148,163,184,0.10),rgba(15,23,42,0.92))]" />
          </div>
        )}

        {skillActive && activeTab === 'active' && (
          <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
            <Card className="border-slate-800 bg-slate-900/85">
              <CardContent className="p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="space-y-2 md:col-span-2 xl:col-span-1">
                      <Label>Pipeline</Label>
                      <Select value={selectedPipelineId || undefined} onValueChange={handlePipelineChange}>
                        <SelectTrigger className="border-slate-700 bg-slate-950/80">
                          <SelectValue placeholder="Pilih pipeline" />
                        </SelectTrigger>
                        <SelectContent>
                          {pipelines.map((pipeline) => (
                            <SelectItem key={pipeline.id} value={pipeline.id}>
                              <span className="flex items-center gap-2">
                                <PipelineDot color={pipeline.color} />
                                {pipeline.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Assigned Agent</Label>
                      <Select value={filters.assignedAgentId} onValueChange={(value) => handleFilterChange('assignedAgentId', value)}>
                        <SelectTrigger className="border-slate-700 bg-slate-950/80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={FILTER_ALL_VALUE}>All agents</SelectItem>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Stage</Label>
                      <Select value={filters.stageId} onValueChange={(value) => handleFilterChange('stageId', value)}>
                        <SelectTrigger className="border-slate-700 bg-slate-950/80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={FILTER_ALL_VALUE}>All stages</SelectItem>
                          {currentStages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Select value={filters.priority} onValueChange={(value) => handleFilterChange('priority', value)}>
                        <SelectTrigger className="border-slate-700 bg-slate-950/80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={FILTER_ALL_VALUE}>All priority</SelectItem>
                          {CRM_PRIORITY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Source</Label>
                      <Select value={filters.source} onValueChange={(value) => handleFilterChange('source', value)}>
                        <SelectTrigger className="border-slate-700 bg-slate-950/80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={FILTER_ALL_VALUE}>All sources</SelectItem>
                          {sourceOptions.map((source) => (
                            <SelectItem key={source} value={source}>{source}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex w-full gap-3 lg:w-[24rem]">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        value={filters.search}
                        onChange={(event) => handleFilterChange('search', event.target.value)}
                        placeholder="Cari customer, title, source"
                        className="border-slate-700 bg-slate-950/80 pl-9"
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const nextFilters = {
                          assignedAgentId: FILTER_ALL_VALUE,
                          stageId: FILTER_ALL_VALUE,
                          priority: FILTER_ALL_VALUE,
                          source: FILTER_ALL_VALUE,
                          search: '',
                        };
                        setFilters(nextFilters);
                        loadBoardData(workspaceId, selectedPipelineId, nextFilters, { silent: true });
                      }}
                    >
                      <ListX className="mr-2 h-4 w-4" />
                      Reset
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {summary && (
              <Card className="border-slate-800 bg-slate-900/85">
                <CardContent className="p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Quick Analytics</p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-sm text-slate-400">Average Days to Close</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{summary.analytics?.averageDaysToClose ?? 0} hari</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Average Value per Deal</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{formatCrmCurrency(summary.analytics?.averageValuePerDeal ?? 0, 'IDR')}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Top Performing Agent</p>
                      <p className="mt-2 text-base font-semibold text-white">{summary.analytics.topPerformingAgent?.name || 'Belum ada'}</p>
                      {summary.analytics.topPerformingAgent && (
                        <p className="text-xs text-slate-500">{summary.analytics.topPerformingAgent.deals} won deals</p>
                      )}
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">Most Active Stage</p>
                      <p className="mt-2 text-base font-semibold text-white">{summary.analytics.mostActiveStage?.label || 'Belum ada'}</p>
                      {summary.analytics.mostActiveStage && (
                        <p className="text-xs text-slate-500">{summary.analytics.mostActiveStage.count} activity logs</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {skillActive && activeTab === 'active' && selectedPipeline && (
          entries.length === 0 ? (
            <EmptyState onCreateLead={openCreateLeadDialog} onCreatePipeline={() => setPipelineDialog((current) => ({ ...current, open: true }))} />
          ) : (
            <div className="overflow-x-auto pb-2">
              <div className="flex gap-4">
                {currentStages.map((stage) => (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    entries={entries.filter((entry) => entry.stageId === stage.id)}
                    onOpenEntry={openEntryDetail}
                    onDropEntry={handleMoveStage}
                  />
                ))}
              </div>
            </div>
          )
        )}

        {skillActive && activeTab === 'active' && summary && (
          <div className="grid gap-4 xl:grid-cols-2">
            <MiniBarChart
              title="Leads per Stage"
              subtitle="Distribusi lead pada pipeline yang sedang dipilih."
              data={summary.charts.leadsPerStage || []}
            />
            <MiniBarChart
              title="Value by Stage"
              subtitle="Nilai deal terbuka per stage pipeline."
              data={summary.charts.valueByStage || []}
              formatValue={(value) => formatCrmCurrency(value, 'IDR')}
            />
            <MiniBarChart
              title="Won vs Lost"
              subtitle="Perbandingan outcome lead pada filter saat ini."
              data={summary.charts.wonVsLost || []}
            />
            <MiniBarChart
              title="Drop-off Stage"
              subtitle="Stage yang paling sering menjadi titik kehilangan lead."
              data={summary.analytics.stageWithMostDropOff
                ? [{ ...summary.analytics.stageWithMostDropOff, value: summary.analytics.stageWithMostDropOff.count }]
                : []}
            />
          </div>
        )}

        {skillActive && activeTab === 'active' && summary && (
          <TrendBars data={summary.charts.conversionTrend || []} />
        )}
      </div>

      <Dialog open={entryDialog.open} onOpenChange={(open) => setEntryDialog((current) => ({ ...current, open }))}>
        <DialogContent className="max-w-3xl border-slate-800 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>{entryDialog.mode === 'create' ? 'Create CRM Lead' : 'Edit CRM Lead'}</DialogTitle>
            <DialogDescription className="text-slate-400">
              Lead baru akan langsung masuk ke pipeline dan stage yang Anda pilih.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Customer</Label>
              <Select
                value={entryDialog.form.customerId || undefined}
                onValueChange={(value) => setEntryDialog((current) => ({
                  ...current,
                  form: {
                    ...current.form,
                    customerId: value,
                    title: current.form.title || customers.find((customer) => customer.id === value)?.name || '',
                  },
                }))}
              >
                <SelectTrigger className="border-slate-700 bg-slate-900/80">
                  <SelectValue placeholder="Pilih customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name || customer.phoneNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={entryDialog.form.title}
                onChange={(event) => setEntryDialog((current) => ({
                  ...current,
                  form: { ...current.form, title: event.target.value },
                }))}
                className="border-slate-700 bg-slate-900/80"
                placeholder="Contoh: Paket enterprise untuk outlet baru"
              />
            </div>

            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select
                value={entryDialog.form.pipelineId || undefined}
                onValueChange={(value) => {
                  const stages = pipelines.find((pipeline) => pipeline.id === value)?.stages || [];
                  setEntryDialog((current) => ({
                    ...current,
                    form: {
                      ...current.form,
                      pipelineId: value,
                      stageId: stages[0]?.id || '',
                    },
                  }));
                }}
              >
                <SelectTrigger className="border-slate-700 bg-slate-900/80">
                  <SelectValue placeholder="Pilih pipeline" />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((pipeline) => (
                    <SelectItem key={pipeline.id} value={pipeline.id}>
                      <span className="flex items-center gap-2">
                        <PipelineDot color={pipeline.color} />
                        {pipeline.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Stage</Label>
              <Select
                value={entryDialog.form.stageId || undefined}
                onValueChange={(value) => setEntryDialog((current) => ({
                  ...current,
                  form: { ...current.form, stageId: value },
                }))}
              >
                <SelectTrigger className="border-slate-700 bg-slate-900/80">
                  <SelectValue placeholder="Pilih stage" />
                </SelectTrigger>
                <SelectContent>
                  {(pipelines.find((pipeline) => pipeline.id === entryDialog.form.pipelineId)?.stages || []).map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Assigned Agent</Label>
              <Select
                value={entryDialog.form.assignedAgentId || FILTER_ALL_VALUE}
                onValueChange={(value) => setEntryDialog((current) => ({
                  ...current,
                  form: { ...current.form, assignedAgentId: value },
                }))}
              >
                <SelectTrigger className="border-slate-700 bg-slate-900/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ALL_VALUE}>Belum ditugaskan</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={entryDialog.form.priority}
                onValueChange={(value) => setEntryDialog((current) => ({
                  ...current,
                  form: { ...current.form, priority: value },
                }))}
              >
                <SelectTrigger className="border-slate-700 bg-slate-900/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRM_PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Value Amount</Label>
              <Input
                type="number"
                min="0"
                value={entryDialog.form.valueAmount}
                onChange={(event) => setEntryDialog((current) => ({
                  ...current,
                  form: { ...current.form, valueAmount: event.target.value },
                }))}
                className="border-slate-700 bg-slate-900/80"
              />
            </div>

            <div className="space-y-2">
              <Label>Currency</Label>
              <Input
                value={entryDialog.form.currency}
                onChange={(event) => setEntryDialog((current) => ({
                  ...current,
                  form: { ...current.form, currency: event.target.value.toUpperCase() },
                }))}
                className="border-slate-700 bg-slate-900/80"
              />
            </div>

            <div className="space-y-2">
              <Label>Expected Close Date</Label>
              <Input
                type="date"
                value={entryDialog.form.expectedCloseDate}
                onChange={(event) => setEntryDialog((current) => ({
                  ...current,
                  form: { ...current.form, expectedCloseDate: event.target.value },
                }))}
                className="border-slate-700 bg-slate-900/80"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Source</Label>
              <Input
                value={entryDialog.form.source}
                onChange={(event) => setEntryDialog((current) => ({
                  ...current,
                  form: { ...current.form, source: event.target.value },
                }))}
                className="border-slate-700 bg-slate-900/80"
                placeholder="Contoh: WhatsApp inbound, referral, sales call"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={entryDialog.form.notes}
                onChange={(event) => setEntryDialog((current) => ({
                  ...current,
                  form: { ...current.form, notes: event.target.value },
                }))}
                className="min-h-[120px] border-slate-700 bg-slate-900/80"
                placeholder="Catatan internal deal"
              />
            </div>
          </div>

          {entryDialog.error && (
            <Alert variant="destructive">
              <AlertDescription>{entryDialog.error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryDialog((current) => ({ ...current, open: false }))}>Cancel</Button>
            <Button onClick={handleSubmitEntry} disabled={entryDialog.saving}>
              {entryDialog.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {entryDialog.mode === 'create' ? 'Create Lead' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pipelineDialog.open} onOpenChange={(open) => setPipelineDialog((current) => ({ ...current, open }))}>
        <DialogContent className="max-w-xl border-slate-800 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>Create Pipeline</DialogTitle>
            <DialogDescription className="text-slate-400">
              Pipeline baru akan otomatis dibuat dengan default stages Sales Pipeline.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Pipeline Name</Label>
              <Input
                value={pipelineDialog.form.name}
                onChange={(event) => setPipelineDialog((current) => ({
                  ...current,
                  form: { ...current.form, name: event.target.value },
                }))}
                className="border-slate-700 bg-slate-900/80"
                placeholder="Contoh: Enterprise Retention"
              />
            </div>

            <div className="space-y-2">
              <Label>Pipeline Color</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={pipelineDialog.form.color}
                  onChange={(event) => setPipelineDialog((current) => ({
                    ...current,
                    form: { ...current.form, color: event.target.value },
                  }))}
                  className="h-9 w-12 cursor-pointer rounded border border-slate-700 bg-slate-900/80 p-1"
                />
                <span className="text-sm text-slate-400">{pipelineDialog.form.color}</span>
                <div className="flex gap-2 ml-2">
                  {['#2563eb', '#8b5cf6', '#16a34a', '#f59e0b', '#dc2626', '#0891b2', '#ec4899', '#64748b'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPipelineDialog((current) => ({ ...current, form: { ...current.form, color: c } }))}
                      className={`h-5 w-5 rounded-full border-2 transition-all ${pipelineDialog.form.color === c ? 'border-white scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={pipelineDialog.form.description}
                onChange={(event) => setPipelineDialog((current) => ({
                  ...current,
                  form: { ...current.form, description: event.target.value },
                }))}
                className="min-h-[110px] border-slate-700 bg-slate-900/80"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
                <span>Set as default</span>
                <input
                  type="checkbox"
                  checked={pipelineDialog.form.isDefault}
                  onChange={(event) => setPipelineDialog((current) => ({
                    ...current,
                    form: { ...current.form, isDefault: event.target.checked },
                  }))}
                />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
                <span>Pipeline active</span>
                <input
                  type="checkbox"
                  checked={pipelineDialog.form.isActive}
                  onChange={(event) => setPipelineDialog((current) => ({
                    ...current,
                    form: { ...current.form, isActive: event.target.checked },
                  }))}
                />
              </label>
            </div>
          </div>

          {pipelineDialog.error && (
            <Alert variant="destructive">
              <AlertDescription>{pipelineDialog.error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPipelineDialog((current) => ({ ...current, open: false }))}>Cancel</Button>
            <Button onClick={handleSubmitPipeline} disabled={pipelineDialog.saving}>
              {pipelineDialog.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitBranch className="mr-2 h-4 w-4" />}
              Create Pipeline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stageDialog.open} onOpenChange={(open) => setStageDialog((current) => ({ ...current, open }))}>
        <DialogContent className="max-w-3xl border-slate-800 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>Manage Stages</DialogTitle>
            <DialogDescription className="text-slate-400">
              Tambah stage baru dan ubah urutan stage untuk pipeline yang sedang dipilih.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Current Stages</p>
              <div className="space-y-2">
                {currentStages.map((stage, index) => (
                  <div key={stage.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: stage.color || DEFAULT_STAGE_COLOR }} />
                        <p className="truncate text-sm font-medium text-white">{stage.name}</p>
                        {stage.isClosedWon && <Badge variant="success">Won</Badge>}
                        {stage.isClosedLost && <Badge variant="destructive">Lost</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{stage.probabilityPercent}% probability</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={() => handleReorderStage(stage.id, 'up')} disabled={stageDialog.saving || index === 0}>
                        <ArrowRightLeft className="h-4 w-4 rotate-90" />
                      </Button>
                      <Button variant="outline" size="icon" onClick={() => handleReorderStage(stage.id, 'down')} disabled={stageDialog.saving || index === currentStages.length - 1}>
                        <ArrowRightLeft className="h-4 w-4 -rotate-90" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">New Stage</p>
              <div className="space-y-2">
                <Label>Stage Name</Label>
                <Input
                  value={stageDialog.form.name}
                  onChange={(event) => setStageDialog((current) => ({
                    ...current,
                    form: { ...current.form, name: event.target.value },
                  }))}
                  className="border-slate-700 bg-slate-950/80"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={stageDialog.form.description}
                  onChange={(event) => setStageDialog((current) => ({
                    ...current,
                    form: { ...current.form, description: event.target.value },
                  }))}
                  className="min-h-[100px] border-slate-700 bg-slate-950/80"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Color</Label>
                  <Input
                    value={stageDialog.form.color}
                    onChange={(event) => setStageDialog((current) => ({
                      ...current,
                      form: { ...current.form, color: event.target.value },
                    }))}
                    className="border-slate-700 bg-slate-950/80"
                    placeholder="#2563eb"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Probability %</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={stageDialog.form.probabilityPercent}
                    onChange={(event) => setStageDialog((current) => ({
                      ...current,
                      form: { ...current.form, probabilityPercent: event.target.value },
                    }))}
                    className="border-slate-700 bg-slate-950/80"
                  />
                </div>
              </div>

              {stageDialog.error && (
                <Alert variant="destructive">
                  <AlertDescription>{stageDialog.error}</AlertDescription>
                </Alert>
              )}

              <Button onClick={handleCreateStage} disabled={stageDialog.saving || !selectedPipelineId} className="w-full">
                {stageDialog.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add Stage
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={detailState.open} onOpenChange={(open) => setDetailState((current) => ({ ...current, open }))}>
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto border-slate-800 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>{detailState.entry?.customer?.name || detailState.entry?.title || 'Lead CRM'}</DialogTitle>
            <DialogDescription className="text-slate-400">
              Detail lead, timeline activity, history appointment, dan payment reminder yang terhubung ke customer ini.
            </DialogDescription>
          </DialogHeader>

          {detailState.loading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : detailState.entry ? (
            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={getCrmPriorityTone(detailState.entry.priority)}>{detailState.entry.priority}</Badge>
                    <Badge variant={detailState.entry.stage?.isClosedWon ? 'success' : detailState.entry.stage?.isClosedLost ? 'destructive' : 'outline'}>
                      {detailState.entry.stage?.name || 'Unknown stage'}
                    </Badge>
                    {detailState.entry.flags?.isStale && <Badge variant="warning">Stale</Badge>}
                    {detailState.entry.flags?.isOverdue && <Badge variant="destructive">Overdue</Badge>}
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Customer Info</p>
                      <p className="mt-2 text-sm text-white">{detailState.entry.customer?.name || '-'}</p>
                      <p className="mt-1 text-sm text-slate-400">{detailState.entry.customer?.phoneNumber || '-'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Assigned Agent</p>
                      <p className="mt-2 text-sm text-white">{detailState.entry.assignedAgent?.name || 'Belum ditugaskan'}</p>
                      <p className="mt-1 text-sm text-slate-400">{detailState.entry.source || 'Source belum diisi'}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Deal Value</p>
                      <p className="mt-2 text-sm text-white">{formatCrmCurrency(detailState.entry.valueAmount, detailState.entry.currency)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Expected Close</p>
                      <p className="mt-2 text-sm text-white">{detailState.entry.expectedCloseDate ? formatCrmDate(detailState.entry.expectedCloseDate) : 'Belum ada target'}</p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Entry Notes</p>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{detailState.entry.notes || 'Belum ada catatan ringkas pada entry ini.'}</p>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Quick Actions</p>
                      <p className="mt-1 text-sm text-slate-400">Pindahkan stage, ganti agent, tambahkan note, atau ubah outcome lead.</p>
                    </div>
                    <Button variant="outline" onClick={() => openEditLeadDialog(detailState.entry)}>
                      Edit Lead
                    </Button>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Move Stage</Label>
                      <Select value={detailState.stageId || undefined} onValueChange={(value) => setDetailState((current) => ({ ...current, stageId: value }))}>
                        <SelectTrigger className="border-slate-700 bg-slate-950/80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(pipelines.find((pipeline) => pipeline.id === detailState.entry.pipelineId)?.stages || currentStages).map((stage) => (
                            <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button onClick={handleMoveStageFromDetail} disabled={detailState.saving || !detailState.stageId} className="w-full">
                        <ArrowRightLeft className="mr-2 h-4 w-4" />
                        Move Stage
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <Label>Assign Agent</Label>
                      <Select value={detailState.assignedAgentId || FILTER_ALL_VALUE} onValueChange={(value) => setDetailState((current) => ({ ...current, assignedAgentId: value }))}>
                        <SelectTrigger className="border-slate-700 bg-slate-950/80">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={FILTER_ALL_VALUE}>Belum ditugaskan</SelectItem>
                          {agents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button onClick={handleAssignLeadFromDetail} disabled={detailState.saving} className="w-full">
                        <UserRound className="mr-2 h-4 w-4" />
                        Assign Agent
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label>Add Note</Label>
                    <Textarea
                      value={detailState.note}
                      onChange={(event) => setDetailState((current) => ({ ...current, note: event.target.value }))}
                      className="min-h-[110px] border-slate-700 bg-slate-950/80"
                      placeholder="Tulis note internal untuk lead ini"
                    />
                    <Button onClick={handleAddNoteFromDetail} disabled={detailState.saving || !detailState.note.trim()}>
                      <StickyNote className="mr-2 h-4 w-4" />
                      Add Note
                    </Button>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button variant="outline" onClick={() => handleMarkOutcome(wonStage)} disabled={!wonStage || detailState.saving}>
                      Mark Won
                    </Button>
                    <Button variant="outline" onClick={() => handleMarkOutcome(lostStage)} disabled={!lostStage || detailState.saving}>
                      Mark Lost
                    </Button>
                    <Button variant="outline" onClick={handleArchiveFromDetail} disabled={detailState.saving || detailState.entry.isArchived}>
                      {detailState.entry.isArchived ? 'Already Archived' : 'Archive Lead'}
                    </Button>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Activity Timeline</p>
                  <div className="mt-5 space-y-4">
                    {(detailState.entry.activities || []).length === 0 ? (
                      <p className="text-sm text-slate-500">Belum ada activity history.</p>
                    ) : (
                      detailState.entry.activities.map((activity) => (
                        <div key={activity.id} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{getCrmActivityLabel(activity.type)}</Badge>
                            <span className="text-xs text-slate-500">{formatCrmDate(activity.createdAt, { includeTime: true })}</span>
                          </div>
                          <p className="mt-3 text-sm text-slate-200">{activity.note || 'Tidak ada catatan tambahan.'}</p>
                          {(activity.previousStage || activity.newStage) && (
                            <p className="mt-2 text-xs text-slate-500">
                              {activity.previousStage?.name || 'Unknown'} → {activity.newStage?.name || 'Unknown'}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Notes History</p>
                  <div className="mt-5 space-y-3">
                    {(detailState.entry.notesList || []).length === 0 ? (
                      <p className="text-sm text-slate-500">Belum ada note tambahan.</p>
                    ) : (
                      detailState.entry.notesList.map((note) => (
                        <div key={note.id} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                          <p className="text-sm leading-6 text-slate-200">{note.content}</p>
                          <p className="mt-3 text-xs text-slate-500">{note.createdByUser?.name || 'Workspace user'} · {formatCrmDate(note.createdAt, { includeTime: true })}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Appointment History</p>
                  <div className="mt-5 space-y-3">
                    {(detailState.entry.appointmentHistory || []).length === 0 ? (
                      <p className="text-sm text-slate-500">Belum ada appointment untuk customer ini.</p>
                    ) : (
                      detailState.entry.appointmentHistory.map((appointment) => (
                        <div key={appointment.id} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{appointment.status}</Badge>
                            <span className="text-xs text-slate-500">{appointment.agent?.name || 'Agent'}</span>
                          </div>
                          <p className="mt-3 text-sm font-medium text-white">{appointment.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatCrmDate(appointment.scheduledAt, { includeTime: true })}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Payment Reminder History</p>
                  <div className="mt-5 space-y-3">
                    {(detailState.entry.paymentReminderHistory || []).length === 0 ? (
                      <p className="text-sm text-slate-500">Belum ada payment reminder untuk customer ini.</p>
                    ) : (
                      detailState.entry.paymentReminderHistory.map((reminder) => (
                        <div key={reminder.id} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{reminder.status}</Badge>
                            <span className="text-xs text-slate-500">{reminder.agent?.name || 'Agent'}</span>
                          </div>
                          <p className="mt-3 text-sm font-medium text-white">{reminder.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatCrmCurrency(reminder.amount, reminder.currency)} · {formatCrmDate(reminder.dueDate)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Detail lead belum tersedia.</p>
          )}

          {detailState.error && (
            <Alert variant="destructive">
              <AlertDescription>{detailState.error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailState((current) => ({ ...current, open: false }))}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirm.open} onOpenChange={(open) => { if (!deleteConfirm.deleting) setDeleteConfirm((current) => ({ ...current, open })); }}>
        <DialogContent className="max-w-md border-slate-800 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>Hapus Lead Permanen</DialogTitle>
            <DialogDescription className="text-slate-400">
              Tindakan ini tidak dapat dibatalkan. Lead, semua note, dan seluruh riwayat aktivitasnya akan dihapus selamanya.
            </DialogDescription>
          </DialogHeader>
          {deleteConfirm.entry && (
            <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-4">
              <p className="text-sm font-semibold text-white">{deleteConfirm.entry.title}</p>
              {deleteConfirm.entry.customer?.name && (
                <p className="mt-1 text-xs text-slate-400">{deleteConfirm.entry.customer.name}</p>
              )}
              {deleteConfirm.entry.stage && (
                <p className="mt-1 text-xs text-slate-500">Stage terakhir: {deleteConfirm.entry.stage.name}</p>
              )}
            </div>
          )}
          {deleteConfirm.error && (
            <Alert variant="destructive">
              <AlertDescription>{deleteConfirm.error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm({ open: false, entry: null, deleting: false, error: '' })} disabled={deleteConfirm.deleting}>
              Batal
            </Button>
            <Button
              className="bg-red-700 text-white hover:bg-red-600"
              onClick={handlePermanentDelete}
              disabled={deleteConfirm.deleting}
            >
              {deleteConfirm.deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Hapus Permanen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
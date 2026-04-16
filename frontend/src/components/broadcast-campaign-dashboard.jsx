'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Copy,
  Filter,
  Loader2,
  Lock,
  Megaphone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import api from '@/lib/api';
import {
  BROADCAST_APPROVAL_STATUS_OPTIONS,
  BROADCAST_CUSTOMER_STATUS_OPTIONS,
  BROADCAST_FILTER_MODES,
  BROADCAST_FILTER_TYPES,
  BROADCAST_LAST_ACTIVITY_OPERATOR_OPTIONS,
  formatBroadcastCampaignStatus,
  formatBroadcastDate,
  formatBroadcastPercentage,
  formatBroadcastRecipientStatus,
  getBroadcastCampaignBadgeVariant,
  getBroadcastFilterDefinition,
  getBroadcastRecipientBadgeVariant,
  getBroadcastTierLimits,
} from '@/lib/broadcastCampaign';
import { INTERNAL_SKILL_KEYS } from '@/lib/internalSkills';
import { cn } from '@/lib/utils';

function resolveAssignedSkills(agent) {
  if (Array.isArray(agent?.configJson?.assignedSkills)) {
    return agent.configJson.assignedSkills.map((skill) => String(skill || '').trim()).filter(Boolean);
  }

  if (agent?.openclawSkill) {
    return [String(agent.openclawSkill).trim()].filter(Boolean);
  }

  return [];
}

function createFilterId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildDefaultFilter(filterType = 'CRM_STAGE') {
  return {
    localId: createFilterId(),
    filterType,
    includeMode: 'INCLUDE',
    operator: '',
    valueJson: {},
  };
}

function buildDefaultForm(defaultAgentId = '') {
  return {
    assignedAgentId: defaultAgentId || '',
    title: '',
    description: '',
    messageTemplate: '',
    channelType: 'WHATSAPP',
    status: 'DRAFT',
    scheduledAt: '',
    audienceFilters: [buildDefaultFilter()],
  };
}

function buildFormFromCampaign(campaign) {
  return {
    assignedAgentId: campaign?.assignedAgentId || '',
    title: campaign?.title || '',
    description: campaign?.description || '',
    messageTemplate: campaign?.messageTemplate || '',
    channelType: campaign?.channelType || 'WHATSAPP',
    status: ['DRAFT', 'SCHEDULED'].includes(String(campaign?.status || '').toUpperCase())
      ? String(campaign.status).toUpperCase()
      : 'DRAFT',
    scheduledAt: toDateTimeLocal(campaign?.scheduledAt),
    audienceFilters: Array.isArray(campaign?.audiences) && campaign.audiences.length > 0
      ? campaign.audiences.map((filter) => ({
        localId: filter.id || createFilterId(),
        filterType: filter.filterType || 'CRM_STAGE',
        includeMode: filter.includeMode || 'INCLUDE',
        operator: filter.operator || '',
        valueJson: filter.valueJson || {},
      }))
      : [buildDefaultFilter()],
  };
}

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60_000));
  return localDate.toISOString().slice(0, 16);
}

function serializeAudienceFilters(filters = []) {
  return filters
    .map((filter, index) => ({
      filterType: filter.filterType,
      includeMode: filter.includeMode || 'INCLUDE',
      operator: filter.operator || undefined,
      position: index,
      valueJson: filter.valueJson || {},
    }))
    .filter((filter) => filter.filterType);
}

function serializeCampaignForm(form) {
  return {
    assignedAgentId: form.assignedAgentId,
    title: form.title.trim(),
    description: form.description.trim() || null,
    messageTemplate: form.messageTemplate,
    channelType: form.channelType,
    status: form.status,
    scheduledAt: form.status === 'SCHEDULED' && form.scheduledAt
      ? new Date(form.scheduledAt)
      : undefined,
    audienceFilters: serializeAudienceFilters(form.audienceFilters),
  };
}

function toggleArrayValue(values = [], nextValue) {
  const normalizedValues = Array.isArray(values) ? values : [];
  return normalizedValues.includes(nextValue)
    ? normalizedValues.filter((value) => value !== nextValue)
    : [...normalizedValues, nextValue];
}

function getErrorMessage(error, fallbackMessage) {
  return error?.response?.data?.message || fallbackMessage;
}

function StatsCard({ label, value, helper, icon: Icon, className = '' }) {
  return (
    <Card className={cn('border-slate-800 bg-slate-900/85', className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
            <p className="mt-2 text-sm text-slate-400">{helper}</p>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-3">
            <Icon className="h-5 w-5 text-slate-100" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CampaignCard({ campaign, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(campaign.id)}
      className={cn(
        'w-full rounded-3xl border p-4 text-left transition',
        selected
          ? 'border-sky-400/40 bg-sky-500/10 shadow-[0_0_0_1px_rgba(56,189,248,0.18)]'
          : 'border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-900',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{campaign.title}</p>
            <Badge variant={getBroadcastCampaignBadgeVariant(campaign.status)}>
              {formatBroadcastCampaignStatus(campaign.status)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {campaign.channelType} . {campaign.assignedAgent?.name || 'No agent'}
          </p>
        </div>
        <div className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1 text-[11px] text-slate-300">
          {campaign.totalAudience || campaign.audiencePreviewCount || 0} audience
        </div>
      </div>

      <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-300">
        {campaign.description || campaign.messageTemplate}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-400">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
          <p className="uppercase tracking-[0.22em] text-slate-500">Delivered</p>
          <p className="mt-1 text-base font-semibold text-white">{campaign.totalDelivered || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-3 py-2">
          <p className="uppercase tracking-[0.22em] text-slate-500">Delivery Rate</p>
          <p className="mt-1 text-base font-semibold text-white">{formatBroadcastPercentage(campaign.deliveryRate || 0)}</p>
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Updated {formatBroadcastDate(campaign.updatedAt)}
      </p>
    </button>
  );
}

function AudiencePreviewPanel({ preview, workspaceTier }) {
  if (!preview) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-sm text-slate-400">
        Audience preview akan muncul di sini setelah Anda menjalankan preview dari builder.
      </div>
    );
  }

  const tierLimits = getBroadcastTierLimits(workspaceTier);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-700 bg-slate-950/80 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Matched Audience</p>
          <p className="mt-2 text-2xl font-semibold text-white">{preview.summary?.matchedCount || 0}</p>
          <p className="mt-1 text-xs text-slate-400">Audience yang cocok dengan filter include/exclude saat ini.</p>
        </div>
        <div className="rounded-2xl border border-slate-700 bg-slate-950/80 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Deliverable Now</p>
          <p className="mt-2 text-2xl font-semibold text-white">{preview.summary?.deliverableCount || 0}</p>
          <p className="mt-1 text-xs text-slate-400">Customer yang sudah lolos validasi channel, status, dan session saat preview.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Tier Guardrail</p>
          <Badge variant={preview.summary?.overAudienceLimit ? 'destructive' : 'outline'}>
            {tierLimits.maxAudience === null ? 'Unlimited audience' : `Max ${tierLimits.maxAudience} audience`}
          </Badge>
        </div>
        <p className="text-sm text-slate-200">
          {preview.summary?.overAudienceLimit
            ? `Audience saat ini melewati batas ${workspaceTier} dan campaign tidak bisa disimpan dalam konfigurasi ini.`
            : 'Audience saat ini masih berada di dalam batas tier workspace.'}
        </p>
        <div className="grid grid-cols-2 gap-3 text-xs text-slate-400 sm:grid-cols-4">
          <span>Blocked: {preview.summary?.blockedCount || 0}</span>
          <span>Archived: {preview.summary?.archivedCount || 0}</span>
          <span>Missing Session: {preview.summary?.missingChannelSessionCount || 0}</span>
          <span>Channel Mismatch: {preview.summary?.channelMismatchCount || 0}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Preview Customers</p>
          <span className="text-xs text-slate-500">Top {preview.previewCustomers?.length || 0} sample</span>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {(preview.previewCustomers || []).length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada sample audience.</p>
          ) : (
            (preview.previewCustomers || []).map((customer) => (
              <div key={customer.customerId} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm text-slate-200">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">{customer.name || customer.phoneNumber}</p>
                    <p className="text-xs text-slate-500">{customer.phoneNumber}</p>
                  </div>
                  <Badge variant={customer.previewStatus === 'DELIVERABLE' ? 'success' : 'warning'}>
                    {customer.previewStatus}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                  <span>Status: {customer.lifecycleStatus}</span>
                  {customer.tags?.length > 0 && <span>Tags: {customer.tags.join(', ')}</span>}
                  {customer.previewReason && <span>Reason: {customer.previewReason}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function DeliveryLogTable({ recipients = [], delivery = null, onRetryFailed, retrying }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Success</p>
          <p className="mt-2 text-2xl font-semibold text-white">{delivery?.successCount || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Failed</p>
          <p className="mt-2 text-2xl font-semibold text-white">{delivery?.failedCount || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Skipped</p>
          <p className="mt-2 text-2xl font-semibold text-white">{delivery?.skippedCount || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Delivery Rate</p>
          <p className="mt-2 text-2xl font-semibold text-white">{formatBroadcastPercentage(delivery?.deliveryPercentage || 0)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">Delivery Progress</p>
            <p className="text-xs text-slate-500">Persentase recipient yang sudah delivered.</p>
          </div>
          <Button variant="outline" size="sm" onClick={onRetryFailed} disabled={retrying || !delivery?.failedCount}>
            {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            Retry Failed Recipient
          </Button>
        </div>
        <Progress value={Number(delivery?.deliveryPercentage || 0)} className="h-2 bg-slate-800 [&>div]:bg-emerald-400" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/70">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800 text-sm">
            <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-[0.24em] text-slate-500">
              <tr>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Channel / Session</th>
                <th className="px-4 py-3">Message Preview</th>
                <th className="px-4 py-3">Error Reason</th>
                <th className="px-4 py-3">Last Event</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {recipients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    Belum ada recipient pada campaign ini.
                  </td>
                </tr>
              ) : (
                recipients.map((recipient) => {
                  const meta = recipient.metadataJson || {};
                  const channelType = meta.channelType || '-';
                  const agentId = meta.agentId ? meta.agentId.slice(0, 12) + '…' : null;
                  const renderedPreview = meta.renderedText ? meta.renderedText.slice(0, 60) + (meta.renderedText.length > 60 ? '…' : '') : null;
                  const rawError = recipient.errorMessage || '';
                  // Extract clean error from adapter error strings
                  let cleanError = rawError;
                  try {
                    const gwMatch = rawError.match(/"message":"([^"]+)"/);
                    if (gwMatch) cleanError = gwMatch[1];
                    else if (rawError.includes('-> 500:')) cleanError = 'Adapter 500: ' + (rawError.split('-> 500:')[1] || '').slice(0, 120).trim();
                    else if (rawError.includes('-> 404:')) cleanError = 'Gateway 404: ' + (rawError.split('-> 404:')[1] || '').slice(0, 80).trim();
                  } catch {}
                  return (
                    <tr key={recipient.id} className="align-top text-slate-200">
                      <td className="px-4 py-3">
                        <p className="font-medium text-white">{recipient.customer?.name || recipient.customer?.phoneNumber || recipient.customerId}</p>
                        <p className="text-xs text-slate-500">{recipient.customer?.phoneNumber || recipient.customerId}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={getBroadcastRecipientBadgeVariant(recipient.recipientStatus)}>
                          {formatBroadcastRecipientStatus(recipient.recipientStatus)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-medium text-slate-300">{channelType}</p>
                        {agentId && <p className="text-xs text-slate-500">agent: {agentId}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {renderedPreview ? (
                          <p className="max-w-[200px] text-xs text-slate-400 italic">{renderedPreview}</p>
                        ) : (
                          <span className="text-xs text-slate-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-[260px]">
                        {rawError ? (
                          <div>
                            <p className="text-xs text-red-300 break-words">{cleanError}</p>
                            {cleanError !== rawError && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs text-slate-600 hover:text-slate-400">Full error</summary>
                                <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-500 break-all">{rawError}</pre>
                              </details>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {formatBroadcastDate(
                          recipient.deliveredAt
                          || recipient.failedAt
                          || recipient.skippedAt
                          || recipient.sentAt
                          || recipient.lastAttemptAt,
                        )}
                        <p className="text-slate-600">#{recipient.attemptCount || 0} attempt</p>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function BroadcastCampaignDashboard({ initialCampaignId = '' }) {
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceTier, setWorkspaceTier] = useState('FREE');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [usage, setUsage] = useState(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState(initialCampaignId || '');
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [deliveryLog, setDeliveryLog] = useState({ recipients: [], delivery: null });
  const [agents, setAgents] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [stages, setStages] = useState([]);
  const [retryingRecipients, setRetryingRecipients] = useState(false);
  const [dialogState, setDialogState] = useState({
    open: false,
    mode: 'create',
    saving: false,
    previewing: false,
    error: '',
    preview: null,
    form: buildDefaultForm(),
  });

  const tierLimits = getBroadcastTierLimits(workspaceTier);
  const filteredCampaigns = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return campaigns;

    return campaigns.filter((campaign) => [
      campaign.title,
      campaign.description,
      campaign.channelType,
      campaign.assignedAgent?.name,
      campaign.status,
    ].some((field) => String(field || '').toLowerCase().includes(normalizedSearch)));
  }, [campaigns, search]);

  const broadcastAgents = useMemo(() => {
    return agents.filter((agent) => {
      const assignedSkills = resolveAssignedSkills(agent);
      return assignedSkills.includes(INTERNAL_SKILL_KEYS.BROADCAST_CAMPAIGN) && agent.accessMode === 'APPROVAL_REQUIRED';
    });
  }, [agents]);

  async function loadCampaignDetail(campaignId, wsId = workspaceId) {
    if (!campaignId || !wsId) {
      setSelectedCampaign(null);
      setDeliveryLog({ recipients: [], delivery: null });
      return;
    }

    const [{ data: detailData }, { data: recipientsData }] = await Promise.all([
      api.get(`/broadcast-campaigns/${campaignId}`, { params: { workspaceId: wsId } }),
      api.get(`/broadcast-campaigns/${campaignId}/recipients`, { params: { workspaceId: wsId } }),
    ]);

    setSelectedCampaign(detailData.campaign || null);
    setDeliveryLog({
      recipients: Array.isArray(recipientsData.recipients) ? recipientsData.recipients : [],
      delivery: recipientsData.delivery || null,
    });
  }

  async function loadDashboardData(options = {}) {
    const { silent = false, focusCampaignId = selectedCampaignId || initialCampaignId || '' } = options;

    if (!silent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const { data: me } = await api.get('/auth/me');
      const wsId = me.workspace?.id || '';
      const tier = me.workspace?.subTier || 'FREE';
      setWorkspaceId(wsId);
      setWorkspaceTier(tier);

      if (!wsId) {
        setCampaigns([]);
        setAnalytics(null);
        setUsage(null);
        setSelectedCampaign(null);
        setDeliveryLog({ recipients: [], delivery: null });
        return;
      }

      const [campaignsResult, analyticsResult, agentsResult, customersResult, pipelinesResult] = await Promise.all([
        api.get('/broadcast-campaigns', { params: { workspaceId: wsId } }),
        api.get('/broadcast-campaigns/analytics/summary', { params: { workspaceId: wsId } }),
        api.get('/agents', { params: { workspaceId: wsId } }),
        api.get('/customers', { params: { workspaceId: wsId, status: 'ALL', limit: 200 } }),
        api.get('/crm/pipelines', { params: { workspaceId: wsId } }).catch(() => ({ data: { pipelines: [] } })),
      ]);

      const nextCampaigns = Array.isArray(campaignsResult.data?.campaigns) ? campaignsResult.data.campaigns : [];
      const nextAgents = Array.isArray(agentsResult.data?.agents) ? agentsResult.data.agents : [];
      const nextCustomers = Array.isArray(customersResult.data?.customers) ? customersResult.data.customers : [];
      const nextPipelines = Array.isArray(pipelinesResult.data?.pipelines) ? pipelinesResult.data.pipelines : [];
      const nextStages = [...new Map(nextPipelines.flatMap((pipeline) => (pipeline.stages || [])).map((stage) => [stage.id, stage])).values()];

      setCampaigns(nextCampaigns);
      setAnalytics(analyticsResult.data?.analytics || campaignsResult.data?.analytics || null);
      setUsage(analyticsResult.data?.usage || campaignsResult.data?.usage || null);
      setAgents(nextAgents);
      setCustomers(nextCustomers);
      setStages(nextStages);

      const nextSelectedCampaignId = focusCampaignId || nextCampaigns[0]?.id || '';
      setSelectedCampaignId(nextSelectedCampaignId);

      if (nextSelectedCampaignId) {
        await loadCampaignDetail(nextSelectedCampaignId, wsId);
      } else {
        setSelectedCampaign(null);
        setDeliveryLog({ recipients: [], delivery: null });
      }

      setError('');
    } catch (loadError) {
      setError(getErrorMessage(loadError, 'Gagal memuat Broadcast Campaign dashboard'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadDashboardData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSelectCampaign(campaignId) {
    setSelectedCampaignId(campaignId);
    try {
      await loadCampaignDetail(campaignId);
    } catch (detailError) {
      setError(getErrorMessage(detailError, 'Gagal memuat detail campaign'));
    }
  }

  function openCreateDialog() {
    setDialogState({
      open: true,
      mode: 'create',
      saving: false,
      previewing: false,
      error: '',
      preview: null,
      form: buildDefaultForm(broadcastAgents[0]?.id || ''),
    });
  }

  function openEditDialog() {
    if (!selectedCampaign) return;

    setDialogState({
      open: true,
      mode: 'edit',
      saving: false,
      previewing: false,
      error: '',
      preview: null,
      form: buildFormFromCampaign(selectedCampaign),
    });
  }

  function updateDialogForm(patch) {
    setDialogState((current) => ({
      ...current,
      form: {
        ...current.form,
        ...patch,
      },
    }));
  }

  function updateAudienceFilter(localId, updater) {
    setDialogState((current) => ({
      ...current,
      form: {
        ...current.form,
        audienceFilters: current.form.audienceFilters.map((filter) => {
          if (filter.localId !== localId) return filter;
          return typeof updater === 'function' ? updater(filter) : { ...filter, ...updater };
        }),
      },
    }));
  }

  function addAudienceFilter() {
    setDialogState((current) => ({
      ...current,
      form: {
        ...current.form,
        audienceFilters: [...current.form.audienceFilters, buildDefaultFilter()],
      },
    }));
  }

  function removeAudienceFilter(localId) {
    setDialogState((current) => {
      const nextFilters = current.form.audienceFilters.filter((filter) => filter.localId !== localId);
      return {
        ...current,
        form: {
          ...current.form,
          audienceFilters: nextFilters.length > 0 ? nextFilters : [buildDefaultFilter()],
        },
      };
    });
  }

  async function handlePreviewAudience() {
    if (!workspaceId) return;

    setDialogState((current) => ({ ...current, previewing: true, error: '' }));
    try {
      const payload = serializeCampaignForm(dialogState.form);
      const { data } = await api.post('/broadcast-campaigns/audience-preview', {
        workspaceId,
        assignedAgentId: payload.assignedAgentId,
        channelType: payload.channelType,
        audienceFilters: payload.audienceFilters,
      });

      setDialogState((current) => ({ ...current, previewing: false, preview: data }));
    } catch (previewError) {
      setDialogState((current) => ({
        ...current,
        previewing: false,
        error: getErrorMessage(previewError, 'Gagal mempreview audience broadcast'),
      }));
    }
  }

  async function handleSaveCampaign() {
    if (!workspaceId) return;

    setDialogState((current) => ({ ...current, saving: true, error: '' }));

    try {
      const payload = serializeCampaignForm(dialogState.form);
      let focusCampaignId = selectedCampaign?.id || initialCampaignId || '';

      if (dialogState.mode === 'create') {
        const { data } = await api.post('/broadcast-campaigns', {
          workspaceId,
          ...payload,
        });
        focusCampaignId = data.campaign?.id || focusCampaignId;
      } else if (selectedCampaign) {
        const { data } = await api.put(`/broadcast-campaigns/${selectedCampaign.id}`, {
          workspaceId,
          ...payload,
        });
        focusCampaignId = data.campaign?.id || selectedCampaign.id;
      }

      setDialogState((current) => ({ ...current, open: false, saving: false }));
      await loadDashboardData({ silent: true, focusCampaignId });
    } catch (saveError) {
      setDialogState((current) => ({
        ...current,
        saving: false,
        error: getErrorMessage(saveError, 'Gagal menyimpan broadcast campaign'),
      }));
    }
  }

  async function handleDuplicateCampaign() {
    if (!selectedCampaign || !workspaceId) return;

    try {
      const { data } = await api.post(`/broadcast-campaigns/${selectedCampaign.id}/duplicate`, { workspaceId });
      await loadDashboardData({ silent: true, focusCampaignId: data.campaign?.id || selectedCampaign.id });
    } catch (duplicateError) {
      setError(getErrorMessage(duplicateError, 'Gagal menduplikasi campaign'));
    }
  }

  async function handleCancelCampaign() {
    if (!selectedCampaign || !workspaceId) return;
    if (typeof window !== 'undefined' && !window.confirm('Batalkan campaign ini? Recipient yang belum terkirim akan ditandai skipped.')) {
      return;
    }

    try {
      await api.post(`/broadcast-campaigns/${selectedCampaign.id}/cancel`, { workspaceId });
      await loadDashboardData({ silent: true, focusCampaignId: selectedCampaign.id });
    } catch (cancelError) {
      setError(getErrorMessage(cancelError, 'Gagal membatalkan campaign'));
    }
  }

  async function handleDeleteCampaign() {
    if (!selectedCampaign || !workspaceId) return;
    if (typeof window !== 'undefined' && !window.confirm('Hapus campaign ini? Semua recipient log juga akan ikut terhapus.')) {
      return;
    }

    try {
      await api.delete(`/broadcast-campaigns/${selectedCampaign.id}`, { params: { workspaceId } });
      await loadDashboardData({ silent: true, focusCampaignId: '' });
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, 'Gagal menghapus campaign'));
    }
  }

  async function handleRetryFailedRecipients() {
    if (!selectedCampaign || !workspaceId) return;

    setRetryingRecipients(true);
    try {
      await api.post(`/broadcast-campaigns/${selectedCampaign.id}/retry-failed`, { workspaceId });
      await loadDashboardData({ silent: true, focusCampaignId: selectedCampaign.id });
    } catch (retryError) {
      setError(getErrorMessage(retryError, 'Gagal menjadwalkan ulang recipient gagal'));
    } finally {
      setRetryingRecipients(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const headerStats = [
    {
      label: 'Total Campaigns',
      value: analytics?.totalCampaigns ?? 0,
      helper: 'Campaign workspace yang pernah dibuat.',
      icon: Megaphone,
      className: 'bg-[linear-gradient(180deg,rgba(56,189,248,0.12),rgba(15,23,42,0.92))]',
    },
    {
      label: 'Total Sent',
      value: analytics?.totalSent ?? 0,
      helper: 'Recipient yang berhasil dikirim oleh worker.',
      icon: Send,
      className: 'bg-[linear-gradient(180deg,rgba(94,234,212,0.12),rgba(15,23,42,0.92))]',
    },
    {
      label: 'Total Delivered',
      value: analytics?.totalDelivered ?? 0,
      helper: 'Recipient dengan status delivered pada log.',
      icon: CheckCircle2,
      className: 'bg-[linear-gradient(180deg,rgba(52,211,153,0.12),rgba(15,23,42,0.92))]',
    },
    {
      label: 'Total Failed',
      value: analytics?.totalFailed ?? 0,
      helper: 'Recipient yang gagal dan bisa dijadwalkan ulang.',
      icon: XCircle,
      className: 'bg-[linear-gradient(180deg,rgba(248,113,113,0.12),rgba(15,23,42,0.92))]',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">Broadcast Campaign</Badge>
            <Badge variant="outline">Workspace {workspaceTier}</Badge>
            <Badge variant={tierLimits.advancedAnalytics ? 'success' : 'warning'}>
              {tierLimits.advancedAnalytics ? 'Advanced analytics enabled' : 'Advanced analytics on Pro'}
            </Badge>
          </div>
          <h1 className="mt-4 text-3xl font-bold text-white md:text-4xl">Audience builder, scheduler, and delivery log for internal broadcasts.</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            Skill ini mengikuti pola internal MyAgentClaw: sidebar, dashboard, worker, assignment agent, install/active lifecycle, usage tracking, analytics, dan guardrail tier serta capability per workspace.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => loadDashboardData({ silent: true, focusCampaignId: selectedCampaignId })} disabled={refreshing}>
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            New Campaign
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Broadcast Campaign Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {headerStats.map((stat) => (
          <StatsCard key={stat.label} {...stat} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <Card className="border-slate-800 bg-slate-900/85">
          <CardHeader className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-white">Campaign List</CardTitle>
                <p className="mt-1 text-sm text-slate-400">Installed vs active mengikuti assignment agent dan worker workspace.</p>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
                {usage?.activeAgentCount || 0} active agent
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Tier Guardrail</p>
              <p className="text-sm text-slate-200">
                {tierLimits.maxCampaigns === null
                  ? 'Campaign unlimited untuk tier ini.'
                  : `Maksimal ${tierLimits.maxCampaigns} campaign aktif per workspace dan ${tierLimits.maxAudience} audience per campaign.`}
              </p>
              <p className="text-xs text-slate-400">
                Total campaign tercatat: {usage?.totalCampaignCreated || 0} . Audience reached: {usage?.totalAudienceReached || 0}
              </p>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari campaign, channel, agent, atau status"
                className="border-slate-700 bg-slate-950/80 pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredCampaigns.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/50 p-8 text-center">
                <Megaphone className="mx-auto h-6 w-6 text-slate-500" />
                <p className="mt-4 text-lg font-semibold text-white">Belum ada broadcast campaign</p>
                <p className="mt-2 text-sm text-slate-400">Mulai dari campaign draft, preview audience, lalu schedule saat siap.</p>
                <Button className="mt-5" onClick={openCreateDialog}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create First Campaign
                </Button>
              </div>
            ) : (
              filteredCampaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  selected={campaign.id === selectedCampaignId}
                  onSelect={handleSelectCampaign}
                />
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selectedCampaign ? (
            <>
              <Card className="border-slate-800 bg-slate-900/85">
                <CardHeader>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-white">{selectedCampaign.title}</CardTitle>
                        <Badge variant={getBroadcastCampaignBadgeVariant(selectedCampaign.status)}>
                          {formatBroadcastCampaignStatus(selectedCampaign.status)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-400">
                        {selectedCampaign.description || 'Campaign ini belum memiliki deskripsi tambahan.'}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={openEditDialog} disabled={!['DRAFT', 'SCHEDULED'].includes(String(selectedCampaign.status || '').toUpperCase())}>
                        <Filter className="mr-2 h-4 w-4" />
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleDuplicateCampaign}>
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicate
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleCancelCampaign} disabled={['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(selectedCampaign.status || '').toUpperCase())}>
                        <ShieldAlert className="mr-2 h-4 w-4" />
                        Cancel
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleDeleteCampaign} disabled={String(selectedCampaign.status || '').toUpperCase() === 'RUNNING'}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Channel</p>
                      <p className="mt-2 text-lg font-semibold text-white">{selectedCampaign.channelType}</p>
                      <p className="mt-1 text-xs text-slate-400">Assigned agent: {selectedCampaign.assignedAgent?.name || '-'}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Audience</p>
                      <p className="mt-2 text-lg font-semibold text-white">{selectedCampaign.totalAudience || 0}</p>
                      <p className="mt-1 text-xs text-slate-400">Preview count: {selectedCampaign.audiencePreviewCount || 0}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Delivered</p>
                      <p className="mt-2 text-lg font-semibold text-white">{selectedCampaign.totalDelivered || 0}</p>
                      <p className="mt-1 text-xs text-slate-400">Failed {selectedCampaign.totalFailed || 0} . Skipped {selectedCampaign.totalSkipped || 0}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Schedule</p>
                      <p className="mt-2 text-lg font-semibold text-white">{formatBroadcastDate(selectedCampaign.scheduledAt)}</p>
                      <p className="mt-1 text-xs text-slate-400">Updated {formatBroadcastDate(selectedCampaign.updatedAt)}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
                    <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Message Template</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{selectedCampaign.messageTemplate}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Usage Snapshot</p>
                      <p className="text-sm text-slate-200">Created by {selectedCampaign.createdBy?.name || 'Workspace Owner'}</p>
                      <p className="text-sm text-slate-400">Started {formatBroadcastDate(selectedCampaign.startedAt)}</p>
                      <p className="text-sm text-slate-400">Completed {formatBroadcastDate(selectedCampaign.completedAt)}</p>
                      {selectedCampaign.lastError && (() => {
                        const raw = selectedCampaign.lastError;
                        let clean = raw;
                        try {
                          const gwMatch = raw.match(/"message":"([^"]+)"/);
                          if (gwMatch) clean = gwMatch[1];
                          else if (raw.includes('-> 500:')) clean = 'Adapter 500: ' + (raw.split('-> 500:')[1] || '').slice(0, 160).trim();
                          else if (raw.includes('-> 404:')) clean = 'Gateway 404: ' + (raw.split('-> 404:')[1] || '').slice(0, 120).trim();
                        } catch {}
                        return (
                          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-3 space-y-1">
                            <p className="text-sm text-red-200 font-medium">{clean}</p>
                            {clean !== raw && (
                              <details>
                                <summary className="cursor-pointer text-xs text-red-400/60 hover:text-red-400">Full error</summary>
                                <pre className="mt-1 whitespace-pre-wrap text-xs text-red-300/60 break-all">{raw}</pre>
                              </details>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Audience Filters</p>
                      <span className="text-xs text-slate-500">{selectedCampaign.audiences?.length || 0} filters</span>
                    </div>
                    {selectedCampaign.audiences?.length ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {selectedCampaign.audiences.map((filter) => {
                          const filterDefinition = getBroadcastFilterDefinition(filter.filterType);
                          return (
                            <div key={filter.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-white">{filterDefinition.label}</p>
                                <Badge variant={filter.includeMode === 'EXCLUDE' ? 'warning' : 'outline'}>{filter.includeMode}</Badge>
                              </div>
                              <p className="mt-2 text-xs text-slate-500">{filterDefinition.description}</p>
                              <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300">{JSON.stringify(filter.valueJson || {}, null, 2)}</pre>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">Campaign ini belum menyimpan filter audience.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-800 bg-slate-900/85">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle className="text-white">Delivery Log</CardTitle>
                      <p className="mt-1 text-sm text-slate-400">Recipient status, failure reason, dan retry flow mengikuti worker broadcast.</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <BarChart3 className="h-4 w-4" />
                      Workspace analytics {analytics?.advancedAnalyticsEnabled ? 'ready' : 'basic tier'}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <DeliveryLogTable
                    recipients={deliveryLog.recipients}
                    delivery={deliveryLog.delivery}
                    onRetryFailed={handleRetryFailedRecipients}
                    retrying={retryingRecipients}
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-dashed border-slate-700 bg-slate-900/70">
              <CardContent className="flex min-h-[24rem] flex-col items-center justify-center px-8 py-14 text-center">
                <Megaphone className="h-8 w-8 text-slate-500" />
                <h2 className="mt-5 text-2xl font-semibold text-white">Pilih campaign untuk melihat detail</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
                  Campaign detail akan menampilkan status kirim, filter audience, analytics, dan delivery log recipient pada panel ini.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="border-slate-800 bg-slate-900/85 xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-white">Broadcast Analytics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Delivery Rate</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{formatBroadcastPercentage(analytics?.deliveryRate || 0)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Most Used Channel</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{analytics?.mostUsedChannel?.channelType || '-'}</p>
                    {!analytics?.advancedAnalyticsEnabled && <p className="mt-1 text-xs text-slate-500">Unlock on Pro tier</p>}
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Top Performing Agent</p>
                    <p className="mt-2 text-lg font-semibold text-white">{analytics?.topPerformingAgent?.name || '-'}</p>
                    {!analytics?.advancedAnalyticsEnabled && <p className="mt-1 text-xs text-slate-500">Unlock on Pro tier</p>}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Top Campaign</p>
                      <p className="mt-2 text-lg font-semibold text-white">{analytics?.topCampaign?.title || '-'}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {analytics?.advancedAnalyticsEnabled
                          ? `${formatBroadcastPercentage(analytics?.topCampaign?.deliveryRate || 0)} delivery rate . ${analytics?.topCampaign?.totalDelivered || 0} delivered`
                          : 'Advanced ranking analytics tersedia mulai tier Pro.'}
                      </p>
                    </div>
                    {!analytics?.advancedAnalyticsEnabled && <Lock className="h-5 w-5 text-slate-500" />}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-800 bg-slate-900/85">
              <CardHeader>
                <CardTitle className="text-white">Guardrails</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-300">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="font-medium text-white">Agent Restriction</p>
                  <p className="mt-2 text-slate-400">Open Access agent tidak bisa memakai Broadcast Campaign. Pilih agent dengan access mode Approval Required.</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="font-medium text-white">Tier Restriction</p>
                  <p className="mt-2 text-slate-400">
                    {tierLimits.maxCampaigns === null
                      ? 'Workspace ini memiliki campaign dan audience unlimited.'
                      : `Workspace ini dibatasi ${tierLimits.maxCampaigns} campaign dan ${tierLimits.maxAudience} audience per campaign.`}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="font-medium text-white">Worker Behavior</p>
                  <p className="mt-2 text-slate-400">Worker akan filter customer invalid, blocked, archived, atau tanpa channel session yang sesuai sebelum mengirim broadcast.</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={dialogState.open} onOpenChange={(open) => setDialogState((current) => ({ ...current, open }))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-950 text-white sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{dialogState.mode === 'create' ? 'Create Broadcast Campaign' : 'Edit Broadcast Campaign'}</DialogTitle>
            <DialogDescription className="text-slate-400">
              Audience preview akan menghitung customer yang match, deliverable sekarang, dan alasan skip sebelum campaign disimpan.
            </DialogDescription>
          </DialogHeader>

          {dialogState.error && (
            <Alert variant="destructive">
              <AlertDescription>{dialogState.error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Campaign Title</Label>
                  <Input
                    value={dialogState.form.title}
                    onChange={(event) => updateDialogForm({ title: event.target.value })}
                    placeholder="Contoh: Broadcast Promo Ramadan"
                    className="border-slate-700 bg-slate-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Assigned Agent</Label>
                  <Select value={dialogState.form.assignedAgentId || undefined} onValueChange={(value) => updateDialogForm({ assignedAgentId: value })}>
                    <SelectTrigger className="border-slate-700 bg-slate-900">
                      <SelectValue placeholder="Pilih agent broadcast" />
                    </SelectTrigger>
                    <SelectContent>
                      {broadcastAgents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Channel</Label>
                  <Select value={dialogState.form.channelType} onValueChange={(value) => updateDialogForm({ channelType: value })}>
                    <SelectTrigger className="border-slate-700 bg-slate-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                      <SelectItem value="TELEGRAM">Telegram</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={dialogState.form.status} onValueChange={(value) => updateDialogForm({ status: value })}>
                    <SelectTrigger className="border-slate-700 bg-slate-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                      <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Schedule Picker</Label>
                  <Input
                    type="datetime-local"
                    value={dialogState.form.scheduledAt}
                    onChange={(event) => updateDialogForm({ scheduledAt: event.target.value })}
                    className="border-slate-700 bg-slate-900"
                    disabled={dialogState.form.status !== 'SCHEDULED'}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={dialogState.form.description}
                  onChange={(event) => updateDialogForm({ description: event.target.value })}
                  placeholder="Ringkasan goal, target audience, dan timing campaign ini."
                  className="min-h-[88px] border-slate-700 bg-slate-900"
                />
              </div>

              <div className="space-y-2">
                <Label>Template Editor</Label>
                <Textarea
                  value={dialogState.form.messageTemplate}
                  onChange={(event) => updateDialogForm({ messageTemplate: event.target.value })}
                  placeholder="Tulis template pesan broadcast di sini."
                  className="min-h-[180px] border-slate-700 bg-slate-900"
                />
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">Audience Builder</p>
                    <p className="mt-1 text-sm text-slate-400">Gabungkan include dan exclude filters sebelum menyimpan campaign.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={addAudienceFilter}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Filter
                  </Button>
                </div>

                <div className="space-y-4">
                  {dialogState.form.audienceFilters.map((filter) => {
                    const filterDefinition = getBroadcastFilterDefinition(filter.filterType);
                    const selectedValues = filter.valueJson || {};

                    return (
                      <div key={filter.localId} className="rounded-3xl border border-slate-800 bg-slate-950/70 p-4 space-y-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="grid flex-1 gap-3 md:grid-cols-[160px_140px_minmax(0,1fr)]">
                            <div className="space-y-2">
                              <Label>Filter Type</Label>
                              <Select
                                value={filter.filterType}
                                onValueChange={(value) => updateAudienceFilter(filter.localId, {
                                  filterType: value,
                                  operator: '',
                                  valueJson: {},
                                })}
                              >
                                <SelectTrigger className="border-slate-700 bg-slate-900">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {BROADCAST_FILTER_TYPES.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-2">
                              <Label>Mode</Label>
                              <Select value={filter.includeMode} onValueChange={(value) => updateAudienceFilter(filter.localId, { includeMode: value })}>
                                <SelectTrigger className="border-slate-700 bg-slate-900">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {BROADCAST_FILTER_MODES.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-400">
                              {filterDefinition.description}
                            </div>
                          </div>

                          <Button variant="ghost" size="sm" onClick={() => removeAudienceFilter(filter.localId)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Remove
                          </Button>
                        </div>

                        {filter.filterType === 'CRM_STAGE' && (
                          <div className="space-y-2">
                            <Label>CRM Stage</Label>
                            <div className="flex flex-wrap gap-2">
                              {stages.map((stage) => {
                                const checked = Array.isArray(selectedValues.stageIds) && selectedValues.stageIds.includes(stage.id);
                                return (
                                  <button
                                    key={stage.id}
                                    type="button"
                                    onClick={() => updateAudienceFilter(filter.localId, {
                                      valueJson: {
                                        ...selectedValues,
                                        stageIds: toggleArrayValue(selectedValues.stageIds, stage.id),
                                      },
                                    })}
                                    className={cn(
                                      'rounded-full border px-3 py-2 text-xs transition',
                                      checked
                                        ? 'border-sky-400/40 bg-sky-500/10 text-sky-100'
                                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white',
                                    )}
                                  >
                                    {stage.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {filter.filterType === 'CUSTOMER_TAG' && (
                          <div className="space-y-2">
                            <Label>Customer Tag</Label>
                            <Input
                              value={Array.isArray(selectedValues.tags) ? selectedValues.tags.join(', ') : ''}
                              onChange={(event) => updateAudienceFilter(filter.localId, {
                                valueJson: {
                                  ...selectedValues,
                                  tags: event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean),
                                },
                              })}
                              placeholder="vip, reseller, loyal"
                              className="border-slate-700 bg-slate-900"
                            />
                          </div>
                        )}

                        {filter.filterType === 'CUSTOMER_STATUS' && (
                          <div className="space-y-2">
                            <Label>Customer Status</Label>
                            <div className="flex flex-wrap gap-2">
                              {BROADCAST_CUSTOMER_STATUS_OPTIONS.map((option) => {
                                const checked = Array.isArray(selectedValues.statuses) && selectedValues.statuses.includes(option.value);
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => updateAudienceFilter(filter.localId, {
                                      valueJson: {
                                        ...selectedValues,
                                        statuses: toggleArrayValue(selectedValues.statuses, option.value),
                                      },
                                    })}
                                    className={cn(
                                      'rounded-full border px-3 py-2 text-xs transition',
                                      checked
                                        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white',
                                    )}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {filter.filterType === 'ASSIGNED_AGENT' && (
                          <div className="space-y-2">
                            <Label>Assigned Agent</Label>
                            <Select
                              value={Array.isArray(selectedValues.agentIds) ? selectedValues.agentIds[0] || '' : ''}
                              onValueChange={(value) => updateAudienceFilter(filter.localId, {
                                valueJson: {
                                  ...selectedValues,
                                  agentIds: value ? [value] : [],
                                },
                              })}
                            >
                              <SelectTrigger className="border-slate-700 bg-slate-900">
                                <SelectValue placeholder="Pilih agent CRM" />
                              </SelectTrigger>
                              <SelectContent>
                                {broadcastAgents.map((agent) => (
                                  <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {filter.filterType === 'CHANNEL_TYPE' && (
                          <div className="space-y-2">
                            <Label>Channel Type</Label>
                            <Select
                              value={Array.isArray(selectedValues.channelTypes) ? selectedValues.channelTypes[0] || '' : ''}
                              onValueChange={(value) => updateAudienceFilter(filter.localId, {
                                valueJson: {
                                  ...selectedValues,
                                  channelTypes: value ? [value] : [],
                                },
                              })}
                            >
                              <SelectTrigger className="border-slate-700 bg-slate-900">
                                <SelectValue placeholder="Pilih channel type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                                <SelectItem value="TELEGRAM">Telegram</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {filter.filterType === 'APPROVAL_STATUS' && (
                          <div className="space-y-2">
                            <Label>Approval Status</Label>
                            <div className="flex flex-wrap gap-2">
                              {BROADCAST_APPROVAL_STATUS_OPTIONS.map((option) => {
                                const checked = Array.isArray(selectedValues.statuses) && selectedValues.statuses.includes(option.value);
                                return (
                                  <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => updateAudienceFilter(filter.localId, {
                                      valueJson: {
                                        ...selectedValues,
                                        statuses: toggleArrayValue(selectedValues.statuses, option.value),
                                      },
                                    })}
                                    className={cn(
                                      'rounded-full border px-3 py-2 text-xs transition',
                                      checked
                                        ? 'border-amber-400/40 bg-amber-500/10 text-amber-100'
                                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:text-white',
                                    )}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {filter.filterType === 'LAST_ACTIVITY' && (
                          <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-2">
                              <Label>Operator</Label>
                              <Select value={filter.operator || 'WITHIN_LAST_DAYS'} onValueChange={(value) => updateAudienceFilter(filter.localId, { operator: value })}>
                                <SelectTrigger className="border-slate-700 bg-slate-900">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {BROADCAST_LAST_ACTIVITY_OPERATOR_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {(filter.operator || 'WITHIN_LAST_DAYS') === 'WITHIN_LAST_DAYS' && (
                              <div className="space-y-2">
                                <Label>Days</Label>
                                <Input
                                  type="number"
                                  min="1"
                                  value={selectedValues.days || ''}
                                  onChange={(event) => updateAudienceFilter(filter.localId, {
                                    valueJson: {
                                      ...selectedValues,
                                      days: Number(event.target.value || 0),
                                    },
                                  })}
                                  className="border-slate-700 bg-slate-900"
                                />
                              </div>
                            )}

                            {(filter.operator || 'WITHIN_LAST_DAYS') === 'BEFORE_DATE' && (
                              <div className="space-y-2">
                                <Label>Date</Label>
                                <Input
                                  type="date"
                                  value={selectedValues.date || ''}
                                  onChange={(event) => updateAudienceFilter(filter.localId, {
                                    valueJson: {
                                      ...selectedValues,
                                      date: event.target.value,
                                    },
                                  })}
                                  className="border-slate-700 bg-slate-900"
                                />
                              </div>
                            )}

                            {(filter.operator || 'WITHIN_LAST_DAYS') === 'AFTER_DATE' && (
                              <div className="space-y-2">
                                <Label>Date</Label>
                                <Input
                                  type="date"
                                  value={selectedValues.date || ''}
                                  onChange={(event) => updateAudienceFilter(filter.localId, {
                                    valueJson: {
                                      ...selectedValues,
                                      date: event.target.value,
                                    },
                                  })}
                                  className="border-slate-700 bg-slate-900"
                                />
                              </div>
                            )}

                            {(filter.operator || 'WITHIN_LAST_DAYS') === 'BETWEEN_DATES' && (
                              <>
                                <div className="space-y-2">
                                  <Label>Date From</Label>
                                  <Input
                                    type="date"
                                    value={selectedValues.dateFrom || ''}
                                    onChange={(event) => updateAudienceFilter(filter.localId, {
                                      valueJson: {
                                        ...selectedValues,
                                        dateFrom: event.target.value,
                                      },
                                    })}
                                    className="border-slate-700 bg-slate-900"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label>Date To</Label>
                                  <Input
                                    type="date"
                                    value={selectedValues.dateTo || ''}
                                    onChange={(event) => updateAudienceFilter(filter.localId, {
                                      valueJson: {
                                        ...selectedValues,
                                        dateTo: event.target.value,
                                      },
                                    })}
                                    className="border-slate-700 bg-slate-900"
                                  />
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {filter.filterType === 'SPECIFIC_CUSTOMER' && (
                          <div className="space-y-2">
                            <Label>Specific Customer</Label>
                            <div className="max-h-52 space-y-2 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                              {customers.slice(0, 80).map((customer) => {
                                const checked = Array.isArray(selectedValues.customerIds) && selectedValues.customerIds.includes(customer.id);
                                return (
                                  <label key={customer.id} className="flex items-center gap-3 rounded-xl border border-slate-800 px-3 py-2 text-sm text-slate-200">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => updateAudienceFilter(filter.localId, {
                                        valueJson: {
                                          ...selectedValues,
                                          customerIds: toggleArrayValue(selectedValues.customerIds, customer.id),
                                        },
                                      })}
                                      className="h-4 w-4 rounded border-slate-600 bg-slate-950"
                                    />
                                    <span className="flex-1">{customer.name || customer.phoneNumber}</span>
                                    <span className="text-xs text-slate-500">{customer.phoneNumber}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">Preview Panel</p>
                    <p className="mt-1 text-sm text-slate-400">Jalankan preview sebelum menyimpan campaign.</p>
                  </div>
                  <Button variant="outline" onClick={handlePreviewAudience} disabled={dialogState.previewing || !dialogState.form.assignedAgentId}>
                    {dialogState.previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                    Preview Audience
                  </Button>
                </div>

                <AudiencePreviewPanel preview={dialogState.preview} workspaceTier={workspaceTier} />
              </div>

              <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <CalendarClock className="h-4 w-4" />
                  Campaign Summary
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Status</p>
                    <p className="mt-2 text-lg font-semibold text-white">{dialogState.form.status}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Filter Count</p>
                    <p className="mt-2 text-lg font-semibold text-white">{dialogState.form.audienceFilters.length}</p>
                  </div>
                </div>

                <Alert className="border-slate-800 bg-slate-950/70 text-slate-100">
                  <AlertTitle>Broadcast Guardrail</AlertTitle>
                  <AlertDescription className="text-slate-400">
                    Hanya agent Approval Required yang bisa dipakai. Jika workspace Anda bukan Pro, advanced analytics akan tetap terkunci walaupun campaign berjalan normal.
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogState((current) => ({ ...current, open: false }))}>Close</Button>
            <Button onClick={handleSaveCampaign} disabled={dialogState.saving || dialogState.preview?.summary?.overAudienceLimit}>
              {dialogState.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Megaphone className="mr-2 h-4 w-4" />}
              {dialogState.mode === 'create' ? 'Create Campaign' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
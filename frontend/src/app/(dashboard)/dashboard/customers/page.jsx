'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, Search, Phone, MessageSquare, Loader2, Archive, Ban, RotateCcw, ShieldOff } from 'lucide-react';
import { CheckCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import api from '@/lib/api';
import { formatChannelContact } from '@/lib/channel';
import { useSocket } from '@/lib/socket';

const LIMIT = 20;

const FILTERS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'ACTIVE', label: 'Aktif' },
  { value: 'ARCHIVED', label: 'Arsip' },
  { value: 'BLOCKED', label: 'Diblokir' },
  { value: 'ALL', label: 'Semua' },
];

const ACTION_META = {
  ARCHIVE: {
    title: 'Arsipkan Customer',
    description: 'Customer akan disembunyikan dari daftar aktif dan follow-up pending akan dibatalkan.',
    button: 'Arsipkan',
    icon: Archive,
    variant: 'outline',
  },
  UNARCHIVE: {
    title: 'Aktifkan Kembali Customer',
    description: 'Customer akan kembali muncul di daftar aktif.',
    button: 'Aktifkan',
    icon: RotateCcw,
    variant: 'outline',
  },
  BLOCK: {
    title: 'Blokir Customer',
    description: 'Customer diblokir dari alur backend dan follow-up pending akan dibatalkan.',
    button: 'Blokir',
    icon: Ban,
    variant: 'destructive',
  },
  APPROVE: {
    title: 'Approve Customer',
    description: 'Customer akan dipindahkan dari pending ke aktif untuk agent yang dipilih.',
    button: 'Approve',
    icon: CheckCircle,
    variant: 'default',
  },
  UNBLOCK: {
    title: 'Buka Blokir Customer',
    description: 'Customer akan bisa diproses kembali seperti biasa.',
    button: 'Buka Blokir',
    icon: ShieldOff,
    variant: 'outline',
  },
};

function getApiMessage(err, fallback) {
  return err?.response?.data?.message || err?.response?.data?.error || fallback;
}

function getStatusBadge(status) {
  switch (status) {
    case 'ARCHIVED':
      return { label: 'Diarsipkan', variant: 'secondary' };
    case 'BLOCKED':
      return { label: 'Diblokir', variant: 'destructive' };
    case 'PENDING':
      return { label: 'Pending Approval', variant: 'warning' };
    case 'ACTIVE':
    default:
      return { label: 'Aktif', variant: 'success' };
  }
}

function getActions(customer) {
  if (customer.lifecycleStatus === 'ARCHIVED') {
    return ['UNARCHIVE', 'BLOCK'];
  }
  if (customer.lifecycleStatus === 'BLOCKED') {
    return ['UNBLOCK'];
  }
  return ['ARCHIVE', 'BLOCK'];
}

function getPendingAgentStatuses(customer) {
  if (customer?.lifecycleStatus !== 'PENDING') return [];

  return Array.isArray(customer?.agentStatuses)
    ? customer.agentStatuses.filter((entry) => entry.status === 'PENDING')
    : [];
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [error, setError] = useState('');
  const [actionTarget, setActionTarget] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchCustomers = useCallback(async (wsId, q, p, status) => {
    try {
      setError('');
      const { data } = await api.get('/customers', {
        params: { workspaceId: wsId, search: q || undefined, status, page: p, limit: LIMIT },
      });
      setCustomers(data.customers ?? data.data ?? []);
      setTotal(data.total ?? data.pagination?.total ?? 0);
    } catch (err) {
      setError(getApiMessage(err, 'Gagal memuat data customer'));
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const { data: me } = await api.get('/auth/me');
        const wsId = me.workspace?.id;
        setWorkspaceId(wsId);
        await fetchCustomers(wsId, '', 1, 'ACTIVE');
      } catch (err) {
        setError(getApiMessage(err, 'Gagal memuat data'));
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useSocket({
    'customer:approval_updated': () => {
      if (!workspaceId) return;
      fetchCustomers(workspaceId, search, page, statusFilter);
    },
    'chat:handoff_needed': (payload) => {
      if (!workspaceId || payload?.reason !== 'APPROVAL_PENDING') return;
      if (!['PENDING', 'ALL'].includes(statusFilter)) return;
      fetchCustomers(workspaceId, search, page, statusFilter);
    },
  });

  // Debounce search
  useEffect(() => {
    if (!workspaceId) return;
    const t = setTimeout(() => {
      setPage(1);
      fetchCustomers(workspaceId, search, 1, statusFilter);
    }, 400);
    return () => clearTimeout(t);
  }, [search, workspaceId, statusFilter, fetchCustomers]);

  const handlePage = (next) => {
    setPage(next);
    fetchCustomers(workspaceId, search, next, statusFilter);
  };

  const handleFilterChange = (next) => {
    setStatusFilter(next);
    setPage(1);
  };

  const handleLifecycle = async () => {
    if (!actionTarget || !workspaceId) return;

    setSubmitting(true);
    try {
      await api.patch(`/customers/${actionTarget.customer.id}/lifecycle`, {
        action: actionTarget.action,
        agentId: actionTarget.agentId,
      });
      setActionTarget(null);
      await fetchCustomers(workspaceId, search, 1, statusFilter);
      setPage(1);
    } catch (err) {
      setError(getApiMessage(err, 'Gagal memperbarui status customer'));
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const activeActionMeta = actionTarget ? ACTION_META[actionTarget.action] : null;
  const actionTargetLabel = actionTarget?.action === 'APPROVE'
    ? `${actionTarget?.customer?.name || actionTarget?.customer?.phoneNumber} untuk ${actionTarget?.agentName}`
    : (actionTarget?.customer?.name || actionTarget?.customer?.phoneNumber);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Customer</h1>
        <Badge variant="secondary">{total.toLocaleString('id-ID')} total</Badge>
      </div>

      <Alert>
        <AlertDescription>
          Archive menyembunyikan customer dari daftar aktif dan membatalkan follow-up pending. Block dipakai jika customer tidak boleh diproses backend lagi.
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          placeholder="Cari nama atau nomor HP..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-slate-900 border-slate-700"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => (
          <Button
            key={filter.value}
            type="button"
            size="sm"
            variant={statusFilter === filter.value ? 'default' : 'outline'}
            onClick={() => handleFilterChange(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {customers.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-slate-600 mb-4" />
            <p className="text-slate-400 font-medium">
              {search ? 'Tidak ada hasil pencarian' : 'Belum ada customer pada filter ini'}
            </p>
            <p className="text-slate-500 text-sm mt-1">
              {search ? 'Coba kata kunci lain' : 'Customer akan muncul setelah ada percakapan pertama'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {customers.map((c) => (
              <Card key={c.id} className="border-slate-800 bg-slate-900">
                <CardContent className="flex items-center justify-between py-3 px-4 gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-semibold text-white ${c.lifecycleStatus === 'BLOCKED' ? 'bg-red-500/20' : c.lifecycleStatus === 'ARCHIVED' ? 'bg-slate-600' : 'bg-slate-700'}`}>
                      {(c.name || '?')[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white text-sm">{c.name || 'Anonim'}</p>
                        <Badge variant={getStatusBadge(c.lifecycleStatus).variant}>{getStatusBadge(c.lifecycleStatus).label}</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        {c.phoneNumber && (
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            <Phone className="h-3 w-3" />{formatChannelContact(c.phoneNumber)}
                          </span>
                        )}
                        {c.lastSeen && (
                          <span className="text-xs text-slate-500">
                            Terakhir: {format(new Date(c.lastSeen), 'dd MMM yyyy')}
                          </span>
                        )}
                      </div>
                      {(c.accessSummary?.pendingCount > 0 || c.accessSummary?.activeCount > 0) && (
                        <p className="mt-1 text-xs text-slate-500">
                          {c.accessSummary?.pendingCount || 0} pending · {c.accessSummary?.activeCount || 0} active
                        </p>
                      )}
                      {Array.isArray(c.agentStatuses) && c.agentStatuses.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {c.agentStatuses.map((entry) => (
                            <Badge key={entry.id || `${c.id}-${entry.agentId}`} variant={entry.status === 'PENDING' ? 'warning' : 'outline'}>
                              {entry.agentName}: {entry.status === 'PENDING' ? 'Pending' : 'Active'}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {typeof c._count?.conversations === 'number' && (
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <MessageSquare className="h-3.5 w-3.5" />
                        {c._count.conversations}
                      </span>
                    )}
                    {getPendingAgentStatuses(c).map((entry) => (
                      <Button
                        key={`${c.id}-${entry.agentId}-approve`}
                        size="sm"
                        onClick={() => setActionTarget({ customer: c, action: 'APPROVE', agentId: entry.agentId, agentName: entry.agentName })}
                      >
                        <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                        Approve {entry.agentName}
                      </Button>
                    ))}
                    {getActions(c).map((action) => {
                      const meta = ACTION_META[action];
                      const Icon = meta.icon;
                      return (
                        <Button
                          key={action}
                          variant={meta.variant}
                          size="sm"
                          onClick={() => setActionTarget({ customer: c, action })}
                        >
                          <Icon className="mr-1.5 h-3.5 w-3.5" />
                          {meta.button}
                        </Button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" onClick={() => handlePage(page - 1)} disabled={page === 1}>
                Sebelumnya
              </Button>
              <span className="text-sm text-slate-400">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => handlePage(page + 1)} disabled={page === totalPages}>
                Berikutnya
              </Button>
            </div>
          )}
        </>
      )}

      <Dialog open={!!actionTarget} onOpenChange={(open) => !open && !submitting && setActionTarget(null)}>
        <DialogContent className="border-slate-800 bg-slate-900">
          <DialogHeader>
            <DialogTitle>{activeActionMeta?.title}</DialogTitle>
            <DialogDescription>
              {activeActionMeta?.description} Target: <strong>{actionTargetLabel}</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setActionTarget(null)} disabled={submitting}>
              Batal
            </Button>
            <Button variant={activeActionMeta?.variant || 'default'} onClick={handleLifecycle} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {activeActionMeta?.button}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

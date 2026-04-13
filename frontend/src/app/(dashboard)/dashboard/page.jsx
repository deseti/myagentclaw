'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, UserCheck, AlertTriangle, Gauge, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useSocket } from '@/lib/socket';
import { useDashboardStore } from '@/store/workspace.store';
import api from '@/lib/api';

function StatCard({ title, value, icon: Icon, variant = 'default', sub }) {
  const variantClass = {
    default: 'text-blue-400',
    danger: 'text-red-400',
    success: 'text-green-400',
    warning: 'text-yellow-400',
  };
  return (
    <Card className="border-slate-800 bg-slate-900">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-slate-400">{title}</CardTitle>
        <Icon className={`h-5 w-5 ${variantClass[variant]}`} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold text-white">{value}</div>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [toasts, setToasts] = useState([]);
  const { chatToday, activeLeads, needsAdmin, quotaUsed, quotaLimit, setStats, incrementChatToday, incrementNeedsAdmin } =
    useDashboardStore();

  const addToast = (message, variant = 'default') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  useSocket({
    'chat:new_message': () => {
      incrementChatToday();
      addToast('Pesan baru masuk');
    },
    'chat:handoff_needed': ({ customerName }) => {
      incrementNeedsAdmin();
      addToast(`${customerName || 'Customer'} perlu admin`, 'danger');
    },
    'quota:warning': () => addToast('Quota hampir habis (80%)', 'warning'),
    'quota:exhausted': () => addToast('Quota bulan ini habis!', 'danger'),
  });

  useEffect(() => {
    async function fetchStats() {
      try {
        const { data } = await api.get('/dashboard/stats');
        setFetchError('');
        setStats({
          chatToday: data.chatToday ?? 0,
          activeLeads: data.activeLeads ?? 0,
          needsAdmin: data.needsAdmin ?? 0,
          quotaUsed: data.quotaUsed ?? 0,
          quotaLimit: data.quotaLimit ?? 100,
        });
      } catch (error) {
        setFetchError(error?.response?.data?.message || error?.response?.data?.error || 'Gagal memuat statistik dashboard');
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;
  const quotaRemaining = Math.max(0, quotaLimit - quotaUsed);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400 text-sm mt-1">Overview performa agent AI Anda</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Chat Hari Ini" value={loading ? '…' : chatToday} icon={MessageSquare} />
        <StatCard title="Lead Aktif" value={loading ? '…' : activeLeads} icon={UserCheck} variant="success" />
        <StatCard
          title="Perlu Admin"
          value={loading ? '…' : needsAdmin}
          icon={AlertTriangle}
          variant={needsAdmin > 0 ? 'danger' : 'default'}
        />
        <Card className="border-slate-800 bg-slate-900">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Quota Tersisa</CardTitle>
            <Gauge className="h-5 w-5 text-blue-400" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-3xl font-bold text-white">{loading ? '…' : quotaRemaining.toLocaleString('id-ID')}</div>
            <Progress value={100 - quotaPct} className="h-2" />
            <p className="text-xs text-slate-500">
              {quotaUsed.toLocaleString('id-ID')} / {quotaLimit.toLocaleString('id-ID')} pesan
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quota alerts */}
      {fetchError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Statistik dashboard gagal dimuat</AlertTitle>
          <AlertDescription>{fetchError}</AlertDescription>
        </Alert>
      )}

      {quotaPct >= 90 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Quota hampir habis!</AlertTitle>
          <AlertDescription>
            Anda telah menggunakan {quotaPct}% quota bulan ini. Segera top-up atau upgrade paket.
          </AlertDescription>
        </Alert>
      )}
      {quotaPct >= 70 && quotaPct < 90 && (
        <Alert variant="warning">
          <AlertTitle>Peringatan Quota</AlertTitle>
          <AlertDescription>
            Anda telah menggunakan {quotaPct}% quota bulan ini.
          </AlertDescription>
        </Alert>
      )}

      {/* Toast stack */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all ${
              t.variant === 'danger'
                ? 'bg-red-600 text-white'
                : t.variant === 'warning'
                ? 'bg-yellow-500 text-black'
                : 'bg-slate-700 text-white'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

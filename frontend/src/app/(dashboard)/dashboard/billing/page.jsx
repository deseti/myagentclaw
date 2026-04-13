'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { CreditCard, Zap, ArrowUpCircle, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import api from '@/lib/api';

const TIER_PRICE = {
  FREE:    { label: 'Free',    price: 'Gratis',       quota: '100 pesan',    agents: 1, channels: 1, color: 'text-slate-300' },
  STARTER: { label: 'Starter', price: 'Rp129.000',    quota: '1.500 pesan',  agents: 2, channels: 2, color: 'text-blue-400'  },
  GROWTH:  { label: 'Growth',  price: 'Rp349.000',    quota: '5.000 pesan',  agents: 5, channels: 5, color: 'text-green-400' },
};

const TOPUP_OPTIONS = [
  { label: '500 pesan', price: 'Rp35.000', messages: 500 },
  { label: '1.000 pesan', price: 'Rp59.000', messages: 1000 },
  { label: '5.000 pesan', price: 'Rp249.000', messages: 5000 },
  { label: '10.000 pesan', price: 'Rp449.000', messages: 10000 },
];

const TIER_ORDER = ['FREE', 'STARTER', 'GROWTH'];

const STATUS_VARIANT = {
  ACTIVE: 'success',
  GRACE: 'warning',
  SUSPENDED: 'destructive',
  EXPIRED: 'destructive',
};

function formatRupiah(n) {
  return `Rp${Number(n).toLocaleString('id-ID')}`;
}

function transactionLabel(tx) {
  if (tx.type === 'SUBSCRIPTION') {
    return 'Upgrade paket';
  }
  if (tx.type === 'TOPUP') {
    return 'Top-up pesan';
  }
  return tx.type || 'Transaksi';
}

function BillingPageFallback() {
  return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  );
}

function BillingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [billing, setBilling] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [topupOpen, setTopupOpen] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [workspaceId, setWorkspaceId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot(wsId) {
      const [{ data: b }, { data: t }] = await Promise.all([
        api.get('/billing/subscription', { params: { workspaceId: wsId } }),
        api.get('/billing/transactions', { params: { workspaceId: wsId } }),
      ]);

      return {
        billing: {
          tier: b.subscription?.tier ?? 'FREE',
          status: b.subscription?.status ?? 'ACTIVE',
          quotaUsed: b.quota?.used ?? 0,
          quotaLimit: b.quota?.limit ?? 100,
          expireDate: b.subscription?.expireDate ?? null,
          availableTiers: b.availableTiers ?? [],
        },
        transactions: t.transactions ?? t.data ?? t ?? [],
      };
    }

    async function load() {
      try {
        const { data: me } = await api.get('/auth/me');
        const wsId = me.workspace?.id;
        if (!wsId) throw new Error('No workspace');

        if (cancelled) return;

        setWorkspaceId(wsId);

        const paymentStatus = searchParams.get('status');
        let nextNotice = '';
        let snapshot;

        if (paymentStatus === 'success') {
          const { data: syncData } = await api.post('/billing/reconcile', { workspaceId: wsId });
          nextNotice = syncData.message || 'Pembayaran sedang diverifikasi.';
          snapshot = await loadSnapshot(wsId);
          router.replace('/dashboard/billing', { scroll: false });
        } else {
          snapshot = await loadSnapshot(wsId);

          if (snapshot.transactions.some((tx) => tx.status === 'PENDING')) {
            const { data: syncData } = await api.post('/billing/reconcile', { workspaceId: wsId });
            if (syncData.updated > 0 || syncData.paid > 0) {
              nextNotice = syncData.message || nextNotice;
            }
            snapshot = await loadSnapshot(wsId);
          }
        }

        if (cancelled) return;

        setBilling(snapshot.billing);
        setTransactions(snapshot.transactions);
        setNotice(nextNotice);
        setError('');
      } catch (err) {
        if (!cancelled) {
          setNotice('');
          setError(err.response?.data?.message || 'Gagal memuat data billing');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  const handleUpgrade = async (tier) => {
    setUpgradeLoading(tier);
    setError('');
    try {
      const { data } = await api.post('/billing/upgrade', { tier, workspaceId });
      const redirectUrl = data.checkoutUrl || data.invoiceUrl;
      if (redirectUrl) {
        window.location.href = redirectUrl;
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal membuat checkout');
    } finally {
      setUpgradeLoading('');
    }
  };

  const handleTopup = async (option) => {
    setError('');
    try {
      const { data } = await api.post('/billing/topup', { messages: option.messages, workspaceId });
      const redirectUrl = data.checkoutUrl || data.invoiceUrl;
      if (redirectUrl) {
        window.location.href = redirectUrl;
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal membuat topup');
    }
  };

  if (loading) {
    return <BillingPageFallback />;
  }

  const currentTier = billing?.tier ?? 'FREE';
  const subStatus = billing?.status ?? 'ACTIVE';
  const quotaUsed = billing?.quotaUsed ?? 0;
  const quotaLimit = billing?.quotaLimit ?? 100;
  const quotaPct = quotaLimit > 0 ? Math.round((quotaUsed / quotaLimit) * 100) : 0;
  const expireDate = billing?.expireDate ? format(new Date(billing.expireDate), 'dd MMM yyyy') : '-';

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-white">Billing & Quota</h1>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {notice && (
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Status pembayaran</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {subStatus === 'GRACE' && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Masa tenggang aktif</AlertTitle>
          <AlertDescription>Paket Anda sudah expired. Segera perpanjang agar layanan tidak terganggu.</AlertDescription>
        </Alert>
      )}
      {subStatus === 'SUSPENDED' && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Akun disuspend</AlertTitle>
          <AlertDescription>Lakukan pembayaran untuk mengaktifkan kembali layanan Anda.</AlertDescription>
        </Alert>
      )}

      {/* Section 1: Paket Aktif */}
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-blue-400" />
              Paket Aktif
            </CardTitle>
            <CardDescription>Informasi paket berlangganan saat ini</CardDescription>
          </div>
          <Badge variant={STATUS_VARIANT[subStatus] ?? 'default'}>
            {subStatus === 'ACTIVE' ? 'Aktif' : subStatus === 'GRACE' ? 'Tenggang' : subStatus}
          </Badge>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-slate-500">Paket</p>
            <p className={`font-bold text-lg ${TIER_PRICE[currentTier]?.color}`}>
              {TIER_PRICE[currentTier]?.label}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Berlaku sampai</p>
            <p className="font-medium text-white">{expireDate}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Quota Paket</p>
            <p className="font-medium text-white">{TIER_PRICE[currentTier]?.quota}</p>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Quota Usage */}
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-400" />
            Penggunaan Quota
          </CardTitle>
          <CardDescription>Bulan ini</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-400">{quotaUsed.toLocaleString('id-ID')} pesan terpakai</span>
            <span className="text-white font-medium">{quotaLimit.toLocaleString('id-ID')} total</span>
          </div>
          <Progress value={quotaPct} className={`h-3 ${quotaPct >= 90 ? '[&>div]:bg-red-500' : quotaPct >= 70 ? '[&>div]:bg-yellow-500' : ''}`} />
          <p className="text-xs text-slate-500">{Math.max(0, quotaLimit - quotaUsed).toLocaleString('id-ID')} pesan tersisa</p>
          <Button variant="outline" size="sm" onClick={() => setTopupOpen(true)}>
            <Zap className="mr-2 h-4 w-4 text-yellow-400" />
            Top-up Pesan
          </Button>
        </CardContent>
      </Card>

      {/* Section 3: Upgrade Paket */}
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-purple-400" />
            Upgrade Paket
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {TIER_ORDER.map((tier) => {
              const info = TIER_PRICE[tier];
              const isActive = tier === currentTier;
              const isLower = TIER_ORDER.indexOf(tier) <= TIER_ORDER.indexOf(currentTier);
              return (
                <div
                  key={tier}
                  className={`rounded-lg border p-4 ${isActive ? 'border-primary bg-primary/10' : 'border-slate-700 bg-slate-800/40'}`}
                >
                  {isActive && (
                    <Badge variant="default" className="mb-2 text-xs">Paket Aktif</Badge>
                  )}
                  <p className={`font-bold text-lg ${info.color}`}>{info.label}</p>
                  <p className="text-xs text-slate-400 mb-1">{info.quota}/bulan</p>
                  <p className="text-xs text-slate-500 mb-1">{info.agents} agent • {info.channels} channel</p>
                  <p className="font-medium text-white mb-3">{info.price}<span className="text-xs text-slate-400">/bln</span></p>
                  <Button
                    size="sm"
                    className="w-full"
                    variant={isActive ? 'secondary' : 'default'}
                    disabled={isActive || isLower || upgradeLoading === tier}
                    onClick={() => handleUpgrade(tier)}
                  >
                    {upgradeLoading === tier ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isActive ? (
                      <><CheckCircle2 className="mr-1 h-4 w-4" /> Aktif</>
                    ) : isLower ? 'Tidak tersedia' : 'Upgrade'}
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Section 4: Riwayat Transaksi */}
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader>
          <CardTitle>Riwayat Transaksi</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-slate-500 py-4 text-center">Belum ada transaksi</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 text-left font-medium">Tanggal</th>
                    <th className="py-2 text-left font-medium">Deskripsi</th>
                    <th className="py-2 text-right font-medium">Jumlah</th>
                    <th className="py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="border-b border-slate-800/50">
                      <td className="py-2.5 text-slate-400 text-xs">
                        {format(new Date(tx.createdAt), 'dd MMM yyyy')}
                      </td>
                      <td className="py-2.5 text-white">
                        {tx.description || transactionLabel(tx)}
                      </td>
                      <td className="py-2.5 text-right text-white font-medium">
                        {formatRupiah(tx.amount)}
                      </td>
                      <td className="py-2.5 text-right">
                        <Badge
                          variant={
                            tx.status === 'PAID' ? 'success' :
                            tx.status === 'PENDING' ? 'warning' : 'destructive'
                          }
                          className="text-xs"
                        >
                          {tx.status === 'PAID' ? 'Lunas' : tx.status === 'PENDING' ? 'Menunggu' : tx.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top-up modal */}
      <Dialog open={topupOpen} onOpenChange={setTopupOpen}>
        <DialogContent className="border-slate-800 bg-slate-900">
          <DialogHeader>
            <DialogTitle>Top-up Pesan</DialogTitle>
            <DialogDescription>Pilih paket top-up yang sesuai kebutuhan Anda</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {TOPUP_OPTIONS.map((opt) => (
              <div key={opt.messages} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
                <div>
                  <p className="font-medium text-white">{opt.label}</p>
                  <p className="text-sm text-blue-400 font-semibold">{opt.price}</p>
                </div>
                <Button size="sm" onClick={() => { setTopupOpen(false); handleTopup(opt); }}>
                  Beli
                </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTopupOpen(false)}>Batal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<BillingPageFallback />}>
      <BillingPageContent />
    </Suspense>
  );
}

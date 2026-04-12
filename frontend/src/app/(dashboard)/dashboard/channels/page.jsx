'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  MessageSquare,
  Plus,
  Power,
  QrCode,
  RefreshCcw,
  SearchCheck,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import api from '@/lib/api';
import { formatChannelContact, getChannelLabel } from '@/lib/channel';
import { useSocket } from '@/lib/socket';

function getErrorMessage(err, fallback) {
  return err?.response?.data?.message || err?.response?.data?.error || fallback;
}

function formatElapsedDuration(value) {
  const elapsedMs = Number(value || 0);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return '-';
  }

  if (elapsedMs < 1000) {
    return `${elapsedMs} ms`;
  }

  const totalSeconds = Math.round(elapsedMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds} dtk`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} m ${seconds} dtk`;
}

function syncLinkDialogState(channel, payload = {}, current = null) {
  const payloadChannel = payload.channel || {};
  const nextRuntimeStatus = channel?.runtimeStatus || payload.runtimeStatus || payloadChannel.runtimeStatus || current?.runtimeStatus || current?.state || 'CONNECTING';
  const nextLinkState = channel?.linkState || payload.linkState || payloadChannel.linkState || current?.linkState || '';
  const nextForceQrTriggered = payload.forceQrTriggered === true
    || payloadChannel.forceQrTriggered === true
    || channel?.forceQrTriggered === true
    || current?.forceQrTriggered === true;
  const forceQrMessage = 'Restore session terlalu lama, sistem membuat QR baru...';
  const nextState = nextRuntimeStatus || nextLinkState || current?.state || 'CONNECTING';
  const shouldClearQr = ['QR_EXPIRED', 'REQUIRES_QR', 'ERROR', 'DISCONNECTED', 'LOGIN_FAILED'].includes(nextState);
  const nextQrDataUrl = payload.qrDataUrl !== undefined
    ? payload.qrDataUrl || ''
    : payloadChannel.qrDataUrl !== undefined
    ? payloadChannel.qrDataUrl || ''
    : channel?.qrDataUrl !== undefined
    ? channel.qrDataUrl || ''
    : shouldClearQr
    ? ''
    : current?.qrDataUrl || '';
  const nextMessage = payload.message
    || payloadChannel.statusMessage
    || channel?.statusMessage
    || ((nextLinkState === 'FORCE_NEW_QR' || nextForceQrTriggered) ? forceQrMessage : null)
    || current?.message
    || 'Scan QR WhatsApp untuk menyelesaikan koneksi.';

  return {
    open: true,
    channelId: channel?.id || payload.channel?.id || current?.channelId || '',
    qrDataUrl: nextQrDataUrl,
    message: nextMessage,
    waiting: false,
    refreshing: false,
    checking: false,
    agentName: channel?.agentName || current?.agentName || '',
    state: nextState,
    runtimeStatus: nextRuntimeStatus,
    linkState: nextLinkState,
    code: payload.code || channel?.lastErrorCode || current?.code || '',
    qrExpiresAt: payload.qrExpiresAt || payloadChannel.qrExpiresAt || channel?.qrExpiresAt || current?.qrExpiresAt || '',
    pairingCode: payload.pairingCode || payloadChannel.pairingCode || channel?.pairingCode || current?.pairingCode || '',
    pairingPhoneNumber: payload.pairingPhoneNumber || payloadChannel.pairingPhoneNumber || channel?.pairingPhoneNumber || current?.pairingPhoneNumber || '',
    pairingInstructions: payload.pairingInstructions
      || payloadChannel.pairingInstructions
      || channel?.pairingInstructions
      || current?.pairingInstructions
      || 'Jika QR sulit discan, gunakan pairing code.',
    lastError: payload.lastError || payloadChannel.lastError || channel?.lastError || current?.lastError || '',
    adapterError: payload.adapterError || payloadChannel.adapterError || channel?.adapterError || current?.adapterError || '',
    rawRuntimePayload: payload.rawRuntimePayload
      || payloadChannel.rawRuntimePayload
      || channel?.rawRuntimePayload
      || current?.rawRuntimePayload
      || null,
    reconnectStartedAt: payload.reconnectStartedAt
      || payloadChannel.reconnectStartedAt
      || channel?.reconnectStartedAt
      || current?.reconnectStartedAt
      || '',
    reconnectElapsedMs: payload.reconnectElapsedMs
      ?? payloadChannel.reconnectElapsedMs
      ?? channel?.reconnectElapsedMs
      ?? current?.reconnectElapsedMs
      ?? 0,
    restoreAttemptCount: payload.restoreAttemptCount
      ?? payloadChannel.restoreAttemptCount
      ?? channel?.restoreAttemptCount
      ?? current?.restoreAttemptCount
      ?? 0,
    lastRestoreError: payload.lastRestoreError
      || payloadChannel.lastRestoreError
      || channel?.lastRestoreError
      || current?.lastRestoreError
      || '',
    forceQrTriggered: nextForceQrTriggered,
    qrGenerationStartedAt: payload.qrGenerationStartedAt
      || payloadChannel.qrGenerationStartedAt
      || channel?.qrGenerationStartedAt
      || current?.qrGenerationStartedAt
      || '',
    qrScannedAt: payload.qrScannedAt
      || payloadChannel.qrScannedAt
      || channel?.qrScannedAt
      || current?.qrScannedAt
      || '',
    browserConnectedAt: payload.browserConnectedAt
      || payloadChannel.browserConnectedAt
      || channel?.browserConnectedAt
      || current?.browserConnectedAt
      || '',
    socketConnectedAt: payload.socketConnectedAt
      || payloadChannel.socketConnectedAt
      || channel?.socketConnectedAt
      || current?.socketConnectedAt
      || '',
    authStateLoadedAt: payload.authStateLoadedAt
      || payloadChannel.authStateLoadedAt
      || channel?.authStateLoadedAt
      || current?.authStateLoadedAt
      || '',
    sessionPersistedAt: payload.sessionPersistedAt
      || payloadChannel.sessionPersistedAt
      || channel?.sessionPersistedAt
      || current?.sessionPersistedAt
      || '',
    lastDisconnectReason: payload.lastDisconnectReason
      || payloadChannel.lastDisconnectReason
      || channel?.lastDisconnectReason
      || current?.lastDisconnectReason
      || '',
    loginFailureReason: payload.loginFailureReason
      || payloadChannel.loginFailureReason
      || channel?.loginFailureReason
      || current?.loginFailureReason
      || '',
    browserClosedUnexpectedly: payload.browserClosedUnexpectedly === true
      || payloadChannel.browserClosedUnexpectedly === true
      || channel?.browserClosedUnexpectedly === true
      || current?.browserClosedUnexpectedly === true,
    whatsappSocketState: payload.whatsappSocketState
      || payloadChannel.whatsappSocketState
      || channel?.whatsappSocketState
      || current?.whatsappSocketState
      || '',
    puppeteerBrowserState: payload.puppeteerBrowserState
      || payloadChannel.puppeteerBrowserState
      || channel?.puppeteerBrowserState
      || current?.puppeteerBrowserState
      || '',
    lastSocketError: payload.lastSocketError
      || payloadChannel.lastSocketError
      || channel?.lastSocketError
      || current?.lastSocketError
      || '',
    lastConnectionUpdate: payload.lastConnectionUpdate
      || payloadChannel.lastConnectionUpdate
      || channel?.lastConnectionUpdate
      || current?.lastConnectionUpdate
      || null,
  };
}

function formatQrExpiry(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export default function ChannelsPage() {
  const [agents, setAgents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [form, setForm] = useState({ agentId: '', type: 'TELEGRAM', botToken: '' });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [reconnectingId, setReconnectingId] = useState('');
  const [linkDialog, setLinkDialog] = useState({
    open: false,
    channelId: '',
    qrDataUrl: '',
    message: '',
    waiting: false,
    refreshing: false,
    checking: false,
    agentName: '',
    state: 'CONNECTING',
    runtimeStatus: 'CONNECTING',
    linkState: '',
    code: '',
    qrExpiresAt: '',
    pairingCode: '',
    pairingPhoneNumber: '',
    pairingInstructions: 'Jika QR sulit discan, gunakan pairing code.',
    lastError: '',
    adapterError: '',
    rawRuntimePayload: null,
    reconnectStartedAt: '',
    reconnectElapsedMs: 0,
    restoreAttemptCount: 0,
    lastRestoreError: '',
    forceQrTriggered: false,
    qrGenerationStartedAt: '',
    qrScannedAt: '',
    browserConnectedAt: '',
    socketConnectedAt: '',
    authStateLoadedAt: '',
    sessionPersistedAt: '',
    lastDisconnectReason: '',
    loginFailureReason: '',
    browserClosedUnexpectedly: false,
    whatsappSocketState: '',
    puppeteerBrowserState: '',
    lastSocketError: '',
    lastConnectionUpdate: null,
  });

  function openLinkDialog(channel, payload = {}) {
    setLinkDialog((current) => syncLinkDialogState(channel, payload, current));
  }

  function closeLinkDialog() {
    setLinkDialog({
      open: false,
      channelId: '',
      qrDataUrl: '',
      message: '',
      waiting: false,
      refreshing: false,
      checking: false,
      agentName: '',
      state: 'CONNECTING',
      runtimeStatus: 'CONNECTING',
      linkState: '',
      code: '',
      qrExpiresAt: '',
      pairingCode: '',
      pairingPhoneNumber: '',
      pairingInstructions: 'Jika QR sulit discan, gunakan pairing code.',
      lastError: '',
      adapterError: '',
      rawRuntimePayload: null,
      reconnectStartedAt: '',
      reconnectElapsedMs: 0,
      restoreAttemptCount: 0,
      lastRestoreError: '',
      forceQrTriggered: false,
      qrGenerationStartedAt: '',
      qrScannedAt: '',
      browserConnectedAt: '',
      socketConnectedAt: '',
      authStateLoadedAt: '',
      sessionPersistedAt: '',
      lastDisconnectReason: '',
      loginFailureReason: '',
      browserClosedUnexpectedly: false,
      whatsappSocketState: '',
      puppeteerBrowserState: '',
      lastSocketError: '',
      lastConnectionUpdate: null,
    });
  }

  function getChannelSubtitle(channel) {
    if (channel.type === 'WHATSAPP') {
      return `${getChannelLabel(channel.type)} · ${channel.linkedPhone ? formatChannelContact(channel.linkedPhone) : channel.linkedName || 'Menunggu QR login'}`;
    }

    return `${getChannelLabel(channel.type)} · ${channel.botUsername ? `@${channel.botUsername}` : 'Bot terhubung'}`;
  }

  async function load(options = {}) {
    const { silent = false } = options;

    try {
      if (!silent) {
        setLoading(true);
      }

      setError('');
      const { data: me } = await api.get('/auth/me');
      const nextWorkspaceId = me.workspace?.id || '';
      setWorkspaceId(nextWorkspaceId);

      const { data: agentData } = await api.get('/agents', { params: { workspaceId: nextWorkspaceId } });
      const agentList = agentData.agents ?? agentData.data ?? agentData ?? [];
      setAgents(agentList);

      const channelLists = await Promise.all(
        agentList.map((agent) =>
          api.get('/channels', { params: { agentId: agent.id } })
            .then((response) => (response.data.channels ?? response.data ?? []).map((channel) => ({ ...channel, agentName: agent.name })))
            .catch(() => [])
        )
      );

      setChannels(channelLists.flat());
    } catch (err) {
      setError(getErrorMessage(err, 'Gagal memuat data channel'));
    } finally {
      setLoading(false);
    }
  }

  async function refreshWhatsappStatus(channelId, options = {}) {
    const { silent = false } = options;
    if (!channelId) return;

    if (!silent) {
      setLinkDialog((current) => ({ ...current, checking: true }));
    }

    try {
      const { data } = await api.get(`/channels/${channelId}/link/status`);
      const latestChannel = data.channel ? { ...data.channel, agentName: linkDialog.agentName } : null;

      if (data.connected) {
        setNotice(data.message || 'WhatsApp berhasil terhubung.');
        closeLinkDialog();
        await load({ silent: true });
        return;
      }

      if (latestChannel) {
        setLinkDialog((current) => syncLinkDialogState(latestChannel, data, current));
      }

      if (data.message) {
        setNotice(data.message);
      }

      await load({ silent: true });
    } catch (err) {
      const message = getErrorMessage(err, 'Gagal memeriksa status login WhatsApp');
      const payload = err?.response?.data;
      const payloadChannel = payload?.channel;
      setLinkDialog((current) => {
        if (payloadChannel) {
          return syncLinkDialogState({ ...payloadChannel, agentName: current.agentName }, payload, current);
        }
        return { ...current, checking: false, message };
      });
      setError(message);
    } finally {
      if (!silent) {
        setLinkDialog((current) => ({ ...current, checking: false }));
      }
    }
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useSocket({
    'channel.updated': async (payload = {}) => {
      if (payload?.workspaceId && workspaceId && payload.workspaceId !== workspaceId) {
        return;
      }

      if (payload?.channel?.id && linkDialog.channelId === payload.channel.id) {
        if (payload.channel.runtimeStatus === 'CONNECTED') {
          setNotice(payload.channel.statusMessage || 'WhatsApp berhasil terhubung.');
          closeLinkDialog();
        } else {
          setLinkDialog((current) => syncLinkDialogState({ ...payload.channel, agentName: current.agentName }, payload, current));
        }
      }

      await load({ silent: true });
    },
  });

  useEffect(() => {
    if (!linkDialog.open || !linkDialog.channelId) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      refreshWhatsappStatus(linkDialog.channelId, { silent: true }).catch(() => {});
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [linkDialog.open, linkDialog.channelId]);

  useEffect(() => {
    const shouldPoll = channels.some((channel) => channel.type === 'WHATSAPP' && (
      ['CONNECTING', 'RECONNECTING', 'WAITING_QR', 'QR_SCANNED', 'AUTH_LOADING', 'SESSION_SAVING', 'WAITING_SOCKET_CONNECT', 'QR_EXPIRED', 'REQUIRES_QR', 'LOGIN_FAILED'].includes(channel.runtimeStatus)
      || channel.linkState === 'FORCE_NEW_QR'
    ));
    if (!shouldPoll) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      load({ silent: true }).catch(() => {});
    }, 7000);

    return () => window.clearInterval(intervalId);
  }, [channels]);

  const copyPairingCode = async () => {
    if (!linkDialog.pairingCode) return;

    try {
      await navigator.clipboard.writeText(linkDialog.pairingCode);
      setNotice('Pairing code berhasil disalin.');
    } catch {
      setError('Gagal menyalin pairing code. Salin manual dari modal QR.');
    }
  };

  const handleAdd = async () => {
    if (!form.agentId) {
      setAddError('Pilih agent terlebih dahulu');
      return;
    }

    if (form.type === 'TELEGRAM' && !form.botToken) {
      setAddError('Masukkan Bot Token Telegram');
      return;
    }

    setAddLoading(true);
    setAddError('');
    setError('');
    setNotice('');

    try {
      const payload = form.type === 'TELEGRAM'
        ? { agentId: form.agentId, type: 'TELEGRAM', botToken: form.botToken }
        : { agentId: form.agentId, type: 'WHATSAPP' };

      const { data } = await api.post('/channels', payload);
      const agent = agents.find((item) => item.id === form.agentId);

      setAddOpen(false);
      setForm({ agentId: '', type: 'TELEGRAM', botToken: '' });
      setNotice(data.message || 'Channel berhasil dihubungkan.');

      if (data?.channel?.type === 'WHATSAPP' && data.channel.runtimeStatus !== 'CONNECTED') {
        openLinkDialog({ ...data.channel, agentName: agent?.name || '' }, data);
      }

      await load({ silent: true });
    } catch (err) {
      const message = getErrorMessage(err, 'Gagal menghubungkan channel');
      const payload = err?.response?.data;
      const payloadChannel = payload?.channel;
      const agentName = agents.find((item) => item.id === form.agentId)?.name || '';

      if (form.type === 'WHATSAPP' && payloadChannel) {
        openLinkDialog({ ...payloadChannel, agentName }, payload);
      }

      setAddError(message);
    } finally {
      setAddLoading(false);
    }
  };

  const handleReconnect = async (channel) => {
    setReconnectingId(channel.id);
    setError('');
    setNotice('');

    try {
      const { data } = await api.post(`/channels/${channel.id}/reconnect`);
      setNotice(data.message || 'Channel sedang diaktifkan kembali.');

      if (channel.type === 'WHATSAPP' && data?.channel?.runtimeStatus !== 'CONNECTED') {
        openLinkDialog({ ...channel, ...data.channel }, data);
      }

      await load({ silent: true });
    } catch (err) {
      const message = getErrorMessage(err, 'Gagal mengaktifkan kembali channel');
      setError(message);

      const payloadChannel = err?.response?.data?.channel;
      if (channel.type === 'WHATSAPP' && payloadChannel) {
        openLinkDialog({ ...channel, ...payloadChannel }, err.response.data);
      }
    } finally {
      setReconnectingId('');
    }
  };

  const handleRefreshWhatsappQr = async () => {
    if (!linkDialog.channelId) return;

    setLinkDialog((current) => ({ ...current, refreshing: true }));
    setError('');

    try {
      const { data } = await api.post(`/channels/${linkDialog.channelId}/link/start`, { force: true });
      if (data.channel) {
        setLinkDialog((current) => syncLinkDialogState({ ...data.channel, agentName: current.agentName }, data, current));
      } else {
        setLinkDialog((current) => ({ ...current, refreshing: false, qrDataUrl: data.qrDataUrl || '', message: data.message || current.message }));
      }

      setNotice(data.message || 'QR WhatsApp baru berhasil dibuat.');
      await load({ silent: true });
    } catch (err) {
      const message = getErrorMessage(err, 'Gagal membuat QR WhatsApp baru');
      const payload = err?.response?.data;
      const payloadChannel = payload?.channel;
      setLinkDialog((current) => {
        if (payloadChannel) {
          return syncLinkDialogState({ ...payloadChannel, agentName: current.agentName }, payload, current);
        }
        return { ...current, refreshing: false, message };
      });
      setError(message);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    setError('');
    setNotice('');

    try {
      const { data } = await api.delete(`/channels/${deleteTarget.id}`);
      setDeleteTarget(null);
      setNotice(data.message || 'Channel berhasil diputuskan.');
      await load({ silent: true });
    } catch (err) {
      setError(getErrorMessage(err, 'Gagal memutuskan channel'));
    } finally {
      setDeleting(false);
    }
  };

  const statusColor = {
    CONNECTED: 'success',
    PAUSED: 'warning',
    RECONNECTING: 'warning',
    CONNECTING: 'warning',
    WAITING_QR: 'warning',
    QR_SCANNED: 'warning',
    AUTH_LOADING: 'warning',
    SESSION_SAVING: 'warning',
    WAITING_SOCKET_CONNECT: 'warning',
    QR_EXPIRED: 'destructive',
    REQUIRES_QR: 'destructive',
    LOGIN_FAILED: 'destructive',
    DISCONNECTED: 'secondary',
    ERROR: 'destructive',
  };

  const statusLabel = {
    CONNECTED: 'Aktif',
    PAUSED: 'Pause',
    RECONNECTING: 'Reconnect',
    CONNECTING: 'Menghubungkan',
    WAITING_QR: 'QR Siap',
    QR_SCANNED: 'QR Dipindai',
    AUTH_LOADING: 'Load Auth',
    SESSION_SAVING: 'Simpan Sesi',
    WAITING_SOCKET_CONNECT: 'Sinkronisasi',
    QR_EXPIRED: 'QR Kedaluwarsa',
    REQUIRES_QR: 'Perlu QR Ulang',
    LOGIN_FAILED: 'Login Gagal',
    DISCONNECTED: 'Tidak Aktif',
    ERROR: 'Error',
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Channel</h1>
          <p className="mt-1 text-sm text-slate-400">Kelola Telegram bot dan reactivation WhatsApp tanpa membuat channel baru.</p>
        </div>
        <Button onClick={() => { setAddOpen(true); setAddError(''); setForm({ agentId: '', type: 'TELEGRAM', botToken: '' }); }}>
          <Plus className="mr-2 h-4 w-4" />
          Hubungkan Channel
        </Button>
      </div>

      <Alert>
        <AlertDescription>
          Saat WhatsApp diaktifkan lagi, sistem akan mencoba memakai session lama lebih dulu. Jika session lama tidak valid, UI akan otomatis mengarahkan ke QR login baru tanpa membuat channel duplikat atau menghapus histori lama.
        </AlertDescription>
      </Alert>

      {notice && (
        <Alert className="border-emerald-500/20 bg-emerald-500/10 text-emerald-50">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {channels.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare className="mb-4 h-12 w-12 text-slate-600" />
            <p className="font-medium text-slate-400">Belum ada channel terhubung</p>
            <p className="mt-1 text-sm text-slate-500">Hubungkan Telegram atau WhatsApp ke agent Anda</p>
            <Button className="mt-4" onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Hubungkan Channel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {channels.map((channel) => {
            const needsQrAttention = channel.type === 'WHATSAPP' && (
              ['CONNECTING', 'RECONNECTING', 'WAITING_QR', 'QR_SCANNED', 'AUTH_LOADING', 'SESSION_SAVING', 'WAITING_SOCKET_CONNECT', 'QR_EXPIRED', 'REQUIRES_QR', 'LOGIN_FAILED'].includes(channel.runtimeStatus)
              || channel.linkState === 'FORCE_NEW_QR'
            );
            const canReconnect = ['DISCONNECTED', 'ERROR'].includes(channel.runtimeStatus);

            return (
              <Card key={channel.id} className="border-slate-800 bg-slate-900">
                <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    {channel.runtimeStatus === 'CONNECTED'
                      ? <Wifi className="mt-0.5 h-5 w-5 text-green-400" />
                      : <WifiOff className="mt-0.5 h-5 w-5 text-slate-500" />}
                    <div>
                      <p className="font-medium text-white">{channel.agentName}</p>
                      <p className="text-xs text-slate-400">
                        {getChannelSubtitle(channel)}
                        {channel.runtimeStatus === 'PAUSED' ? ' · agent nonaktif' : ''}
                      </p>
                      {(channel.statusMessage || channel.lastError) && (
                        <p className={`mt-1 text-xs ${['ERROR', 'QR_EXPIRED', 'REQUIRES_QR', 'LOGIN_FAILED'].includes(channel.runtimeStatus) ? 'text-red-300' : 'text-slate-500'}`}>
                          {channel.statusMessage || channel.lastError}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={statusColor[channel.runtimeStatus] ?? 'secondary'}>
                      {statusLabel[channel.runtimeStatus] ?? 'Tidak Diketahui'}
                    </Badge>

                    {canReconnect ? (
                      <Button size="sm" variant="outline" onClick={() => handleReconnect(channel)} disabled={reconnectingId === channel.id}>
                        {reconnectingId === channel.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Power className="mr-2 h-4 w-4" />}
                        Aktifkan Lagi
                      </Button>
                    ) : needsQrAttention ? (
                      <Button size="sm" variant="outline" onClick={() => openLinkDialog(channel, { message: channel.statusMessage || 'Lanjutkan proses login WhatsApp.' })}>
                        <QrCode className="mr-2 h-4 w-4" />
                        {['QR_EXPIRED', 'REQUIRES_QR'].includes(channel.runtimeStatus) ? 'Lanjutkan QR' : 'Lihat Status'}
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(channel)}>
                        <Trash2 className="h-4 w-4 text-slate-400 hover:text-red-400" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hubungkan Channel</DialogTitle>
            <DialogDescription>Pilih agent dan tentukan channel yang akan dipakai. Setiap agent hanya boleh punya satu channel aktif pada satu waktu.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {addError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{addError}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>Agent</Label>
              <Select value={form.agentId} onValueChange={(value) => setForm((current) => ({ ...current, agentId: value }))}>
                <SelectTrigger className="border-slate-700 bg-slate-800">
                  <SelectValue placeholder="Pilih agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Jenis Channel</Label>
              <Select value={form.type} onValueChange={(value) => setForm((current) => ({ ...current, type: value, botToken: value === 'TELEGRAM' ? current.botToken : '' }))}>
                <SelectTrigger className="border-slate-700 bg-slate-800">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TELEGRAM">Telegram Bot</SelectItem>
                  <SelectItem value="WHATSAPP">WhatsApp QR Login</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.type === 'TELEGRAM' ? (
              <>
                <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-sm text-slate-300">
                  <p className="font-medium text-white">Cara ambil Bot Token</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-400">
                    <li>Buka <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-slate-200 underline underline-offset-4">t.me/BotFather</a>.</li>
                    <li>Kirim perintah <span className="font-mono text-slate-200">/newbot</span>.</li>
                    <li>Ikuti instruksi sampai BotFather mengirim token.</li>
                    <li>Salin token lalu paste ke kolom Bot Token di bawah.</li>
                  </ol>
                </div>
                <div className="space-y-2">
                  <Label>Bot Token</Label>
                  <Input
                    placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
                    value={form.botToken}
                    onChange={(event) => setForm((current) => ({ ...current, botToken: event.target.value }))}
                    className="border-slate-700 bg-slate-800 font-mono text-sm"
                  />
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-sm text-slate-300">
                <p className="font-medium text-white">Cara hubungkan WhatsApp</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-slate-400">
                  <li>Pilih agent yang akan memakai channel WhatsApp.</li>
                  <li>Sistem akan mencoba session lama terlebih dahulu jika pernah ada.</li>
                  <li>Jika session lama tidak valid, dialog QR akan muncul untuk login ulang.</li>
                </ol>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Batal</Button>
            <Button onClick={handleAdd} disabled={addLoading}>
              {addLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Hubungkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Putuskan Channel?</DialogTitle>
            <DialogDescription>
              Channel {deleteTarget ? getChannelLabel(deleteTarget.type).toLowerCase() : ''} pada agent <strong>{deleteTarget?.agentName}</strong> akan diputuskan tanpa menghapus histori channel dan conversation lama. Anda bisa mengaktifkannya lagi nanti.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Batal</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Putuskan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkDialog.open} onOpenChange={(open) => { if (!open) closeLinkDialog(); }}>
        <DialogContent className="border-slate-800 bg-slate-950 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-semibold text-white">Scan QR WhatsApp</DialogTitle>
            <DialogDescription>
              {linkDialog.agentName
                ? `Buka WhatsApp di HP Anda, masuk ke Linked Devices, lalu scan QR untuk agent ${linkDialog.agentName}.`
                : 'Buka WhatsApp di HP Anda, masuk ke Linked Devices, lalu scan QR di bawah.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <Alert className={['QR_EXPIRED', 'REQUIRES_QR', 'ERROR', 'LOGIN_FAILED'].includes(linkDialog.state) ? 'border-red-500/20 bg-red-500/10 text-red-50' : ''}>
              <AlertDescription>{linkDialog.message || 'Buka WhatsApp → Linked Devices → Link a device, lalu scan QR di bawah.'}</AlertDescription>
            </Alert>

            <div className="rounded-[28px] border border-slate-800 bg-slate-900/80 p-4 shadow-2xl sm:p-5 lg:p-6">
              <div className="mx-auto flex w-full max-w-[480px] flex-col items-center gap-4 text-center">
                <div className="flex w-full items-center justify-between gap-3 text-left">
                  <div>
                    <p className="text-sm font-semibold text-white">QR Login WhatsApp</p>
                    <p className="mt-1 text-xs text-slate-400">QR diperbarui otomatis tanpa perlu refresh halaman.</p>
                  </div>
                  <Badge variant={statusColor[linkDialog.state] ?? 'secondary'}>
                    {statusLabel[linkDialog.state] ?? linkDialog.state}
                  </Badge>
                </div>

                {linkDialog.qrDataUrl ? (
                  <div className="w-full max-w-[360px] rounded-[28px] border border-slate-200 bg-white p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:max-w-[400px] sm:p-5 lg:max-w-[420px] lg:p-6 xl:max-w-[480px]">
                    <div className="aspect-square w-full overflow-hidden rounded-2xl bg-white">
                      <img
                        src={linkDialog.qrDataUrl}
                        alt="WhatsApp QR"
                        className="h-full w-full object-contain"
                        style={{
                          imageRendering: 'pixelated',
                          filter: 'none',
                          opacity: 1,
                          transform: 'translateZ(0)',
                        }}
                        draggable={false}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="w-full max-w-[420px] rounded-[28px] border border-dashed border-slate-700 bg-slate-950/80 px-6 py-10 text-center text-sm text-slate-400">
                    {linkDialog.linkState === 'FORCE_NEW_QR' || linkDialog.forceQrTriggered
                      ? 'Restore session terlalu lama, sistem membuat QR baru...'
                      : linkDialog.state === 'LOGIN_FAILED'
                      ? 'Login gagal di fase handshake. Lihat detail debug di bawah atau buat QR baru.'
                      : ['QR_EXPIRED', 'REQUIRES_QR'].includes(linkDialog.state)
                      ? 'QR lama tidak bisa dipakai lagi. Buat QR baru untuk melanjutkan login.'
                      : 'QR belum tersedia. Sistem masih mencoba session lama atau sedang menyiapkan QR resolusi penuh.'}
                  </div>
                )}

                <div className="w-full rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-left">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">Status realtime</p>
                    {linkDialog.checking && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{linkDialog.message || 'Menunggu QR WhatsApp siap dipindai.'}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                    <span>Diperbarui otomatis tiap beberapa detik</span>
                    {linkDialog.qrExpiresAt && <span>QR aktif sampai {formatQrExpiry(linkDialog.qrExpiresAt)}</span>}
                    {linkDialog.code && <span>Code: {linkDialog.code}</span>}
                        {linkDialog.qrScannedAt && <span>QR dipindai {formatQrExpiry(linkDialog.qrScannedAt)}</span>}
                        {linkDialog.sessionPersistedAt && <span>Sesi tersimpan {formatQrExpiry(linkDialog.sessionPersistedAt)}</span>}
                    {linkDialog.forceQrTriggered && <span>Fallback QR baru sedang aktif</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
              <p className="text-sm font-semibold text-white">Jika QR sulit discan, gunakan pairing code</p>
              <p className="mt-1 text-xs text-slate-400">{linkDialog.pairingInstructions || 'Jika QR sulit discan, gunakan pairing code.'}</p>
              {linkDialog.pairingPhoneNumber && (
                <p className="mt-3 text-sm text-slate-300">
                  Nomor pairing: <span className="font-mono text-slate-100">{linkDialog.pairingPhoneNumber}</span>
                </p>
              )}
              {linkDialog.pairingCode ? (
                <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pairing Code</p>
                  <p className="mt-2 break-all font-mono text-lg text-white">{linkDialog.pairingCode}</p>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">Pairing code belum tersedia untuk sesi login ini. Anda tetap bisa menekan Refresh QR tanpa menutup modal.</p>
              )}
            </div>

            {!linkDialog.qrDataUrl && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-left">
                <p className="text-sm font-semibold text-amber-50">Debug runtime QR</p>
                <div className="mt-3 grid gap-2 text-xs text-amber-100 sm:grid-cols-2">
                  <div>
                    <p className="text-amber-200/70">runtimeStatus</p>
                    <p className="mt-1 font-mono">{linkDialog.runtimeStatus || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">linkState</p>
                    <p className="mt-1 font-mono">{linkDialog.linkState || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">lastError</p>
                    <p className="mt-1 break-words font-mono">{linkDialog.lastError || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">adapterError</p>
                    <p className="mt-1 break-words font-mono">{linkDialog.adapterError || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">reconnectElapsedMs</p>
                    <p className="mt-1 font-mono">{formatElapsedDuration(linkDialog.reconnectElapsedMs)}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">restoreAttemptCount</p>
                    <p className="mt-1 font-mono">{linkDialog.restoreAttemptCount || 0}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">forceQrTriggered</p>
                    <p className="mt-1 font-mono">{linkDialog.forceQrTriggered ? 'true' : 'false'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">lastRestoreError</p>
                    <p className="mt-1 break-words font-mono">{linkDialog.lastRestoreError || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">reconnectStartedAt</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.reconnectStartedAt || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">qrGenerationStartedAt</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.qrGenerationStartedAt || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">qrScannedAt</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.qrScannedAt || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">browserConnectedAt</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.browserConnectedAt || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">socketConnectedAt</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.socketConnectedAt || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">authStateLoadedAt</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.authStateLoadedAt || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">sessionPersistedAt</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.sessionPersistedAt || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">loginFailureReason</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.loginFailureReason || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">lastDisconnectReason</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.lastDisconnectReason || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">whatsappSocketState</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.whatsappSocketState || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">puppeteerBrowserState</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.puppeteerBrowserState || '-'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">browserClosedUnexpectedly</p>
                    <p className="mt-1 font-mono">{linkDialog.browserClosedUnexpectedly ? 'true' : 'false'}</p>
                  </div>
                  <div>
                    <p className="text-amber-200/70">lastSocketError</p>
                    <p className="mt-1 break-all font-mono">{linkDialog.lastSocketError || '-'}</p>
                  </div>
                </div>
                {linkDialog.lastConnectionUpdate && (
                  <div className="mt-3 rounded-xl border border-amber-200/10 bg-slate-950/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">Last Connection Update</p>
                    <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] text-amber-50">{JSON.stringify(linkDialog.lastConnectionUpdate, null, 2)}</pre>
                  </div>
                )}
                {linkDialog.rawRuntimePayload && (
                  <div className="mt-3 rounded-xl border border-amber-200/10 bg-slate-950/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/70">Raw Runtime Payload</p>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11px] text-amber-50">{JSON.stringify(linkDialog.rawRuntimePayload, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleRefreshWhatsappQr} disabled={linkDialog.refreshing || linkDialog.waiting || linkDialog.checking}>
                {linkDialog.refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                Refresh QR
              </Button>
              {linkDialog.pairingCode && (
                <Button variant="outline" onClick={copyPairingCode}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Pairing Code
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => refreshWhatsappStatus(linkDialog.channelId)} disabled={linkDialog.checking || linkDialog.refreshing || linkDialog.waiting}>
                {linkDialog.checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SearchCheck className="mr-2 h-4 w-4" />}
                Update Status
              </Button>
              <Button variant="ghost" onClick={closeLinkDialog}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
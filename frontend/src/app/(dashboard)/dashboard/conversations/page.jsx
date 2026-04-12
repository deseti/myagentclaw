'use client';

import { useEffect, useState, useRef } from 'react';
import { format } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import { Send, User, Bot, Loader2, MessagesSquare, AlertTriangle, CheckCircle, Ban, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSocket } from '@/lib/socket';
import api from '@/lib/api';
import { formatChannelContact, getChannelShortLabel } from '@/lib/channel';

const STATUS_FILTERS = [
  { value: 'all', label: 'Semua' },
  { value: 'NEEDS_ADMIN', label: 'Perlu Admin' },
  { value: 'ACTIVE', label: 'Aktif' },
  { value: 'CLOSED', label: 'Selesai' },
];

function getApiMessage(err, fallback) {
  return err?.response?.data?.message || err?.response?.data?.error || fallback;
}

function getCustomerLifecycleBadge(status) {
  switch (status) {
    case 'PENDING':
      return { label: 'Pending Approval', variant: 'warning' };
    case 'BLOCKED':
      return { label: 'Diblokir', variant: 'destructive' };
    case 'ARCHIVED':
      return { label: 'Diarsipkan', variant: 'secondary' };
    case 'ACTIVE':
    default:
      return { label: 'Aktif', variant: 'success' };
  }
}

function isApprovalPendingCustomer(customer) {
  return customer?.lifecycleStatus === 'PENDING' || customer?.accessStatus === 'PENDING';
}

function ConversationItem({ conv, selected, onClick }) {
  const lastMsg = conv.messages?.[0];
  const isHandoff = conv.status === 'NEEDS_ADMIN';
  const isPendingApproval = isApprovalPendingCustomer(conv.customer);
  const customerBadge = getCustomerLifecycleBadge(conv.customer?.lifecycleStatus);
  const customerLabel = conv.customer?.name || formatChannelContact(conv.customer?.phone || conv.customer?.phoneNumber) || 'Unknown';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-800 hover:bg-slate-800/60 transition-colors ${selected ? 'bg-slate-800' : ''} ${isHandoff ? 'border-l-2 border-l-red-500' : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm text-white truncate">{customerLabel}</span>
        <span className="text-xs text-slate-500 shrink-0 ml-2">
          {lastMsg ? format(new Date(lastMsg.createdAt), 'HH:mm', { locale: localeId }) : ''}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <p className="text-xs text-slate-400 truncate flex-1">
          {lastMsg?.content || 'Belum ada pesan'}
        </p>
        {conv.customer?.lifecycleStatus && conv.customer.lifecycleStatus !== 'ACTIVE' && (
          <Badge variant={customerBadge.variant} className="shrink-0 text-xs px-1 py-0">{customerBadge.label}</Badge>
        )}
        {isHandoff && !isPendingApproval && (
          <Badge variant="destructive" className="shrink-0 text-xs px-1 py-0">Admin</Badge>
        )}
      </div>
    </button>
  );
}

function ChatBubble({ msg }) {
  const isCustomer = msg.role === 'CUSTOMER';
  const isAdmin = msg.role === 'ADMIN';
  return (
    <div className={`flex ${isCustomer ? 'justify-start' : 'justify-end'} mb-3`}>
      {isCustomer && (
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 mr-2 mt-1 shrink-0">
          <User className="h-3.5 w-3.5 text-slate-300" />
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm ${
          isCustomer
            ? 'bg-slate-700 text-white rounded-tl-sm'
            : isAdmin
            ? 'bg-blue-600 text-white rounded-tr-sm'
            : 'bg-primary/20 border border-primary/30 text-white rounded-tr-sm'
        }`}
      >
        {msg.content}
        <div className="mt-1 text-[10px] opacity-60 text-right">
          {format(new Date(msg.createdAt || msg.sentAt), 'HH:mm')}
        </div>
      </div>
      {!isCustomer && (
        <div className="flex h-7 w-7 items-center justify-center rounded-full ml-2 mt-1 shrink-0 bg-primary/20">
          {isAdmin ? <User className="h-3.5 w-3.5 text-blue-400" /> : <Bot className="h-3.5 w-3.5 text-primary" />}
        </div>
      )}
    </div>
  );
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [updatingCustomer, setUpdatingCustomer] = useState(false);
  const [approvingAccess, setApprovingAccess] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const fetchConversations = async (ws) => {
    try {
      setError('');
      const params = { workspaceId: ws, limit: 30 };
      if (filter !== 'all') params.status = filter;
      const { data } = await api.get('/conversations', { params });
      setConversations(data.conversations ?? data.data ?? []);
    } catch (err) {
      setError(getApiMessage(err, 'Gagal memuat percakapan'));
    }
  };

  useEffect(() => {
    async function init() {
      try {
        const { data: me } = await api.get('/auth/me');
        const ws = me.workspace?.id;
        setWorkspaceId(ws);
        if (ws) await fetchConversations(ws);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (workspaceId) fetchConversations(workspaceId);
  }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const openConversation = async (conv) => {
    setSelected(conv);
    setLoadingMsgs(true);
    try {
      const { data } = await api.get(`/conversations/${conv.id}`);
      setMessages(data.messages ?? []);
      setSelected((prev) => prev ? { ...prev, ...data } : data);
    } catch (err) {
      setError(getApiMessage(err, 'Gagal memuat pesan'));
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useSocket({
    'chat:new_message': (payload) => {
      const messageTimestamp = payload.sentAt || payload.timestamp;

      // Append ke messages jika conversation yang sedang dibuka
      if (selected && payload.conversationId === selected.id) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now(), role: payload.role, content: payload.content, createdAt: messageTimestamp },
        ]);
        setSelected((current) => current ? {
          ...current,
          customer: current.customer
            ? { ...current.customer, lifecycleStatus: payload.customerLifecycleStatus || current.customer.lifecycleStatus }
            : current.customer,
        } : current);
      }
      // Update preview di list
      setConversations((prev) =>
        prev.map((c) =>
          c.id === payload.conversationId
            ? {
              ...c,
              messages: [{ content: payload.content, createdAt: messageTimestamp }],
              customer: c.customer
                ? { ...c.customer, lifecycleStatus: payload.customerLifecycleStatus || c.customer.lifecycleStatus }
                : c.customer,
            }
            : c
        )
      );
    },
    'chat:handoff_needed': (payload) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === payload.conversationId
          ? {
            ...c,
            status: 'NEEDS_ADMIN',
            customer: payload.reason === 'APPROVAL_PENDING' && c.customer
              ? { ...c.customer, lifecycleStatus: 'PENDING', accessStatus: 'PENDING' }
              : c.customer,
          }
          : c))
      );
      if (selected?.id === payload.conversationId) {
        setSelected((s) => s ? {
          ...s,
          status: 'NEEDS_ADMIN',
          customer: payload.reason === 'APPROVAL_PENDING' && s.customer
            ? { ...s.customer, lifecycleStatus: 'PENDING', accessStatus: 'PENDING' }
            : s.customer,
        } : s);
      }
    },
    'customer:approval_updated': (payload) => {
      setConversations((current) => current.map((conv) => {
        const sameCustomer = !payload.customerId || conv.customer?.id === payload.customerId;
        const sameConversation = !payload.conversationId || conv.id === payload.conversationId;
        const currentAgentId = conv.agentId || conv.agent?.id;
        const sameAgent = !payload.agentId || currentAgentId === payload.agentId;

        if (!(sameCustomer && sameConversation && sameAgent) || conv.status === 'CLOSED') return conv;

        return {
          ...conv,
          status: 'ACTIVE',
          customer: conv.customer
            ? { ...conv.customer, lifecycleStatus: 'ACTIVE', accessStatus: 'ACTIVE' }
            : conv.customer,
        };
      }));

      setSelected((current) => {
        if (!current) return current;

        const sameCustomer = !payload.customerId || current.customer?.id === payload.customerId;
        const sameConversation = !payload.conversationId || current.id === payload.conversationId;
        const currentAgentId = current.agentId || current.agent?.id;
        const sameAgent = !payload.agentId || currentAgentId === payload.agentId;

        if (!(sameCustomer && sameConversation && sameAgent) || current.status === 'CLOSED') return current;

        return {
          ...current,
          status: 'ACTIVE',
          customer: current.customer
            ? { ...current.customer, lifecycleStatus: 'ACTIVE', accessStatus: 'ACTIVE' }
            : current.customer,
        };
      });
    },
    'conversation:closed': (payload) => {
      setConversations((prev) => prev.filter((c) => c.id !== payload.conversationId));
      if (selected?.id === payload.conversationId) setSelected(null);
    },
  });

  const handleReply = async () => {
    if (!replyText.trim() || !selected) return;
    setSending(true);
    try {
      await api.post(`/conversations/${selected.id}/reply`, { text: replyText.trim() });
      setReplyText('');
    } catch (err) {
      setError(getApiMessage(err, 'Gagal mengirim balasan'));
    } finally {
      setSending(false);
    }
  };

  const handleClose = async () => {
    if (!selected) return;
    try {
      await api.patch(`/conversations/${selected.id}/close`);
      setSelected(null);
      if (workspaceId) await fetchConversations(workspaceId);
    } catch (err) {
      setError(getApiMessage(err, 'Gagal menutup percakapan'));
    }
  };

  const handleTakeOver = async () => {
    if (!selected) return;
    try {
      await api.patch(`/conversations/${selected.id}/escalate`);
      setSelected((s) => s ? { ...s, status: 'NEEDS_ADMIN' } : s);
    } catch (err) {
      setError(getApiMessage(err, 'Gagal mengambil alih'));
    }
  };

  const handleCustomerLifecycle = async (action) => {
    if (!selected?.customer?.id || !workspaceId) return;

    setUpdatingCustomer(true);
    try {
      const { data } = await api.patch(`/customers/${selected.customer.id}/lifecycle`, { action });
      const nextCustomer = data.customer;

      setSelected((current) => current ? { ...current, customer: { ...current.customer, ...nextCustomer, phone: nextCustomer.phoneNumber } } : current);
      setConversations((current) => current.map((conv) => (
        conv.customer?.id === nextCustomer.id
          ? { ...conv, customer: { ...conv.customer, ...nextCustomer, phone: nextCustomer.phoneNumber } }
          : conv
      )));
    } catch (err) {
      setError(getApiMessage(err, 'Gagal memperbarui status customer'));
    } finally {
      setUpdatingCustomer(false);
    }
  };

  const handleApproveConversation = async () => {
    if (!selected) return;

    setApprovingAccess(true);
    try {
      const { data } = await api.patch(`/conversations/${selected.id}/approve`);
      const nextConversation = data.conversation;

      setSelected((current) => current ? { ...current, ...nextConversation, customer: { ...current.customer, ...nextConversation.customer } } : current);
      setConversations((current) => current.map((conv) => (
        conv.id === selected.id
          ? { ...conv, ...nextConversation, customer: { ...conv.customer, ...nextConversation.customer } }
          : conv
      )));
    } catch (err) {
      setError(getApiMessage(err, 'Gagal mengapprove customer'));
    } finally {
      setApprovingAccess(false);
    }
  };

  const filteredConvs = conversations.filter((c) =>
    filter === 'all' ? true : c.status === filter
  );
  const selectedCustomerBadge = getCustomerLifecycleBadge(selected?.customer?.lifecycleStatus);
  const isCustomerBlocked = selected?.customer?.lifecycleStatus === 'BLOCKED';
  const isApprovalPending = isApprovalPendingCustomer(selected?.customer);

  return (
    <div className="flex h-[calc(100vh-5rem)] gap-0 overflow-hidden rounded-xl border border-slate-800">
      {/* LEFT: Conversation list */}
      <div className="w-80 shrink-0 flex flex-col border-r border-slate-800 bg-slate-900">
        <div className="p-3 border-b border-slate-800">
          <h2 className="font-semibold text-white mb-3">Percakapan</h2>
          <Tabs value={filter} onValueChange={setFilter}>
            <TabsList className="w-full grid grid-cols-4 bg-slate-800/60 h-8">
              {STATUS_FILTERS.map((f) => (
                <TabsTrigger key={f.value} value={f.value} className="text-xs px-1">
                  {f.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : filteredConvs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-2">
              <MessagesSquare className="h-8 w-8" />
              <p className="text-sm">Tidak ada percakapan</p>
            </div>
          ) : (
            filteredConvs.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                selected={selected?.id === conv.id}
                onClick={() => openConversation(conv)}
              />
            ))
          )}
        </div>
      </div>

      {/* RIGHT: Chat detail */}
      {selected ? (
        <div className="flex-1 flex flex-col bg-slate-950 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700">
                <User className="h-4 w-4 text-slate-300" />
              </div>
              <div>
                <p className="font-medium text-white text-sm">{selected.customer?.name || 'Unknown'}</p>
                <p className="text-xs text-slate-400">
                  {formatChannelContact(selected.customer?.phone || selected.customer?.phoneNumber)} · {getChannelShortLabel(selected.channelType, selected.customer?.phone || selected.customer?.phoneNumber)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selected?.customer?.lifecycleStatus && (
                <Badge variant={selectedCustomerBadge.variant}>{selectedCustomerBadge.label}</Badge>
              )}
              <Badge
                variant={
                  selected.status === 'NEEDS_ADMIN' ? 'destructive' :
                  selected.status === 'CLOSED' ? 'secondary' : 'success'
                }
              >
                {selected.status === 'NEEDS_ADMIN' ? 'Perlu Admin' :
                 selected.status === 'CLOSED' ? 'Selesai' : 'Aktif'}
              </Badge>
              {isApprovalPending && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleApproveConversation}
                  disabled={approvingAccess}
                  className="text-xs h-7"
                >
                  {approvingAccess ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-1 h-3.5 w-3.5" />
                  )}
                  Approve
                </Button>
              )}
              <Button
                variant={isCustomerBlocked ? 'outline' : 'destructive'}
                size="sm"
                onClick={() => handleCustomerLifecycle(isCustomerBlocked ? 'UNBLOCK' : 'BLOCK')}
                disabled={updatingCustomer}
                className="text-xs h-7"
              >
                {updatingCustomer ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : isCustomerBlocked ? (
                  <ShieldOff className="mr-1 h-3.5 w-3.5" />
                ) : (
                  <Ban className="mr-1 h-3.5 w-3.5" />
                )}
                {isCustomerBlocked ? 'Buka Blokir' : 'Blokir'}
              </Button>
              {selected.status !== 'CLOSED' && (
                <Button variant="outline" size="sm" onClick={handleClose} className="text-xs h-7">
                  <CheckCircle className="mr-1 h-3.5 w-3.5" />
                  Selesaikan
                </Button>
              )}
            </div>
          </div>

          {/* Handoff banner */}
          {selected.status === 'NEEDS_ADMIN' && (
            <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>
                  {isApprovalPending
                    ? 'Menunggu approval admin atau approval code dari customer.'
                    : 'Menunggu Admin — customer memerlukan bantuan langsung'}
                </span>
                {isApprovalPending ? (
                  <Button size="sm" variant="secondary" onClick={handleApproveConversation} disabled={approvingAccess} className="ml-4 h-7 text-xs">
                    {approvingAccess && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    Approve Sekarang
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={handleTakeOver} className="ml-4 h-7 text-xs">
                    Ambil Alih
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {loadingMsgs ? (
              <div className="flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
            ) : messages.length === 0 ? (
              <p className="text-center text-slate-500 text-sm">Belum ada pesan</p>
            ) : (
              messages.map((msg, i) => <ChatBubble key={msg.id || i} msg={msg} />)
            )}
            <div ref={bottomRef} />
          </div>

          {/* Reply input — hanya aktif saat NEEDS_ADMIN atau ACTIVE (admin can always reply) */}
          <div className="border-t border-slate-800 p-3 flex gap-2 bg-slate-900">
            <Input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleReply()}
              placeholder={selected.status === 'CLOSED'
                ? 'Percakapan sudah ditutup'
                : isCustomerBlocked
                ? 'Customer sedang diblokir'
                : 'Ketik balasan admin...'}
              disabled={selected.status === 'CLOSED' || isCustomerBlocked || sending}
              className="bg-slate-800 border-slate-700"
            />
            <Button
              onClick={handleReply}
              disabled={!replyText.trim() || selected.status === 'CLOSED' || isCustomerBlocked || sending}
              size="icon"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-600">
          <div className="text-center space-y-2">
            <MessagesSquare className="h-12 w-12 mx-auto mb-3" />
            <p className="font-medium">Pilih percakapan</p>
            <p className="text-sm text-slate-500">Klik percakapan di sebelah kiri untuk membukanya</p>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 z-50">
          <Alert variant="destructive" className="w-72">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}

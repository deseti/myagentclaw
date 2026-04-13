'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Edit3,
  Eye,
  FileText,
  Loader2,
  MessageSquareText,
  Plus,
  Receipt,
  RefreshCcw,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import api from '@/lib/api';
import {
  getInstalledInternalSkill,
  INTERNAL_SKILL_KEYS,
  isInternalSkillActive,
} from '@/lib/internalSkills';
import {
  DEFAULT_PAYMENT_REMINDER_TEMPLATES,
  formatPaymentReminderAmount,
  formatPaymentReminderDate,
  getPaymentReminderStatusLabel,
  getPaymentReminderStatusTone,
  getPaymentReminderTypeLabel,
  PAYMENT_REMINDER_TYPE_OPTIONS,
} from '@/lib/paymentReminders';
import { useSocket } from '@/lib/socket';

const PAYMENT_REMINDER_EVENTS = [
  'payment-reminder.created',
  'payment-reminder.updated',
  'payment-reminder.cancelled',
  'payment-reminder.deleted',
  'payment-reminder.sent',
  'payment-reminder.failed',
  'payment-reminder:updated',
];

const REMINDER_TYPES_REQUIRING_AMOUNT = new Set(['INVOICE', 'DP', 'INSTALLMENT']);
const WIB_OFFSET_HOURS = 7;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseIncomingWibDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const normalized = String(value).trim();
  if (!normalized) return null;

  const hasExplicitOffset = /(?:Z|[+\-]\d{2}:\d{2})$/i.test(normalized);
  if (hasExplicitOffset) {
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const localDateTimeMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/);
  if (localDateTimeMatch) {
    const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = localDateTimeMatch;
    const ms = Number(millisecond.padEnd(3, '0'));
    return new Date(Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - WIB_OFFSET_HOURS,
      Number(minute),
      Number(second),
      ms,
    ));
  }

  const localDateMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (localDateMatch) {
    const [, year, month, day] = localDateMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), -WIB_OFFSET_HOURS, 0, 0, 0));
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getValidationDetailMessage(details) {
  if (!details || typeof details !== 'object') {
    return '';
  }

  const entries = Object.entries(details);
  for (const [, messages] of entries) {
    if (Array.isArray(messages) && messages.length > 0) {
      return String(messages[0]);
    }
  }

  return '';
}

function getErrorMessage(err, fallback) {
  const responseData = err?.response?.data;
  const detailMessage = getValidationDetailMessage(responseData?.details);

  if (responseData?.message && responseData.message !== 'Validation error') {
    return responseData.message;
  }

  if (detailMessage) {
    return detailMessage;
  }

  return responseData?.error || fallback;
}

function toDateTimeLocal(value) {
  if (!value) return '';

  const date = parseIncomingWibDate(value);
  if (!date) {
    return '';
  }

  const wibDate = new Date(date.getTime() + WIB_OFFSET_HOURS * 60 * 60 * 1000);
  const year = wibDate.getUTCFullYear();
  const month = pad2(wibDate.getUTCMonth() + 1);
  const day = pad2(wibDate.getUTCDate());
  const hour = pad2(wibDate.getUTCHours());
  const minute = pad2(wibDate.getUTCMinutes());

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoString(value) {
  if (!value) return undefined;

  const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
  const localMatch = String(value).match(localDateTimePattern);

  if (localMatch) {
    const [, year, month, day, hour, minute] = localMatch;
    const utcMs = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - WIB_OFFSET_HOURS,
      Number(minute),
      0,
      0,
    );
    return new Date(utcMs).toISOString();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function nextReminderDate(hoursAhead = 24) {
  const now = new Date();
  const nowWib = new Date(now.getTime() + WIB_OFFSET_HOURS * 60 * 60 * 1000);
  nowWib.setUTCMinutes(0, 0, 0);
  nowWib.setUTCHours(nowWib.getUTCHours() + hoursAhead);

  const utcDate = new Date(nowWib.getTime() - WIB_OFFSET_HOURS * 60 * 60 * 1000);
  return toDateTimeLocal(utcDate.toISOString());
}

function buildReminderForm({ reminder = null, template = null, defaultAgentId = '' } = {}) {
  if (reminder) {
    return {
      id: reminder.id,
      customerId: reminder.customerId || '',
      agentId: reminder.agentId || '',
      type: reminder.type || template?.type || 'INVOICE',
      title: reminder.title || '',
      description: reminder.description || '',
      amount: reminder.amount === null || reminder.amount === undefined ? '' : String(reminder.amount),
      currency: reminder.currency || 'IDR',
      dueDate: toDateTimeLocal(reminder.dueDate),
      scheduledAt: toDateTimeLocal(reminder.scheduledAt),
      originalScheduledAt: toDateTimeLocal(reminder.scheduledAt),
      templateType: reminder.templateType || reminder.type || template?.type || 'INVOICE',
      messageContent: reminder.messageContent || '',
    };
  }

  return {
    id: '',
    customerId: '',
    agentId: defaultAgentId || '',
    type: template?.type || 'INVOICE',
    title: template?.title || 'Invoice Reminder',
    description: '',
    amount: '',
    currency: 'IDR',
    dueDate: nextReminderDate(24),
    scheduledAt: nextReminderDate(24),
    originalScheduledAt: '',
    templateType: template?.type || 'INVOICE',
    messageContent: '',
  };
}

function buildTemplatePreview(template, form, customers) {
  if (!template) return '-';

  const customerName = customers.find((item) => item.id === form.customerId)?.name || 'Pelanggan';
  const amount = form.amount ? formatPaymentReminderAmount(form.amount, form.currency || 'IDR') : 'nominal yang tertera';
  const dueDate = form.dueDate ? formatPaymentReminderDate(toIsoString(form.dueDate)) : 'tanggal yang dijadwalkan';

  return String(template.preview || '')
    .replaceAll('{customerName}', customerName)
    .replaceAll('{amount}', amount)
    .replaceAll('{dueDate}', dueDate);
}

function createToastId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function StatCard({ title, value, hint }) {
  return (
    <Card className="border-slate-800 bg-slate-900/80">
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{title}</p>
        <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
        <p className="mt-2 text-xs text-slate-400">{hint}</p>
      </CardContent>
    </Card>
  );
}

function ToastStack({ toasts }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${toast.variant === 'danger'
            ? 'bg-red-600 text-white'
            : toast.variant === 'warning'
            ? 'bg-amber-400 text-slate-950'
            : 'bg-slate-700 text-white'
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/70 px-6 py-12 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-sky-500/20 bg-sky-500/10">
        <Wallet className="h-9 w-9 text-sky-300" />
      </div>
      <h3 className="mt-6 text-xl font-semibold text-white">Belum ada payment reminder</h3>
      <p className="mt-2 text-sm text-slate-400">Buat reminder pertama untuk invoice, DP, installment, atau subscription.</p>
      <Button className="mt-6" onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        Create Reminder
      </Button>
    </div>
  );
}

function ReminderTable({ reminders, onView, onEdit, onReschedule, onCancel, onDelete }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-950/60">
      <table className="min-w-full text-left text-sm text-slate-200">
        <thead className="bg-slate-900/80 text-xs uppercase tracking-[0.18em] text-slate-400">
          <tr>
            <th className="px-4 py-3 font-medium">Customer</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Due Date</th>
            <th className="px-4 py-3 font-medium">Scheduled At</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Assigned Agent</th>
            <th className="px-4 py-3 font-medium">Last Sent</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {reminders.map((reminder) => {
            const canEdit = !['SENT', 'CANCELLED'].includes(reminder.status);
            const canReschedule = reminder.status !== 'SENT';
            const canCancel = !['SENT', 'CANCELLED'].includes(reminder.status);

            return (
              <tr key={reminder.id} className="border-t border-slate-800 align-top">
                <td className="px-4 py-4">
                  <div>
                    <p className="font-medium text-white">{reminder.customer?.name || 'Unknown customer'}</p>
                    <p className="mt-1 text-xs text-slate-500">{reminder.customer?.phoneNumber || '-'}</p>
                  </div>
                </td>
                <td className="px-4 py-4">{getPaymentReminderTypeLabel(reminder.type)}</td>
                <td className="px-4 py-4">{formatPaymentReminderAmount(reminder.amount, reminder.currency)}</td>
                <td className="px-4 py-4">{formatPaymentReminderDate(reminder.dueDate)}</td>
                <td className="px-4 py-4">{formatPaymentReminderDate(reminder.scheduledAt)}</td>
                <td className="px-4 py-4">
                  <div className="space-y-2">
                    <Badge variant={getPaymentReminderStatusTone(reminder.status)}>
                      {getPaymentReminderStatusLabel(reminder.status)}
                    </Badge>
                    {reminder.lastError && (
                      <p className="max-w-[220px] text-xs text-red-300">{reminder.lastError}</p>
                    )}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div>
                    <p className="font-medium text-white">{reminder.agent?.name || '-'}</p>
                    <p className="mt-1 text-xs text-slate-500">{reminder.agent?.status || '-'}</p>
                  </div>
                </td>
                <td className="px-4 py-4">{formatPaymentReminderDate(reminder.sentAt)}</td>
                <td className="px-4 py-4">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => onView(reminder)}>
                      <Eye className="mr-2 h-3.5 w-3.5" />
                      View
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onEdit(reminder)} disabled={!canEdit}>
                      <Edit3 className="mr-2 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onReschedule(reminder)} disabled={!canReschedule}>
                      <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                      Reschedule
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onCancel(reminder)} disabled={!canCancel}>
                      <XCircle className="mr-2 h-3.5 w-3.5" />
                      Cancel
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onDelete(reminder)}>
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TemplateCard({ template, onUse }) {
  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-white">{template.title}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.24em] text-slate-500">{getPaymentReminderTypeLabel(template.type)}</p>
        </div>
        <Badge variant={template.status === 'active' ? 'success' : 'secondary'}>
          {template.status === 'active' ? 'Active' : 'Inactive'}
        </Badge>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">{template.preview}</p>
      <Button className="mt-5" size="sm" variant="outline" onClick={() => onUse(template)}>
        <Plus className="mr-2 h-4 w-4" />
        Use Template
      </Button>
    </div>
  );
}

function ReminderFormDialog({
  open,
  mode,
  form,
  error,
  saving,
  customers,
  agents,
  templates,
  onOpenChange,
  onChange,
  onSubmit,
}) {
  const selectedTemplate = templates.find((item) => item.type === (form.templateType || form.type)) || templates[0] || null;
  const previewMessage = form.messageContent?.trim() || buildTemplatePreview(selectedTemplate, form, customers);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Create Reminder' : 'Edit Reminder'}</DialogTitle>
          <DialogDescription className="text-slate-400">
            Tentukan customer, agent, jadwal, dan isi pesan reminder. Jika isi pesan dikosongkan, sistem akan membuat pesan dari template bawaan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Customer</Label>
              <Select value={form.customerId} onValueChange={(value) => onChange('customerId', value)}>
                <SelectTrigger className="border-slate-700 bg-slate-900">
                  <SelectValue placeholder="Pilih customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name || customer.phoneNumber} {customer.phoneNumber ? `· ${customer.phoneNumber}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Assigned Agent</Label>
              <Select value={form.agentId} onValueChange={(value) => onChange('agentId', value)}>
                <SelectTrigger className="border-slate-700 bg-slate-900">
                  <SelectValue placeholder="Pilih agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name} · {agent.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Reminder Type</Label>
              <Select
                value={form.type}
                onValueChange={(value) => {
                  onChange('type', value);
                  onChange('templateType', value);
                }}
              >
                <SelectTrigger className="border-slate-700 bg-slate-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_REMINDER_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Currency</Label>
              <Input
                className="border-slate-700 bg-slate-900"
                value={form.currency}
                onChange={(event) => onChange('currency', event.target.value.toUpperCase())}
                placeholder="IDR"
                maxLength={10}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                className="border-slate-700 bg-slate-900"
                value={form.title}
                onChange={(event) => onChange('title', event.target.value)}
                placeholder="Invoice Reminder"
              />
            </div>

            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                className="border-slate-700 bg-slate-900"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => onChange('amount', event.target.value)}
                placeholder="250000"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              className="min-h-[84px] border-slate-700 bg-slate-900"
              value={form.description}
              onChange={(event) => onChange('description', event.target.value)}
              placeholder="Catatan internal untuk tim Anda"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Due Date (WIB)</Label>
              <Input
                className="border-slate-700 bg-slate-900"
                type="datetime-local"
                value={form.dueDate}
                onChange={(event) => onChange('dueDate', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Scheduled At (WIB)</Label>
              <Input
                className="border-slate-700 bg-slate-900"
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(event) => onChange('scheduledAt', event.target.value)}
              />
              <p className="text-xs text-slate-500">Kosongkan jika Anda ingin worker mengikuti due date yang tersimpan.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <FileText className="h-4 w-4 text-sky-300" />
              Template Preview
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">{previewMessage}</p>
          </div>

          <div className="space-y-2">
            <Label>Custom Message</Label>
            <Textarea
              className="min-h-[140px] border-slate-700 bg-slate-900"
              value={form.messageContent}
              onChange={(event) => onChange('messageContent', event.target.value)}
              placeholder="Kosongkan untuk memakai template default yang sudah di-render otomatis"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'create' ? 'Simpan Reminder' : 'Update Reminder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReminderDetailDialog({ open, loading, error, detail, onOpenChange, onEdit, onReschedule, onCancel, onDelete }) {
  const reminder = detail?.reminder;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Reminder Detail</DialogTitle>
          <DialogDescription className="text-slate-400">
            Lihat status delivery, routing conversation, dan riwayat message untuk reminder ini.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : reminder ? (
          <div className="space-y-5 py-2">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div>
                <p className="text-lg font-semibold text-white">{reminder.title}</p>
                <p className="mt-2 text-sm text-slate-400">{reminder.description || 'Tanpa deskripsi tambahan.'}</p>
              </div>
              <Badge variant={getPaymentReminderStatusTone(reminder.status)}>
                {getPaymentReminderStatusLabel(reminder.status)}
              </Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Customer</p>
                <p className="mt-3 font-medium text-white">{reminder.customer?.name || '-'}</p>
                <p className="mt-1 text-sm text-slate-400">{reminder.customer?.phoneNumber || '-'}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Assigned Agent</p>
                <p className="mt-3 font-medium text-white">{reminder.agent?.name || '-'}</p>
                <p className="mt-1 text-sm text-slate-400">{reminder.agent?.status || '-'}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Amount</p>
                <p className="mt-3 font-medium text-white">{formatPaymentReminderAmount(reminder.amount, reminder.currency)}</p>
                <p className="mt-1 text-sm text-slate-400">{getPaymentReminderTypeLabel(reminder.type)}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <CalendarClock className="h-4 w-4 text-sky-300" />
                  Schedule
                </div>
                <dl className="mt-3 space-y-2 text-sm text-slate-300">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Due Date</dt>
                    <dd>{formatPaymentReminderDate(reminder.dueDate)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Scheduled At</dt>
                    <dd>{formatPaymentReminderDate(reminder.scheduledAt)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Created</dt>
                    <dd>{formatPaymentReminderDate(reminder.createdAt)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Updated</dt>
                    <dd>{formatPaymentReminderDate(reminder.updatedAt)}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  Delivery Status
                </div>
                <dl className="mt-3 space-y-2 text-sm text-slate-300">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Conversation</dt>
                    <dd>{detail?.delivery?.conversationId || reminder.conversationId || '-'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Message ID</dt>
                    <dd>{detail?.delivery?.messageId || '-'}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Sent At</dt>
                    <dd>{formatPaymentReminderDate(detail?.delivery?.sentAt || reminder.sentAt)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-slate-500">Failed At</dt>
                    <dd>{formatPaymentReminderDate(detail?.delivery?.failedAt || reminder.failedAt)}</dd>
                  </div>
                </dl>
                {(detail?.delivery?.lastError || reminder.lastError) && (
                  <Alert className="mt-4 border-red-500/20 bg-red-500/10 text-red-50">
                    <AlertDescription>{detail?.delivery?.lastError || reminder.lastError}</AlertDescription>
                  </Alert>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <MessageSquareText className="h-4 w-4 text-sky-300" />
                Message Content
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{reminder.messageContent}</p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <FileText className="h-4 w-4 text-sky-300" />
                Recent Reminder Messages
              </div>
              {detail?.history?.length ? (
                <div className="mt-4 space-y-3">
                  {detail.history.map((message) => (
                    <div key={message.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                        <span>{message.id}</span>
                        <span>{formatPaymentReminderDate(message.sentAt || message.createdAt)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{message.content}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">Belum ada message payment reminder yang tersimpan pada conversation terkait.</p>
              )}
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
          {reminder && (
            <>
              <Button variant="outline" onClick={() => onEdit(reminder)} disabled={['SENT', 'CANCELLED'].includes(reminder.status)}>
                <Edit3 className="mr-2 h-4 w-4" />
                Edit
              </Button>
              <Button variant="outline" onClick={() => onReschedule(reminder)} disabled={reminder.status === 'SENT'}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Reschedule
              </Button>
              <Button variant="outline" onClick={() => onCancel(reminder)} disabled={['SENT', 'CANCELLED'].includes(reminder.status)}>
                <XCircle className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => onDelete(reminder)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReminderRescheduleDialog({ open, value, error, saving, onOpenChange, onChange, onSubmit }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reschedule Reminder</DialogTitle>
          <DialogDescription className="text-slate-400">
            Atur jadwal baru agar worker mengirim ulang reminder pada waktu yang lebih tepat.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label>Scheduled At</Label>
            <Input
              className="border-slate-700 bg-slate-900"
              type="datetime-local"
              value={value.scheduledAt}
              onChange={(event) => onChange('scheduledAt', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Due Date</Label>
            <Input
              className="border-slate-700 bg-slate-900"
              type="datetime-local"
              value={value.dueDate}
              onChange={(event) => onChange('dueDate', event.target.value)}
            />
            <p className="text-xs text-slate-500">Biarkan seperti sekarang jika hanya ingin memindahkan waktu kirim.</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Simpan Jadwal Baru
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReminderConfirmDialog({ open, title, description, error, saving, confirmLabel, confirmVariant = 'destructive', onOpenChange, onConfirm }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-slate-400">{description}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateGuideDialog({ open, templates, onOpenChange, onUseTemplate }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Template Guide</DialogTitle>
          <DialogDescription className="text-slate-400">
            Template bawaan mendukung placeholder <span className="font-mono">customerName</span>, <span className="font-mono">amount</span>, dan <span className="font-mono">dueDate</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 lg:grid-cols-2">
          {templates.map((template) => (
            <TemplateCard key={template.type} template={template} onUse={onUseTemplate} />
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentReminderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceTier, setWorkspaceTier] = useState('FREE');
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, scheduled: 0, sent: 0, failed: 0 });
  const [reminders, setReminders] = useState([]);
  const [templates, setTemplates] = useState(DEFAULT_PAYMENT_REMINDER_TEMPLATES);
  const [customers, setCustomers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [skillStatus, setSkillStatus] = useState({ active: false, assignedCount: 0, usedBy: [] });
  const [formDialog, setFormDialog] = useState({ open: false, mode: 'create', saving: false, error: '' });
  const [form, setForm] = useState(buildReminderForm());
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState(null);
  const [rescheduleDialog, setRescheduleDialog] = useState({ open: false, saving: false, error: '', reminder: null, scheduledAt: '', dueDate: '' });
  const [confirmDialog, setConfirmDialog] = useState({ open: false, action: '', reminder: null, saving: false, error: '' });
  const [templateGuideOpen, setTemplateGuideOpen] = useState(false);

  function addToast(message, variant = 'default') {
    const id = createToastId();
    setToasts((current) => [...current, { id, message, variant }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }

  async function loadDashboard(options = {}) {
    const { silent = false } = options;

    if (!silent) {
      setLoading(true);
    }

    try {
      const { data: me } = await api.get('/auth/me');
      const nextWorkspaceId = me.workspace?.id || '';
      const nextTier = me.workspace?.subTier || 'FREE';

      if (!nextWorkspaceId || !['STARTER', 'GROWTH'].includes(nextTier)) {
        router.replace('/dashboard/skills');
        return;
      }

      const { data: installedPayload } = await api.get('/skills/installed');
      const installedSkills = Array.isArray(installedPayload.skills) ? installedPayload.skills : [];
      const paymentReminderSkill = getInstalledInternalSkill(installedSkills, INTERNAL_SKILL_KEYS.PAYMENT_REMINDER);

      if (!isInternalSkillActive(paymentReminderSkill)) {
        router.replace('/dashboard/skills');
        return;
      }

      const [reminderResponse, agentsResponse, customersResponse] = await Promise.all([
        api.get('/payment-reminders', { params: { workspaceId: nextWorkspaceId } }),
        api.get('/agents', { params: { workspaceId: nextWorkspaceId } }),
        api.get('/customers', { params: { workspaceId: nextWorkspaceId, status: 'ALL', limit: 100 } }),
      ]);

      const reminderData = reminderResponse.data || {};
      if (reminderData.skillStatus?.active === false) {
        router.replace('/dashboard/skills');
        return;
      }

      setWorkspaceId(nextWorkspaceId);
      setWorkspaceTier(nextTier);
      setSkillStatus(reminderData.skillStatus || { active: true, assignedCount: 0, usedBy: [] });
      setStats(reminderData.stats || { total: 0, pending: 0, scheduled: 0, sent: 0, failed: 0 });
      setReminders(Array.isArray(reminderData.reminders) ? reminderData.reminders : []);
      setTemplates(Array.isArray(reminderData.templates) && reminderData.templates.length > 0 ? reminderData.templates : DEFAULT_PAYMENT_REMINDER_TEMPLATES);
      setAgents(Array.isArray(agentsResponse.data?.agents) ? agentsResponse.data.agents : []);
      setCustomers(Array.isArray(customersResponse.data?.customers) ? customersResponse.data.customers : []);
      setError('');
    } catch (err) {
      const statusCode = err?.response?.status;
      if (statusCode === 403 || statusCode === 404) {
        router.replace('/dashboard/skills');
        return;
      }
      setError(getErrorMessage(err, 'Gagal memuat dashboard Payment Reminder'));
    } finally {
      setLoading(false);
    }
  }

  async function loadReminderDetail(reminderId, options = {}) {
    const { openDialog = false, silent = false } = options;

    if (!silent) {
      setDetailLoading(true);
      setDetailError('');
    }

    try {
      const { data } = await api.get(`/payment-reminders/${reminderId}`, {
        params: { workspaceId },
      });

      setDetail({
        reminder: data.reminder,
        history: Array.isArray(data.history) ? data.history : [],
        delivery: data.delivery || null,
      });

      if (openDialog) {
        setDetailDialogOpen(true);
      }
    } catch (err) {
      setDetailError(getErrorMessage(err, 'Gagal memuat detail payment reminder'));
      if (openDialog) {
        setDetailDialogOpen(true);
      }
    } finally {
      if (!silent) {
        setDetailLoading(false);
      }
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const socketHandlers = {};
  for (const eventName of PAYMENT_REMINDER_EVENTS) {
    socketHandlers[eventName] = async (payload = {}) => {
      if (payload?.workspaceId && workspaceId && payload.workspaceId !== workspaceId) {
        return;
      }

      if (payload?.action === 'sent') {
        addToast(`Reminder ${payload?.reminder?.title || ''} berhasil dikirim.`, 'default');
      }

      if (payload?.action === 'failed') {
        addToast(`Reminder ${payload?.reminder?.title || ''} gagal dikirim.`, 'warning');
      }

      await loadDashboard({ silent: true });

      if (detailDialogOpen && payload?.reminder?.id) {
        await loadReminderDetail(payload.reminder.id, { silent: true });
      }
    };
  }

  useSocket(socketHandlers);

  const recommendedAgentIds = Array.isArray(skillStatus.usedBy)
    ? skillStatus.usedBy.map((agent) => agent.id)
    : [];
  const formAgents = recommendedAgentIds.length > 0
    ? agents.filter((agent) => recommendedAgentIds.includes(agent.id))
    : agents.filter((agent) => agent.status === 'ACTIVE');

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreateDialog(template = null) {
    setForm(buildReminderForm({ template, defaultAgentId: recommendedAgentIds[0] || '' }));
    setFormDialog({ open: true, mode: 'create', saving: false, error: '' });
  }

  function openEditDialog(reminder) {
    setForm(buildReminderForm({ reminder }));
    setFormDialog({ open: true, mode: 'edit', saving: false, error: '' });
  }

  async function handleView(reminder) {
    setDetail({ reminder, history: [], delivery: null });
    await loadReminderDetail(reminder.id, { openDialog: true });
  }

  function handleReschedule(reminder) {
    setRescheduleDialog({
      open: true,
      saving: false,
      error: '',
      reminder,
      scheduledAt: toDateTimeLocal(reminder.scheduledAt),
      dueDate: toDateTimeLocal(reminder.dueDate),
    });
  }

  function handleCancel(reminder) {
    setConfirmDialog({ open: true, action: 'cancel', reminder, saving: false, error: '' });
  }

  function handleDelete(reminder) {
    setConfirmDialog({ open: true, action: 'delete', reminder, saving: false, error: '' });
  }

  async function submitReminderForm() {
    if (!workspaceId) {
      setFormDialog((current) => ({ ...current, error: 'Workspace belum siap.' }));
      return;
    }

    if (!form.customerId || !form.agentId || !form.dueDate) {
      setFormDialog((current) => ({ ...current, error: 'Customer, agent, dan due date wajib diisi.' }));
      return;
    }

    const dueDateIso = toIsoString(form.dueDate);
    if (!dueDateIso) {
      setFormDialog((current) => ({ ...current, error: 'Due date tidak valid.' }));
      return;
    }

    const amountValue = form.amount === '' ? null : Number(form.amount);
    if (form.amount !== '' && Number.isNaN(amountValue)) {
      setFormDialog((current) => ({ ...current, error: 'Nominal tidak valid.' }));
      return;
    }

    if (REMINDER_TYPES_REQUIRING_AMOUNT.has(form.type) && (amountValue === null || amountValue < 0)) {
      setFormDialog((current) => ({ ...current, error: 'Nominal wajib diisi untuk tipe reminder ini.' }));
      return;
    }

    const scheduledAtIso = form.scheduledAt ? toIsoString(form.scheduledAt) : undefined;
    if (form.scheduledAt && !scheduledAtIso) {
      setFormDialog((current) => ({ ...current, error: 'Scheduled At tidak valid.' }));
      return;
    }

    setFormDialog((current) => ({ ...current, saving: true, error: '' }));

    const payload = {
      workspaceId,
      customerId: form.customerId,
      agentId: form.agentId,
      type: form.type,
      title: form.title.trim() || undefined,
      description: form.description.trim() || undefined,
      amount: amountValue,
      currency: form.currency.trim().toUpperCase() || 'IDR',
      dueDate: dueDateIso,
      templateType: form.templateType || form.type,
      messageContent: form.messageContent.trim() || undefined,
    };

    const scheduledAtChanged = formDialog.mode === 'create' || form.scheduledAt !== form.originalScheduledAt;
    if (scheduledAtIso && scheduledAtChanged) {
      payload.scheduledAt = scheduledAtIso;
    }

    try {
      if (formDialog.mode === 'create') {
        await api.post('/payment-reminders', payload);
        addToast('Payment reminder berhasil dibuat.');
      } else {
        await api.put(`/payment-reminders/${form.id}`, payload);
        addToast('Payment reminder berhasil diupdate.');
      }

      setFormDialog({ open: false, mode: 'create', saving: false, error: '' });
      await loadDashboard({ silent: true });
    } catch (err) {
      setFormDialog((current) => ({
        ...current,
        saving: false,
        error: getErrorMessage(err, formDialog.mode === 'create' ? 'Gagal membuat payment reminder' : 'Gagal mengupdate payment reminder'),
      }));
      return;
    }

    setFormDialog({ open: false, mode: 'create', saving: false, error: '' });
  }

  async function submitReschedule() {
    if (!rescheduleDialog.reminder?.id || !rescheduleDialog.scheduledAt) {
      setRescheduleDialog((current) => ({ ...current, error: 'Scheduled At wajib diisi.' }));
      return;
    }

    setRescheduleDialog((current) => ({ ...current, saving: true, error: '' }));

    try {
      await api.post(`/payment-reminders/${rescheduleDialog.reminder.id}/reschedule`, {
        workspaceId,
        scheduledAt: toIsoString(rescheduleDialog.scheduledAt),
        dueDate: rescheduleDialog.dueDate ? toIsoString(rescheduleDialog.dueDate) : undefined,
      });

      addToast('Payment reminder berhasil dijadwalkan ulang.');
      setRescheduleDialog({ open: false, saving: false, error: '', reminder: null, scheduledAt: '', dueDate: '' });
      await loadDashboard({ silent: true });
      if (detail?.reminder?.id === rescheduleDialog.reminder.id) {
        await loadReminderDetail(rescheduleDialog.reminder.id, { silent: true });
      }
    } catch (err) {
      setRescheduleDialog((current) => ({ ...current, saving: false, error: getErrorMessage(err, 'Gagal menjadwalkan ulang payment reminder') }));
    }
  }

  async function submitConfirmAction() {
    if (!confirmDialog.reminder?.id) {
      return;
    }

    setConfirmDialog((current) => ({ ...current, saving: true, error: '' }));

    try {
      if (confirmDialog.action === 'cancel') {
        await api.post(`/payment-reminders/${confirmDialog.reminder.id}/cancel`, { workspaceId });
        addToast('Payment reminder berhasil dicancel.', 'warning');
      } else {
        await api.delete(`/payment-reminders/${confirmDialog.reminder.id}`, {
          params: { workspaceId },
        });
        addToast('Payment reminder berhasil dihapus.', 'warning');
      }

      const reminderId = confirmDialog.reminder.id;
      setConfirmDialog({ open: false, action: '', reminder: null, saving: false, error: '' });
      await loadDashboard({ silent: true });

      if (detail?.reminder?.id === reminderId) {
        setDetailDialogOpen(false);
      }
    } catch (err) {
      setConfirmDialog((current) => ({ ...current, saving: false, error: getErrorMessage(err, 'Aksi gagal dijalankan.') }));
    }
  }

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(251,191,36,0.14),transparent_28%)]" />
        <div className="relative space-y-6 p-6 md:p-7">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Starter</Badge>
                <Badge variant="outline">Finance</Badge>
                <Badge variant={skillStatus.active ? 'success' : 'secondary'}>
                  {skillStatus.active ? 'Active' : 'Installed'}
                </Badge>
              </div>
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-500/20 bg-sky-500/10">
                  <Receipt className="h-7 w-7 text-sky-300" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-white">Payment Reminder</h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                    Kelola invoice reminder, DP, installment, dan subscription dengan delivery otomatis ke channel aktif milik agent yang sudah di-assign skill ini.
                  </p>
                  <p className="mt-3 text-xs text-slate-500">
                    Workspace {workspaceTier} · Used by {skillStatus.assignedCount || 0} agent{skillStatus.assignedCount === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={() => openCreateDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                Create Reminder
              </Button>
              <Button variant="outline" onClick={() => setTemplateGuideOpen(true)}>
                <FileText className="mr-2 h-4 w-4" />
                Template Guide
              </Button>
            </div>
          </div>

          <Alert className="border-slate-800 bg-slate-900/80 text-slate-200">
            <AlertDescription>
              Reminder akan diproses worker saat due atau scheduled time tercapai, lalu status dashboard diperbarui lewat Socket.IO per workspace.
            </AlertDescription>
          </Alert>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Total Reminders" value={stats.total || 0} hint="Semua reminder di workspace ini" />
        <StatCard title="Pending" value={stats.pending || 0} hint="Menunggu jatuh tempo atau trigger berikutnya" />
        <StatCard title="Scheduled" value={stats.scheduled || 0} hint="Sudah punya jadwal kirim spesifik" />
        <StatCard title="Sent" value={stats.sent || 0} hint="Berhasil dikirim lewat channel aktif" />
        <StatCard title="Failed" value={stats.failed || 0} hint="Perlu cek agent, channel, atau nomor customer" />
      </div>

      <Card className="border-slate-800 bg-slate-950/70">
        <CardHeader>
          <CardTitle className="text-lg text-white">Reminder List</CardTitle>
        </CardHeader>
        <CardContent>
          {reminders.length > 0 ? (
            <ReminderTable
              reminders={reminders}
              onView={handleView}
              onEdit={openEditDialog}
              onReschedule={handleReschedule}
              onCancel={handleCancel}
              onDelete={handleDelete}
            />
          ) : (
            <EmptyState onCreate={() => openCreateDialog()} />
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-950/70">
        <CardHeader>
          <CardTitle className="text-lg text-white">Reminder Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-2">
            {templates.map((template) => (
              <TemplateCard key={template.type} template={template} onUse={openCreateDialog} />
            ))}
          </div>
        </CardContent>
      </Card>

      <ReminderFormDialog
        open={formDialog.open}
        mode={formDialog.mode}
        form={form}
        error={formDialog.error}
        saving={formDialog.saving}
        customers={customers}
        agents={formAgents}
        templates={templates}
        onOpenChange={(open) => setFormDialog((current) => ({ ...current, open, error: open ? current.error : '' }))}
        onChange={updateForm}
        onSubmit={submitReminderForm}
      />

      <ReminderDetailDialog
        open={detailDialogOpen}
        loading={detailLoading}
        error={detailError}
        detail={detail}
        onOpenChange={setDetailDialogOpen}
        onEdit={(reminder) => {
          setDetailDialogOpen(false);
          openEditDialog(reminder);
        }}
        onReschedule={(reminder) => {
          setDetailDialogOpen(false);
          handleReschedule(reminder);
        }}
        onCancel={(reminder) => {
          setDetailDialogOpen(false);
          handleCancel(reminder);
        }}
        onDelete={(reminder) => {
          setDetailDialogOpen(false);
          handleDelete(reminder);
        }}
      />

      <ReminderRescheduleDialog
        open={rescheduleDialog.open}
        value={rescheduleDialog}
        error={rescheduleDialog.error}
        saving={rescheduleDialog.saving}
        onOpenChange={(open) => setRescheduleDialog((current) => ({ ...current, open, error: open ? current.error : '' }))}
        onChange={(field, value) => setRescheduleDialog((current) => ({ ...current, [field]: value }))}
        onSubmit={submitReschedule}
      />

      <ReminderConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.action === 'cancel' ? 'Cancel Reminder?' : 'Delete Reminder?'}
        description={confirmDialog.action === 'cancel'
          ? `Reminder ${confirmDialog.reminder?.title || ''} akan dihentikan dan tidak lagi dikirim oleh worker.`
          : `Reminder ${confirmDialog.reminder?.title || ''} akan dihapus permanen dari dashboard ini.`}
        error={confirmDialog.error}
        saving={confirmDialog.saving}
        confirmLabel={confirmDialog.action === 'cancel' ? 'Cancel Reminder' : 'Delete Reminder'}
        confirmVariant={confirmDialog.action === 'cancel' ? 'outline' : 'destructive'}
        onOpenChange={(open) => setConfirmDialog((current) => ({ ...current, open, error: open ? current.error : '' }))}
        onConfirm={submitConfirmAction}
      />

      <TemplateGuideDialog
        open={templateGuideOpen}
        templates={templates}
        onOpenChange={setTemplateGuideOpen}
        onUseTemplate={(template) => {
          setTemplateGuideOpen(false);
          openCreateDialog(template);
        }}
      />

      <ToastStack toasts={toasts} />
    </div>
  );
}
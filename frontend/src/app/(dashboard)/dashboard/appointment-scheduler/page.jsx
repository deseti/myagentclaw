'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Eye,
  Loader2,
  MapPin,
  Plus,
  RefreshCcw,
  RotateCcw,
  UserRound,
  Users,
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
  APPOINTMENT_LOCATION_OPTIONS,
  APPOINTMENT_STATUS_OPTIONS,
  APPOINTMENT_TYPE_OPTIONS,
  formatAppointmentDate,
  getAppointmentLocationLabel,
  getAppointmentStatusLabel,
  getAppointmentStatusTone,
  getAppointmentTypeLabel,
} from '@/lib/appointmentScheduler';

const DEFAULT_TIMEZONE = 'Asia/Jakarta';

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - (offset * 60 * 1000));
  return local.toISOString().slice(0, 16);
}

function toIsoString(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function getErrorMessage(err, fallback) {
  const details = err?.response?.data?.details;
  if (details && typeof details === 'object') {
    const firstMessage = Object.values(details).flat().find(Boolean);
    if (firstMessage) {
      return String(firstMessage);
    }
  }

  return err?.response?.data?.message || fallback;
}

function getAgentAssignedSkills(agent) {
  return Array.isArray(agent?.configJson?.assignedSkills)
    ? agent.configJson.assignedSkills
    : agent?.openclawSkill
      ? [agent.openclawSkill]
      : [];
}

function getAgentAppointmentConfig(agent) {
  return agent?.configJson?.skillConfigs?.['appointment-scheduler'] || null;
}

function agentUsesAppointmentScheduler(agent) {
  return getAgentAssignedSkills(agent).includes('appointment-scheduler');
}

function buildAppointmentForm({ appointment = null, defaultAgent = null } = {}) {
  if (appointment) {
    return {
      id: appointment.id,
      title: appointment.title || '',
      customerId: appointment.customerId || '',
      agentId: appointment.agentId || '',
      appointmentType: appointment.appointmentType || 'CONSULTATION',
      status: appointment.status || 'CONFIRMED',
      scheduledAt: toDateTimeLocal(appointment.scheduledAt),
      endAt: toDateTimeLocal(appointment.endAt),
      timezone: appointment.timezone || DEFAULT_TIMEZONE,
      locationType: appointment.locationType || 'ONLINE',
      meetingLink: appointment.meetingLink || '',
      physicalLocation: appointment.physicalLocation || '',
      description: appointment.description || '',
      notes: appointment.notes || '',
    };
  }

  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setDate(now.getDate() + 1);
  now.setHours(10, 0, 0, 0);
  const startAt = toDateTimeLocal(now);
  const endAt = toDateTimeLocal(new Date(now.getTime() + 60 * 60 * 1000));
  const defaultConfig = getAgentAppointmentConfig(defaultAgent) || {};

  return {
    id: '',
    title: '',
    customerId: '',
    agentId: defaultAgent?.id || '',
    appointmentType: 'CONSULTATION',
    status: 'CONFIRMED',
    scheduledAt: startAt,
    endAt,
    timezone: defaultConfig.timezone || DEFAULT_TIMEZONE,
    locationType: 'ONLINE',
    meetingLink: '',
    physicalLocation: '',
    description: '',
    notes: '',
  };
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

function EmptyState({ onCreate }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/70 px-6 py-12 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-sky-500/20 bg-sky-500/10">
        <CalendarClock className="h-9 w-9 text-sky-300" />
      </div>
      <h3 className="mt-6 text-xl font-semibold text-white">Belum ada appointment</h3>
      <p className="mt-2 text-sm text-slate-400">Buat appointment pertama untuk sales call, demo, consultation, atau support.</p>
      <Button className="mt-6" onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        Create Appointment
      </Button>
    </div>
  );
}

function FilterBar({ filters, agents, customers, onChange, onReset }) {
  return (
    <div className="grid gap-3 rounded-3xl border border-slate-800 bg-slate-950/70 p-4 md:grid-cols-2 xl:grid-cols-6">
      <div className="space-y-2 xl:col-span-1">
        <Label>Status</Label>
        <Select value={filters.status} onValueChange={(value) => onChange('status', value)}>
          <SelectTrigger className="border-slate-700 bg-slate-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {APPOINTMENT_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 xl:col-span-1">
        <Label>Agent</Label>
        <Select value={filters.agentId} onValueChange={(value) => onChange('agentId', value)}>
          <SelectTrigger className="border-slate-700 bg-slate-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All agents</SelectItem>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 xl:col-span-1">
        <Label>Customer</Label>
        <Select value={filters.customerId} onValueChange={(value) => onChange('customerId', value)}>
          <SelectTrigger className="border-slate-700 bg-slate-900">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All customers</SelectItem>
            {customers.map((customer) => (
              <SelectItem key={customer.id} value={customer.id}>{customer.name || customer.phoneNumber}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 xl:col-span-1">
        <Label>Start Date</Label>
        <Input
          type="date"
          className="border-slate-700 bg-slate-900"
          value={filters.startDate}
          onChange={(event) => onChange('startDate', event.target.value)}
        />
      </div>

      <div className="space-y-2 xl:col-span-1">
        <Label>End Date</Label>
        <Input
          type="date"
          className="border-slate-700 bg-slate-900"
          value={filters.endDate}
          onChange={(event) => onChange('endDate', event.target.value)}
        />
      </div>

      <div className="flex items-end xl:col-span-1">
        <Button variant="outline" className="w-full" onClick={onReset}>
          Reset Filters
        </Button>
      </div>
    </div>
  );
}

function AppointmentTable({ appointments, onView, onEdit, onReschedule, onCancel, onComplete }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-800 bg-slate-950/60">
      <table className="min-w-full text-left text-sm text-slate-200">
        <thead className="bg-slate-900/80 text-xs uppercase tracking-[0.18em] text-slate-400">
          <tr>
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Customer</th>
            <th className="px-4 py-3 font-medium">Agent</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Scheduled Date</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Location</th>
            <th className="px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((appointment) => (
            <tr key={appointment.id} className="border-t border-slate-800 align-top">
              <td className="px-4 py-4">
                <div>
                  <p className="font-medium text-white">{appointment.title}</p>
                  <p className="mt-1 text-xs text-slate-500">{appointment.description || 'Tanpa deskripsi tambahan'}</p>
                </div>
              </td>
              <td className="px-4 py-4">{appointment.customer?.name || appointment.customer?.phoneNumber || '-'}</td>
              <td className="px-4 py-4">{appointment.agent?.name || '-'}</td>
              <td className="px-4 py-4">{getAppointmentTypeLabel(appointment.appointmentType)}</td>
              <td className="px-4 py-4">{formatAppointmentDate(appointment.scheduledAt, appointment.timezone)}</td>
              <td className="px-4 py-4">
                <Badge variant={getAppointmentStatusTone(appointment.status)}>
                  {getAppointmentStatusLabel(appointment.status)}
                </Badge>
              </td>
              <td className="px-4 py-4">{getAppointmentLocationLabel(appointment.locationType)}</td>
              <td className="px-4 py-4">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => onView(appointment)}>
                    <Eye className="mr-2 h-3.5 w-3.5" />
                    View Detail
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onEdit(appointment)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onReschedule(appointment)}>
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    Reschedule
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onCancel(appointment)}>
                    <XCircle className="mr-2 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onComplete(appointment)}>
                    <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                    Mark Completed
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AppointmentFormDialog({ open, mode, form, agents, customers, saving, error, onChange, onSubmit, onOpenChange }) {
  const dialogTitle = mode === 'create'
    ? 'Create Appointment'
    : mode === 'reschedule'
      ? 'Reschedule Appointment'
      : 'Edit Appointment';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription className="text-slate-400">
            Kelola judul, agent, customer, jadwal, location, dan catatan appointment dari satu modal.
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
              <Label>Title</Label>
              <Input className="border-slate-700 bg-slate-900" value={form.title} onChange={(event) => onChange('title', event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Appointment Type</Label>
              <Select value={form.appointmentType} onValueChange={(value) => onChange('appointmentType', value)}>
                <SelectTrigger className="border-slate-700 bg-slate-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPOINTMENT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Customer</Label>
              <Select value={form.customerId} onValueChange={(value) => onChange('customerId', value)}>
                <SelectTrigger className="border-slate-700 bg-slate-900">
                  <SelectValue placeholder="Pilih customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>{customer.name || customer.phoneNumber}</SelectItem>
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
                    <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Scheduled At</Label>
              <Input type="datetime-local" className="border-slate-700 bg-slate-900" value={form.scheduledAt} onChange={(event) => onChange('scheduledAt', event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End At</Label>
              <Input type="datetime-local" className="border-slate-700 bg-slate-900" value={form.endAt} onChange={(event) => onChange('endAt', event.target.value)} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => onChange('status', value)}>
                <SelectTrigger className="border-slate-700 bg-slate-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPOINTMENT_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location Type</Label>
              <Select value={form.locationType} onValueChange={(value) => onChange('locationType', value)}>
                <SelectTrigger className="border-slate-700 bg-slate-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPOINTMENT_LOCATION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Input className="border-slate-700 bg-slate-900" value={form.timezone} onChange={(event) => onChange('timezone', event.target.value)} />
            </div>
          </div>

          {form.locationType === 'ONLINE' && (
            <div className="space-y-2">
              <Label>Meeting Link</Label>
              <Input className="border-slate-700 bg-slate-900" value={form.meetingLink} onChange={(event) => onChange('meetingLink', event.target.value)} placeholder="https://meet.google.com/..." />
            </div>
          )}

          {form.locationType === 'OFFLINE' && (
            <div className="space-y-2">
              <Label>Physical Location</Label>
              <Input className="border-slate-700 bg-slate-900" value={form.physicalLocation} onChange={(event) => onChange('physicalLocation', event.target.value)} placeholder="Kantor pusat / alamat meeting" />
            </div>
          )}

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea className="min-h-[90px] border-slate-700 bg-slate-900" value={form.description} onChange={(event) => onChange('description', event.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea className="min-h-[110px] border-slate-700 bg-slate-900" value={form.notes} onChange={(event) => onChange('notes', event.target.value)} placeholder="Catatan internal, kebutuhan reschedule, atau detail follow-up" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Batal</Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'create' ? 'Simpan Appointment' : mode === 'reschedule' ? 'Simpan Reschedule' : 'Update Appointment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppointmentDetailDialog({ open, loading, error, detail, onOpenChange, onEdit, onReschedule, onCancel, onComplete }) {
  const appointment = detail?.appointment;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Appointment Detail</DialogTitle>
          <DialogDescription className="text-slate-400">
            Lihat jadwal, lokasi, customer, agent, dan activity log appointment ini.
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
        ) : appointment ? (
          <div className="space-y-5 py-2">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div>
                <p className="text-lg font-semibold text-white">{appointment.title}</p>
                <p className="mt-2 text-sm text-slate-400">{appointment.description || 'Tanpa deskripsi tambahan.'}</p>
              </div>
              <Badge variant={getAppointmentStatusTone(appointment.status)}>
                {getAppointmentStatusLabel(appointment.status)}
              </Badge>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white"><UserRound className="h-4 w-4 text-sky-300" /> Customer</div>
                <p className="mt-3 text-sm text-slate-200">{appointment.customer?.name || appointment.customer?.phoneNumber || '-'}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white"><Users className="h-4 w-4 text-sky-300" /> Agent</div>
                <p className="mt-3 text-sm text-slate-200">{appointment.agent?.name || '-'}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-white"><MapPin className="h-4 w-4 text-sky-300" /> Location</div>
                <p className="mt-3 text-sm text-slate-200">{getAppointmentLocationLabel(appointment.locationType)}</p>
                {appointment.meetingLink && <p className="mt-2 text-xs text-slate-400 break-all">{appointment.meetingLink}</p>}
                {appointment.physicalLocation && <p className="mt-2 text-xs text-slate-400">{appointment.physicalLocation}</p>}
              </div>
            </div>

            <dl className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 md:grid-cols-2">
              <div>
                <dt className="text-slate-500">Appointment Type</dt>
                <dd className="mt-1 text-sm text-slate-200">{getAppointmentTypeLabel(appointment.appointmentType)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Scheduled At</dt>
                <dd className="mt-1 text-sm text-slate-200">{formatAppointmentDate(appointment.scheduledAt, appointment.timezone)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">End At</dt>
                <dd className="mt-1 text-sm text-slate-200">{formatAppointmentDate(appointment.endAt, appointment.timezone)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Timezone</dt>
                <dd className="mt-1 text-sm text-slate-200">{appointment.timezone}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Notes</dt>
                <dd className="mt-1 text-sm text-slate-200">{appointment.notes || '-'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Reminder Flags</dt>
                <dd className="mt-1 text-sm text-slate-200">24h: {appointment.reminder24hSent ? 'Sent' : 'Pending'} · 1h: {appointment.reminder1hSent ? 'Sent' : 'Pending'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Missed Follow-up</dt>
                <dd className="mt-1 text-sm text-slate-200">
                  {appointment.status === 'MISSED'
                    ? (appointment.missedFollowUpSent ? 'Sent' : 'Pending')
                    : '-'}
                </dd>
                {appointment.missedFollowUpSentAt && (
                  <p className="mt-1 text-xs text-slate-400">
                    Sent at {formatAppointmentDate(appointment.missedFollowUpSentAt, appointment.timezone)}
                  </p>
                )}
              </div>
            </dl>

            <div className="space-y-3">
              <p className="text-sm font-medium text-white">Activity Logs</p>
              {appointment.activityLogs?.length > 0 ? (
                <div className="space-y-2">
                  {appointment.activityLogs.map((log) => (
                    <div key={log.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-white">{log.actionType}</p>
                        <p className="text-xs text-slate-500">{formatAppointmentDate(log.createdAt, appointment.timezone)}</p>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">By: {log.actionBy}</p>
                      {(log.previousStatus || log.newStatus) && (
                        <p className="mt-2 text-xs text-slate-400">Status: {log.previousStatus || '-'} {'→'} {log.newStatus || '-'}</p>
                      )}
                      {log.notes && <p className="mt-2 text-xs text-slate-300">{log.notes}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/80 p-4 text-sm text-slate-400">
                  Belum ada activity log untuk appointment ini.
                </div>
              )}
            </div>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          {appointment && (
            <>
              <Button variant="outline" onClick={() => onEdit(appointment)}>Edit</Button>
              <Button variant="outline" onClick={() => onReschedule(appointment)}>Reschedule</Button>
              <Button variant="outline" onClick={() => onCancel(appointment)}>Cancel</Button>
              <Button variant="outline" onClick={() => onComplete(appointment)}>Mark Completed</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({ open, title, description, saving, error, confirmLabel, onOpenChange, onConfirm }) {
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
          <Button variant="destructive" onClick={onConfirm} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AppointmentSchedulerPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [stats, setStats] = useState({ total: 0, today: 0, upcoming: 0, cancelled: 0, missed: 0 });
  const [agents, setAgents] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [filters, setFilters] = useState({
    status: 'ALL',
    agentId: 'ALL',
    customerId: 'ALL',
    startDate: '',
    endDate: '',
  });
  const [formDialog, setFormDialog] = useState({ open: false, mode: 'create', saving: false, error: '' });
  const [form, setForm] = useState(buildAppointmentForm());
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, action: '', appointment: null, saving: false, error: '' });

  const appointmentAgents = useMemo(
    () => agents.filter((agent) => agentUsesAppointmentScheduler(agent) && agent.status === 'ACTIVE'),
    [agents],
  );

  async function loadAppointments(nextWorkspaceId, options = {}) {
    const { silent = false } = options;

    if (!silent) {
      setRefreshing(true);
    }

    try {
      const params = {
        workspaceId: nextWorkspaceId,
        ...(filters.status !== 'ALL' ? { status: filters.status } : {}),
        ...(filters.agentId !== 'ALL' ? { agentId: filters.agentId } : {}),
        ...(filters.customerId !== 'ALL' ? { customerId: filters.customerId } : {}),
        ...(filters.startDate ? { startDate: `${filters.startDate}T00:00:00.000Z` } : {}),
        ...(filters.endDate ? { endDate: `${filters.endDate}T23:59:59.999Z` } : {}),
      };

      const { data } = await api.get('/appointments', { params });
      setAppointments(Array.isArray(data.appointments) ? data.appointments : []);
      setStats(data.stats || { total: 0, today: 0, upcoming: 0, cancelled: 0, missed: 0 });
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Gagal memuat daftar appointment'));
      setAppointments([]);
    } finally {
      setRefreshing(false);
    }
  }

  async function bootstrap() {
    try {
      const { data: me } = await api.get('/auth/me');
      const nextWorkspaceId = me.workspace?.id || '';
      setWorkspaceId(nextWorkspaceId);

      const [appointmentsPayload, agentsPayload, customersPayload] = await Promise.all([
        api.get('/appointments', { params: { workspaceId: nextWorkspaceId } }),
        api.get('/agents', { params: { workspaceId: nextWorkspaceId } }),
        api.get('/customers', { params: { workspaceId: nextWorkspaceId, status: 'ALL', limit: 100 } }),
      ]);

      setAppointments(Array.isArray(appointmentsPayload.data.appointments) ? appointmentsPayload.data.appointments : []);
      setStats(appointmentsPayload.data.stats || { total: 0, today: 0, upcoming: 0, cancelled: 0, missed: 0 });
      setAgents(Array.isArray(agentsPayload.data.agents) ? agentsPayload.data.agents : []);
      setCustomers(Array.isArray(customersPayload.data.customers) ? customersPayload.data.customers : []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'Gagal memuat dashboard Appointment Scheduler'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    bootstrap();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!workspaceId || loading) return;
    loadAppointments(workspaceId, { silent: true });
  }, [filters, workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDetail(appointmentId) {
    setDetailLoading(true);
    setDetailError('');
    setDetailDialogOpen(true);
    try {
      const { data } = await api.get(`/appointments/${appointmentId}`, { params: { workspaceId } });
      setDetail({ appointment: data.appointment });
    } catch (err) {
      setDetail(null);
      setDetailError(getErrorMessage(err, 'Gagal memuat detail appointment'));
    } finally {
      setDetailLoading(false);
    }
  }

  function openCreateDialog() {
    setForm(buildAppointmentForm({ defaultAgent: appointmentAgents[0] || null }));
    setFormDialog({ open: true, mode: 'create', saving: false, error: '' });
  }

  function openEditDialog(appointment) {
    setForm(buildAppointmentForm({ appointment }));
    setFormDialog({ open: true, mode: 'edit', saving: false, error: '' });
  }

  function openRescheduleDialog(appointment) {
    setForm(buildAppointmentForm({ appointment }));
    setFormDialog({ open: true, mode: 'reschedule', saving: false, error: '' });
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitForm() {
    if (!workspaceId) {
      setFormDialog((current) => ({ ...current, error: 'Workspace belum siap.' }));
      return;
    }

    if (!form.title || !form.agentId || !form.customerId || !form.scheduledAt) {
      setFormDialog((current) => ({ ...current, error: 'Title, agent, customer, dan scheduledAt wajib diisi.' }));
      return;
    }

    setFormDialog((current) => ({ ...current, saving: true, error: '' }));

    const payload = {
      workspaceId,
      title: form.title,
      agentId: form.agentId,
      customerId: form.customerId,
      appointmentType: form.appointmentType,
      status: form.status,
      scheduledAt: toIsoString(form.scheduledAt),
      endAt: form.endAt ? toIsoString(form.endAt) : undefined,
      timezone: form.timezone || DEFAULT_TIMEZONE,
      locationType: form.locationType,
      meetingLink: form.meetingLink || undefined,
      physicalLocation: form.physicalLocation || undefined,
      description: form.description || undefined,
      notes: form.notes || undefined,
    };

    try {
      if (formDialog.mode === 'create') {
        await api.post('/appointments', payload);
      } else if (formDialog.mode === 'reschedule') {
        await api.post(`/appointments/${form.id}/reschedule`, {
          workspaceId,
          scheduledAt: payload.scheduledAt,
          endAt: payload.endAt,
          notes: payload.notes,
        });
      } else {
        await api.put(`/appointments/${form.id}`, payload);
      }

      setFormDialog({ open: false, mode: 'create', saving: false, error: '' });
      await loadAppointments(workspaceId, { silent: true });
      if (detail?.appointment?.id === form.id) {
        await loadDetail(form.id);
      }
    } catch (err) {
      setFormDialog((current) => ({
        ...current,
        saving: false,
        error: getErrorMessage(err, formDialog.mode === 'create' ? 'Gagal membuat appointment' : 'Gagal menyimpan appointment'),
      }));
      return;
    }

    setFormDialog({ open: false, mode: 'create', saving: false, error: '' });
  }

  function openCancelDialog(appointment) {
    setConfirmDialog({ open: true, action: 'cancel', appointment, saving: false, error: '' });
  }

  function openCompleteDialog(appointment) {
    setConfirmDialog({ open: true, action: 'complete', appointment, saving: false, error: '' });
  }

  async function submitConfirm() {
    if (!confirmDialog.appointment?.id) return;

    setConfirmDialog((current) => ({ ...current, saving: true, error: '' }));

    try {
      if (confirmDialog.action === 'cancel') {
        await api.post(`/appointments/${confirmDialog.appointment.id}/cancel`, { workspaceId });
      } else {
        await api.post(`/appointments/${confirmDialog.appointment.id}/complete`, { workspaceId });
      }

      const targetId = confirmDialog.appointment.id;
      setConfirmDialog({ open: false, action: '', appointment: null, saving: false, error: '' });
      await loadAppointments(workspaceId, { silent: true });
      if (detail?.appointment?.id === targetId) {
        await loadDetail(targetId);
      }
    } catch (err) {
      setConfirmDialog((current) => ({
        ...current,
        saving: false,
        error: getErrorMessage(err, current.action === 'cancel' ? 'Gagal membatalkan appointment' : 'Gagal menandai appointment selesai'),
      }));
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
      <div className="flex flex-col gap-4 rounded-[28px] border border-slate-800 bg-slate-950 p-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-3xl space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-100">
            <CalendarClock className="h-3.5 w-3.5" />
            Appointment operations
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white md:text-3xl">Appointment Scheduler</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              Kelola booking, reminder, reschedule, cancellation handling, dan appointment tracking dari satu dashboard internal.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => loadAppointments(workspaceId)} disabled={refreshing}>
            {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Create Appointment
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Total Appointments" value={stats.total} hint="Semua appointment di workspace ini" />
        <StatCard title="Today Appointments" value={stats.today} hint="Agenda yang jatuh di hari ini" />
        <StatCard title="Upcoming Appointments" value={stats.upcoming} hint="Jadwal mendatang yang masih aktif" />
        <StatCard title="Cancelled Appointments" value={stats.cancelled} hint="Booking yang sudah dibatalkan" />
        <StatCard title="Missed Appointments" value={stats.missed} hint="Agenda lewat waktu yang tidak selesai" />
      </div>

      <FilterBar
        filters={filters}
        agents={appointmentAgents}
        customers={customers}
        onChange={(field, value) => setFilters((current) => ({ ...current, [field]: value }))}
        onReset={() => setFilters({ status: 'ALL', agentId: 'ALL', customerId: 'ALL', startDate: '', endDate: '' })}
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {appointments.length === 0 ? (
        <EmptyState onCreate={openCreateDialog} />
      ) : (
        <AppointmentTable
          appointments={appointments}
          onView={(appointment) => loadDetail(appointment.id)}
          onEdit={openEditDialog}
          onReschedule={openRescheduleDialog}
          onCancel={openCancelDialog}
          onComplete={openCompleteDialog}
        />
      )}

      <AppointmentFormDialog
        open={formDialog.open}
        mode={formDialog.mode}
        form={form}
        agents={appointmentAgents}
        customers={customers}
        saving={formDialog.saving}
        error={formDialog.error}
        onChange={updateForm}
        onSubmit={submitForm}
        onOpenChange={(open) => setFormDialog((current) => ({ ...current, open, error: open ? current.error : '' }))}
      />

      <AppointmentDetailDialog
        open={detailDialogOpen}
        loading={detailLoading}
        error={detailError}
        detail={detail}
        onOpenChange={setDetailDialogOpen}
        onEdit={openEditDialog}
        onReschedule={openRescheduleDialog}
        onCancel={openCancelDialog}
        onComplete={openCompleteDialog}
      />

      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.action === 'cancel' ? 'Cancel Appointment' : 'Mark Appointment Completed'}
        description={confirmDialog.action === 'cancel'
          ? 'Status appointment akan diubah menjadi CANCELLED dan tidak lagi masuk reminder aktif.'
          : 'Status appointment akan diubah menjadi COMPLETED dan completion timestamp akan tersimpan.'}
        saving={confirmDialog.saving}
        error={confirmDialog.error}
        confirmLabel={confirmDialog.action === 'cancel' ? 'Cancel Appointment' : 'Mark Completed'}
        onOpenChange={(open) => setConfirmDialog((current) => ({ ...current, open, error: open ? current.error : '' }))}
        onConfirm={submitConfirm}
      />
    </div>
  );
}
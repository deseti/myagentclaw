export const CRM_PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

const ACTIVITY_LABELS = {
  CREATED: 'Created',
  STAGE_CHANGED: 'Stage Changed',
  NOTE_ADDED: 'Note Added',
  APPOINTMENT_CREATED: 'Appointment Created',
  APPOINTMENT_COMPLETED: 'Appointment Completed',
  PAYMENT_SENT: 'Payment Sent',
  PAYMENT_COMPLETED: 'Payment Completed',
  LOST: 'Lost',
  WON: 'Won',
  ASSIGNED_AGENT_CHANGED: 'Assigned Agent Changed',
  LEAD_ARCHIVED: 'Lead Archived',
  LEAD_RESTORED: 'Lead Restored',
  LEAD_DELETED: 'Lead Deleted',
};

export function formatCrmCurrency(value, currency = 'IDR') {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return '-';
  }

  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: String(currency || 'IDR').toUpperCase(),
      maximumFractionDigits: 0,
    }).format(numericValue);
  } catch {
    return `${String(currency || 'IDR').toUpperCase()} ${numericValue.toLocaleString('id-ID')}`;
  }
}

export function formatCrmDate(value, options = {}) {
  if (!value) return '-';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: options.dateStyle || 'medium',
      ...(options.includeTime ? { timeStyle: options.timeStyle || 'short' } : {}),
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function formatCrmRelativeTime(value) {
  if (!value) return 'Belum ada aktivitas';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Belum ada aktivitas';
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60_000);
  const diffHours = Math.round(diffMs / 3_600_000);
  const diffDays = Math.round(diffMs / 86_400_000);

  if (diffMinutes < 60) {
    return `${Math.max(diffMinutes, 0)} menit lalu`;
  }

  if (diffHours < 24) {
    return `${diffHours} jam lalu`;
  }

  return `${diffDays} hari lalu`;
}

export function getCrmPriorityTone(priority) {
  const normalizedPriority = String(priority || 'MEDIUM').trim().toUpperCase();
  if (normalizedPriority === 'URGENT') return 'destructive';
  if (normalizedPriority === 'HIGH') return 'warning';
  if (normalizedPriority === 'LOW') return 'outline';
  return 'default';
}

export function getCrmActivityLabel(type) {
  return ACTIVITY_LABELS[String(type || '').trim().toUpperCase()] || 'Activity';
}

export function getCrmStageAccent(stage) {
  return stage?.color || '#2563eb';
}
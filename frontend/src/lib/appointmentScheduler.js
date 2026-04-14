export const APPOINTMENT_STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'RESCHEDULED', label: 'Rescheduled' },
  { value: 'MISSED', label: 'Missed' },
];

export const APPOINTMENT_TYPE_OPTIONS = [
  { value: 'SALES_CALL', label: 'Sales Call' },
  { value: 'DEMO', label: 'Demo' },
  { value: 'CONSULTATION', label: 'Consultation' },
  { value: 'SUPPORT', label: 'Support' },
  { value: 'FOLLOW_UP', label: 'Follow Up' },
  { value: 'CUSTOM', label: 'Custom' },
];

export const APPOINTMENT_LOCATION_OPTIONS = [
  { value: 'ONLINE', label: 'Online' },
  { value: 'OFFLINE', label: 'Offline' },
  { value: 'PHONE_CALL', label: 'Phone Call' },
];

function parseAppointmentDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getAppointmentStatusLabel(value) {
  return APPOINTMENT_STATUS_OPTIONS.find((item) => item.value === value)?.label || value || '-';
}

export function getAppointmentTypeLabel(value) {
  return APPOINTMENT_TYPE_OPTIONS.find((item) => item.value === value)?.label || value || '-';
}

export function getAppointmentLocationLabel(value) {
  return APPOINTMENT_LOCATION_OPTIONS.find((item) => item.value === value)?.label || value || '-';
}

export function getAppointmentStatusTone(value) {
  switch (String(value || '').toUpperCase()) {
    case 'CONFIRMED':
      return 'default';
    case 'COMPLETED':
      return 'success';
    case 'CANCELLED':
      return 'secondary';
    case 'MISSED':
      return 'destructive';
    case 'RESCHEDULED':
      return 'warning';
    case 'PENDING':
    default:
      return 'outline';
  }
}

export function formatAppointmentDate(value, timezone = 'Asia/Jakarta') {
  const date = parseAppointmentDate(value);
  if (!date) return '-';

  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || 'Asia/Jakarta',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
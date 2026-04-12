export const PAYMENT_REMINDER_TYPE_OPTIONS = [
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'DP', label: 'DP' },
  { value: 'INSTALLMENT', label: 'Installment' },
  { value: 'SUBSCRIPTION', label: 'Subscription' },
];

export const PAYMENT_REMINDER_STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'SENT', label: 'Sent' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const DEFAULT_PAYMENT_REMINDER_TEMPLATES = [
  {
    type: 'INVOICE',
    title: 'Invoice Reminder',
    preview: 'Halo {customerName}, ini pengingat invoice sebesar {amount} yang jatuh tempo pada {dueDate}.',
    status: 'active',
  },
  {
    type: 'DP',
    title: 'DP Reminder',
    preview: 'Halo {customerName}, ini pengingat pembayaran DP sebesar {amount}.',
    status: 'active',
  },
  {
    type: 'INSTALLMENT',
    title: 'Installment Reminder',
    preview: 'Halo {customerName}, ini pengingat cicilan sebesar {amount} yang jatuh tempo pada {dueDate}.',
    status: 'active',
  },
  {
    type: 'SUBSCRIPTION',
    title: 'Subscription Reminder',
    preview: 'Halo {customerName}, subscription Anda akan jatuh tempo pada {dueDate}.',
    status: 'active',
  },
];

export function getPaymentReminderTypeLabel(value) {
  return PAYMENT_REMINDER_TYPE_OPTIONS.find((item) => item.value === value)?.label || value || '-';
}

export function getPaymentReminderStatusLabel(value) {
  return PAYMENT_REMINDER_STATUS_OPTIONS.find((item) => item.value === value)?.label || value || '-';
}

export function getPaymentReminderStatusTone(value) {
  switch (String(value || '').toUpperCase()) {
    case 'SENT':
      return 'success';
    case 'FAILED':
      return 'destructive';
    case 'SCHEDULED':
      return 'default';
    case 'CANCELLED':
      return 'secondary';
    case 'PENDING':
    default:
      return 'warning';
  }
}

export function formatPaymentReminderAmount(amount, currency = 'IDR') {
  if (amount === undefined || amount === null || amount === '') {
    return '-';
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return '-';
  }

  try {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: String(currency || 'IDR').toUpperCase(),
      maximumFractionDigits: 0,
    }).format(numericAmount);
  } catch {
    return `${String(currency || 'IDR').toUpperCase()} ${numericAmount.toLocaleString('id-ID')}`;
  }
}

export function formatPaymentReminderDate(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
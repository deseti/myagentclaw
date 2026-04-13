export const PAYMENT_REMINDER_SKILL_KEY = 'payment-reminder';

export const PAYMENT_REMINDER_TYPES = ['INVOICE', 'DP', 'INSTALLMENT', 'SUBSCRIPTION'];
export const PAYMENT_REMINDER_STATUSES = ['PENDING', 'SCHEDULED', 'SENT', 'FAILED', 'CANCELLED'];
export const PAYMENT_REMINDER_EVENT_MAP = Object.freeze({
  created: 'payment-reminder.created',
  updated: 'payment-reminder.updated',
  cancelled: 'payment-reminder.cancelled',
  deleted: 'payment-reminder.deleted',
  sent: 'payment-reminder.sent',
  failed: 'payment-reminder.failed',
});

export function getPaymentReminderEventName(action = 'updated') {
  const normalizedAction = String(action || 'updated').trim().toLowerCase();
  return PAYMENT_REMINDER_EVENT_MAP[normalizedAction] || PAYMENT_REMINDER_EVENT_MAP.updated;
}

export function buildPaymentReminderRealtimePayload(action, reminder, extra = {}) {
  return {
    action,
    workspaceId: reminder?.workspaceId || extra.workspaceId || null,
    reminder: serializePaymentReminder(reminder),
    ...extra,
  };
}

const TEMPLATE_MAP = {
  INVOICE: {
    type: 'INVOICE',
    title: 'Invoice Reminder',
    preview: 'Halo {customerName}, ini pengingat invoice sebesar {amount} yang jatuh tempo pada {dueDate}.',
  },
  DP: {
    type: 'DP',
    title: 'DP Reminder',
    preview: 'Halo {customerName}, ini pengingat pembayaran DP sebesar {amount}.',
  },
  INSTALLMENT: {
    type: 'INSTALLMENT',
    title: 'Installment Reminder',
    preview: 'Halo {customerName}, ini pengingat cicilan sebesar {amount} yang jatuh tempo pada {dueDate}.',
  },
  SUBSCRIPTION: {
    type: 'SUBSCRIPTION',
    title: 'Subscription Reminder',
    preview: 'Halo {customerName}, subscription Anda akan jatuh tempo pada {dueDate}.',
  },
};

function normalizeReminderType(type) {
  const normalized = String(type || '').trim().toUpperCase();
  return PAYMENT_REMINDER_TYPES.includes(normalized) ? normalized : 'INVOICE';
}

function safeCustomerName(value) {
  const normalized = String(value || '').trim();
  return normalized || 'Pelanggan';
}

export function getPaymentReminderTemplate(type) {
  return TEMPLATE_MAP[normalizeReminderType(type)];
}

export const DEFAULT_PAYMENT_REMINDER_TEMPLATES = PAYMENT_REMINDER_TYPES.map((type) => ({
  ...getPaymentReminderTemplate(type),
  status: 'active',
}));

export function getPaymentReminderTitle(type) {
  return getPaymentReminderTemplate(type).title;
}

export function formatPaymentReminderCurrency(amount, currency = 'IDR') {
  if (amount === undefined || amount === null || amount === '') {
    return currency === 'IDR' ? 'nominal yang tertera' : `nominal ${currency}`;
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return currency === 'IDR' ? 'nominal yang tertera' : `nominal ${currency}`;
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
  if (!value) return 'tanggal yang dijadwalkan';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'tanggal yang dijadwalkan';
  }

  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function buildPaymentReminderMessage({
  type,
  templateType,
  customerName,
  amount,
  currency = 'IDR',
  dueDate,
} = {}) {
  const template = getPaymentReminderTemplate(templateType || type);

  return template.preview
    .replaceAll('{customerName}', safeCustomerName(customerName))
    .replaceAll('{amount}', formatPaymentReminderCurrency(amount, currency))
    .replaceAll('{dueDate}', formatPaymentReminderDate(dueDate));
}

export function buildPaymentReminderStats(reminders = []) {
  const stats = {
    total: reminders.length,
    pending: 0,
    scheduled: 0,
    sent: 0,
    failed: 0,
  };

  for (const reminder of reminders) {
    const status = String(reminder?.status || '').toUpperCase();
    if (status === 'PENDING') stats.pending += 1;
    if (status === 'SCHEDULED') stats.scheduled += 1;
    if (status === 'SENT') stats.sent += 1;
    if (status === 'FAILED') stats.failed += 1;
  }

  return stats;
}

export function serializePaymentReminder(reminder) {
  if (!reminder) return null;

  return {
    id: reminder.id,
    workspaceId: reminder.workspaceId,
    customerId: reminder.customerId,
    agentId: reminder.agentId,
    conversationId: reminder.conversationId || null,
    type: reminder.type,
    title: reminder.title,
    description: reminder.description || null,
    amount: reminder.amount === null || reminder.amount === undefined ? null : Number(reminder.amount),
    currency: reminder.currency || 'IDR',
    dueDate: reminder.dueDate,
    scheduledAt: reminder.scheduledAt,
    sentAt: reminder.sentAt || null,
    failedAt: reminder.failedAt || null,
    status: reminder.status,
    templateType: reminder.templateType || null,
    messageContent: reminder.messageContent,
    lastError: reminder.lastError || null,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
    customer: reminder.customer
      ? {
        id: reminder.customer.id,
        name: reminder.customer.name || null,
        phoneNumber: reminder.customer.phoneNumber,
        isBlocked: Boolean(reminder.customer.isBlocked),
        isArchived: Boolean(reminder.customer.isArchived),
      }
      : null,
    agent: reminder.agent
      ? {
        id: reminder.agent.id,
        name: reminder.agent.name,
        status: reminder.agent.status,
      }
      : null,
    conversation: reminder.conversation
      ? {
        id: reminder.conversation.id,
        status: reminder.conversation.status,
        channelType: reminder.conversation.channelType,
      }
      : null,
  };
}
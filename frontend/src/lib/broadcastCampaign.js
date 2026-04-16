export const BROADCAST_CAMPAIGN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

export const BROADCAST_RECIPIENT_STATUSES = [
  'PENDING',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'SKIPPED',
];

export const BROADCAST_FILTER_TYPES = [
  { value: 'CRM_STAGE', label: 'CRM Stage', description: 'Target customer berdasarkan stage CRM Pipeline.' },
  { value: 'CUSTOMER_TAG', label: 'Customer Tag', description: 'Gunakan tag customer yang tersimpan di workspace.' },
  { value: 'CUSTOMER_STATUS', label: 'Customer Status', description: 'Filter customer active, pending, blocked, atau archived.' },
  { value: 'ASSIGNED_AGENT', label: 'Assigned Agent', description: 'Gunakan assignment agent dari CRM Pipeline.' },
  { value: 'CHANNEL_TYPE', label: 'Channel Type', description: 'Batasi audience ke Telegram atau WhatsApp.' },
  { value: 'APPROVAL_STATUS', label: 'Approval Status', description: 'Gunakan status approval customer untuk agent broadcast.' },
  { value: 'LAST_ACTIVITY', label: 'Last Activity', description: 'Target berdasarkan aktivitas customer terakhir.' },
  { value: 'SPECIFIC_CUSTOMER', label: 'Specific Customer', description: 'Pilih customer tertentu secara manual.' },
];

export const BROADCAST_FILTER_MODES = [
  { value: 'INCLUDE', label: 'Include' },
  { value: 'EXCLUDE', label: 'Exclude' },
];

export const BROADCAST_CUSTOMER_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'ARCHIVED', label: 'Archived' },
];

export const BROADCAST_APPROVAL_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Approved' },
  { value: 'PENDING', label: 'Pending Approval' },
  { value: 'NONE', label: 'No Approval Record' },
];

export const BROADCAST_LAST_ACTIVITY_OPERATOR_OPTIONS = [
  { value: 'WITHIN_LAST_DAYS', label: 'Within Last Days' },
  { value: 'BEFORE_DATE', label: 'Before Date' },
  { value: 'AFTER_DATE', label: 'After Date' },
  { value: 'BETWEEN_DATES', label: 'Between Dates' },
  { value: 'NO_ACTIVITY', label: 'No Activity' },
];

export const BROADCAST_TIER_LIMITS = {
  STARTER: {
    maxCampaigns: 5,
    maxAudience: 100,
    advancedAnalytics: false,
  },
  GROWTH: {
    maxCampaigns: 50,
    maxAudience: 1000,
    advancedAnalytics: false,
  },
  PRO: {
    maxCampaigns: null,
    maxAudience: null,
    advancedAnalytics: true,
  },
};

function normalizeText(value) {
  return String(value || '').trim().toUpperCase();
}

export function getBroadcastTierLimits(tier = 'STARTER') {
  const normalizedTier = normalizeText(tier);
  if (normalizedTier === 'PRO') return BROADCAST_TIER_LIMITS.PRO;
  if (normalizedTier === 'GROWTH') return BROADCAST_TIER_LIMITS.GROWTH;
  return BROADCAST_TIER_LIMITS.STARTER;
}

export function formatBroadcastCampaignStatus(status) {
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === 'DRAFT') return 'Draft';
  if (normalizedStatus === 'SCHEDULED') return 'Scheduled';
  if (normalizedStatus === 'RUNNING') return 'Running';
  if (normalizedStatus === 'COMPLETED') return 'Completed';
  if (normalizedStatus === 'FAILED') return 'Failed';
  if (normalizedStatus === 'CANCELLED') return 'Cancelled';
  return 'Draft';
}

export function formatBroadcastRecipientStatus(status) {
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === 'PENDING') return 'Pending';
  if (normalizedStatus === 'QUEUED') return 'Queued';
  if (normalizedStatus === 'SENT') return 'Sent';
  if (normalizedStatus === 'DELIVERED') return 'Delivered';
  if (normalizedStatus === 'FAILED') return 'Failed';
  if (normalizedStatus === 'SKIPPED') return 'Skipped';
  return 'Pending';
}

export function getBroadcastCampaignBadgeVariant(status) {
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === 'COMPLETED') return 'success';
  if (normalizedStatus === 'FAILED') return 'destructive';
  if (normalizedStatus === 'CANCELLED') return 'warning';
  if (normalizedStatus === 'RUNNING') return 'default';
  if (normalizedStatus === 'SCHEDULED') return 'outline';
  return 'outline';
}

export function getBroadcastRecipientBadgeVariant(status) {
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === 'DELIVERED') return 'success';
  if (normalizedStatus === 'FAILED') return 'destructive';
  if (normalizedStatus === 'SKIPPED') return 'warning';
  if (normalizedStatus === 'QUEUED') return 'default';
  return 'outline';
}

export function getBroadcastFilterDefinition(filterType) {
  return BROADCAST_FILTER_TYPES.find((filter) => filter.value === normalizeText(filterType)) || BROADCAST_FILTER_TYPES[0];
}

export function formatBroadcastPercentage(value) {
  const numericValue = Number(value || 0);
  return `${Math.round(numericValue * 10) / 10}%`;
}

export function formatBroadcastDate(value) {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
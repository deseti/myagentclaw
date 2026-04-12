const TIER_ORDER = ['FREE', 'STARTER', 'GROWTH'];

export const INTERNAL_SKILL_KEYS = {
  PAYMENT_REMINDER: 'payment-reminder',
  APPOINTMENT_SCHEDULER: 'appointment-scheduler',
  CRM_PIPELINE: 'crm-pipeline',
  BROADCAST_CAMPAIGN: 'broadcast-campaign',
  ANALYTICS_DASHBOARD: 'analytics-dashboard',
  ORDER_TRACKING: 'order-tracking',
  POLYMARKET_READ_ONLY: 'polymarket-read-only',
  POLYMARKET_GROWTH_AUTOPILOT: 'polymarket-growth-autopilot',
};

export const INTERNAL_SKILL_DEFINITIONS = [
  {
    key: INTERNAL_SKILL_KEYS.PAYMENT_REMINDER,
    displayName: 'Payment Reminder',
    minimumTier: 'STARTER',
    isComingSoon: false,
  },
  { key: INTERNAL_SKILL_KEYS.APPOINTMENT_SCHEDULER, minimumTier: 'STARTER', isComingSoon: true },
  { key: INTERNAL_SKILL_KEYS.CRM_PIPELINE, minimumTier: 'STARTER', isComingSoon: true },
  { key: INTERNAL_SKILL_KEYS.BROADCAST_CAMPAIGN, minimumTier: 'STARTER', isComingSoon: true },
  { key: INTERNAL_SKILL_KEYS.ANALYTICS_DASHBOARD, minimumTier: 'GROWTH', isComingSoon: true },
  { key: INTERNAL_SKILL_KEYS.ORDER_TRACKING, minimumTier: 'GROWTH', isComingSoon: true },
  { key: INTERNAL_SKILL_KEYS.POLYMARKET_READ_ONLY, minimumTier: 'GROWTH', isComingSoon: false },
  { key: INTERNAL_SKILL_KEYS.POLYMARKET_GROWTH_AUTOPILOT, minimumTier: 'GROWTH', isComingSoon: false },
];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeInternalSkillTier(tier) {
  const normalizedTier = String(tier || 'FREE').trim().toUpperCase();

  if (normalizedTier === 'FREE') return 'FREE';
  if (normalizedTier === 'STARTER') return 'STARTER';
  return 'GROWTH';
}

export function formatInternalSkillTierLabel(tier) {
  const normalizedTier = normalizeInternalSkillTier(tier);
  if (normalizedTier === 'FREE') return 'Free';
  if (normalizedTier === 'STARTER') return 'Starter';
  return 'Growth';
}

export function workspaceMeetsMinimumTier(workspaceTier, minimumTier) {
  const workspaceIndex = TIER_ORDER.indexOf(normalizeInternalSkillTier(workspaceTier));
  const minimumIndex = TIER_ORDER.indexOf(normalizeInternalSkillTier(minimumTier));

  return workspaceIndex >= Math.max(minimumIndex, 0);
}

export function getInternalSkillDefinition(skillKey) {
  const normalizedSkillKey = normalizeText(skillKey);
  return INTERNAL_SKILL_DEFINITIONS.find((skill) => normalizeText(skill.key) === normalizedSkillKey) || null;
}

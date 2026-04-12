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
    slug: INTERNAL_SKILL_KEYS.PAYMENT_REMINDER,
    displayName: 'Payment Reminder',
    category: 'Finance',
    minimumTier: 'STARTER',
    shortDescription: 'Automated payment reminders for invoices, DP, installments, and subscriptions.',
    fullDescription: 'Starter and Growth internal skill for managing automated payment reminders across invoices, DP, installments, and subscriptions. The Payment Reminder sidebar, Billing Assistant role, and reminder worker only become available after the skill is installed and assigned to at least one agent.',
    unlocks: [
      'Payment Reminder sidebar and dashboard page for managing billing reminders',
      'Billing Assistant advanced role preset for assigned agents',
      'Reminder queue worker for scheduled invoice, DP, installment, and subscription reminders',
    ],
    roleUnlocks: ['Billing Assistant'],
    opensSidebar: true,
    opensSidebarLabel: 'Payment Reminder',
    enablesWorker: true,
    workerName: 'reminder-queue',
    dashboardHref: '/dashboard/payment-reminder',
    isComingSoon: false,
    hideFromBelowMinimum: true,
    searchTerms: ['payment', 'billing', 'invoice', 'dp', 'installment', 'subscription', 'reminder'],
  },
  {
    key: INTERNAL_SKILL_KEYS.APPOINTMENT_SCHEDULER,
    slug: INTERNAL_SKILL_KEYS.APPOINTMENT_SCHEDULER,
    displayName: 'Appointment Scheduler',
    category: 'Scheduling',
    minimumTier: 'STARTER',
    shortDescription: 'Penjadwalan meeting internal untuk booking slot dan konfirmasi agenda.',
    fullDescription: 'Placeholder internal skill untuk booking meeting, konfirmasi jadwal, dan koordinasi agenda yang akan hadir di tier Starter.',
    unlocks: [
      'Booking slot dan konfirmasi meeting dari workspace',
      'Ringkasan agenda dan alur follow-up penjadwalan',
      'Integrasi workflow scheduler saat fitur resmi dirilis',
    ],
    roleUnlocks: [],
    opensSidebar: false,
    enablesWorker: false,
    isComingSoon: true,
    searchTerms: ['appointment', 'scheduler', 'meeting', 'calendar', 'booking'],
  },
  {
    key: INTERNAL_SKILL_KEYS.CRM_PIPELINE,
    slug: INTERNAL_SKILL_KEYS.CRM_PIPELINE,
    displayName: 'CRM Pipeline',
    category: 'Sales Ops',
    minimumTier: 'STARTER',
    shortDescription: 'Pipeline CRM internal untuk tracking lead, stage, dan handoff sales.',
    fullDescription: 'Placeholder internal skill untuk mengelola lead pipeline, scoring, dan handoff antar tim yang akan hadir sebagai skill Starter.',
    unlocks: [
      'Stage pipeline dan ringkasan lead internal',
      'Scoring dasar untuk kualifikasi prospek',
      'Handoff workflow ke tim sales saat fitur resmi dirilis',
    ],
    roleUnlocks: [],
    opensSidebar: false,
    enablesWorker: false,
    isComingSoon: true,
    searchTerms: ['crm', 'pipeline', 'lead', 'sales'],
  },
  {
    key: INTERNAL_SKILL_KEYS.BROADCAST_CAMPAIGN,
    slug: INTERNAL_SKILL_KEYS.BROADCAST_CAMPAIGN,
    displayName: 'Broadcast Campaign',
    category: 'Campaign Ops',
    minimumTier: 'STARTER',
    shortDescription: 'Kampanye broadcast internal untuk pesan massal dan segmentasi audiens.',
    fullDescription: 'Placeholder internal skill untuk broadcast campaign, segmentasi kontak, dan orkestrasi pesan massal yang akan hadir di tier Starter.',
    unlocks: [
      'Composer campaign dengan segmentasi audiens internal',
      'Ringkasan audience dan performa kirim',
      'Workflow broadcast saat fitur resmi dirilis',
    ],
    roleUnlocks: [],
    opensSidebar: false,
    enablesWorker: false,
    isComingSoon: true,
    searchTerms: ['broadcast', 'campaign', 'audience', 'messaging'],
  },
  {
    key: INTERNAL_SKILL_KEYS.ANALYTICS_DASHBOARD,
    slug: INTERNAL_SKILL_KEYS.ANALYTICS_DASHBOARD,
    displayName: 'Analytics Dashboard',
    category: 'Insights',
    minimumTier: 'GROWTH',
    shortDescription: 'Dashboard analitik internal untuk KPI, tren, dan ringkasan performa.',
    fullDescription: 'Placeholder internal skill untuk dashboard analitik, insight KPI, dan monitoring performa lintas workflow yang akan hadir di tier Growth.',
    unlocks: [
      'Dashboard KPI dan tren operasional internal',
      'Ringkasan performa harian dan anomali utama',
      'Panel analitik lanjutan saat fitur resmi dirilis',
    ],
    roleUnlocks: [],
    opensSidebar: false,
    enablesWorker: false,
    isComingSoon: true,
    searchTerms: ['analytics', 'dashboard', 'kpi', 'insight'],
  },
  {
    key: INTERNAL_SKILL_KEYS.ORDER_TRACKING,
    slug: INTERNAL_SKILL_KEYS.ORDER_TRACKING,
    displayName: 'Order Tracking',
    category: 'Commerce Ops',
    minimumTier: 'GROWTH',
    shortDescription: 'Pelacakan order internal untuk status fulfillment, shipping, dan exception.',
    fullDescription: 'Placeholder internal skill untuk order tracking, pembaruan fulfillment, dan alert exception yang akan hadir sebagai skill Growth.',
    unlocks: [
      'Status order dan milestone fulfillment internal',
      'Alert exception untuk order yang tertahan',
      'Workflow pelacakan order saat fitur resmi dirilis',
    ],
    roleUnlocks: [],
    opensSidebar: false,
    enablesWorker: false,
    isComingSoon: true,
    searchTerms: ['order', 'tracking', 'fulfillment', 'shipping'],
  },
  {
    key: INTERNAL_SKILL_KEYS.POLYMARKET_READ_ONLY,
    slug: INTERNAL_SKILL_KEYS.POLYMARKET_READ_ONLY,
    displayName: 'Polymarket Read-Only',
    category: 'Market Intelligence',
    minimumTier: 'GROWTH',
    shortDescription: 'Prediction market explorer, positions viewer, and read-only research capability for assigned agents.',
    fullDescription: 'Built-in Growth capability for exploring Polymarket markets, orderbooks, positions, and analyst workflows without live execution. The workspace sidebar and Polymarket dashboard only become visible after this skill is assigned to at least one agent.',
    unlocks: [
      'Polymarket sidebar and workspace dashboard',
      'Market explorer, positions viewer, and orderbook preview',
      'Polymarket Analyst role preset when the skill is in use',
    ],
    roleUnlocks: ['Polymarket Analyst'],
    opensSidebar: true,
    enablesWorker: false,
    dashboardHref: '/dashboard/polymarket',
    searchTerms: ['polymarket', 'prediction market', 'research', 'orderbook', 'positions', 'analyst'],
  },
  {
    key: INTERNAL_SKILL_KEYS.POLYMARKET_GROWTH_AUTOPILOT,
    slug: INTERNAL_SKILL_KEYS.POLYMARKET_GROWTH_AUTOPILOT,
    displayName: 'Polymarket Growth Autopilot',
    category: 'Automation',
    minimumTier: 'GROWTH',
    shortDescription: 'Scheduler-driven dry-run autopilot with server-side guardrails for Growth workspaces.',
    fullDescription: 'Built-in Growth capability for configuring strategy guardrails, validating dry-run payloads, and letting the server-side scheduler queue autopilot runs. The worker remains idle until the skill is assigned to at least one agent.',
    unlocks: [
      'Growth Autopilot panel inside Polymarket',
      'Scheduler-driven dry-run worker and reconciliation flow',
      'Server-side guardrails, validation, and emergency-stop controls',
    ],
    roleUnlocks: [],
    opensSidebar: false,
    enablesWorker: true,
    dependsOn: INTERNAL_SKILL_KEYS.POLYMARKET_READ_ONLY,
    dashboardHref: '/dashboard/polymarket',
    searchTerms: ['polymarket', 'autopilot', 'automation', 'scheduler', 'guardrails', 'growth'],
  },
];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTier(tier) {
  const normalizedTier = String(tier || 'FREE').trim().toUpperCase();

  if (normalizedTier === 'FREE') return 'FREE';
  if (normalizedTier === 'STARTER') return 'STARTER';
  return 'GROWTH';
}

export function formatSkillTierLabel(tier) {
  const normalizedTier = normalizeTier(tier);
  if (normalizedTier === 'FREE') return 'Free';
  if (normalizedTier === 'STARTER') return 'Starter';
  return 'Growth';
}

export function formatSkillRequirementLabel(tier) {
  const tierLabel = formatSkillTierLabel(tier);
  if (tierLabel === 'Free') return tierLabel;
  return `Requires ${tierLabel}`;
}

export function canAccessInternalSkill(workspaceTier, minimumTier) {
  const workspaceIndex = TIER_ORDER.indexOf(normalizeTier(workspaceTier));
  const minimumIndex = TIER_ORDER.indexOf(normalizeTier(minimumTier));

  return workspaceIndex >= Math.max(minimumIndex, 0);
}

export function getInternalSkillDefinition(skillKey) {
  const normalizedSkillKey = normalizeText(skillKey);
  return INTERNAL_SKILL_DEFINITIONS.find((skill) => normalizeText(skill.key) === normalizedSkillKey) || null;
}

export function matchesInternalSkillKey(skillLike, skillKey) {
  const normalizedSkillKey = normalizeText(skillKey);
  if (!normalizedSkillKey) return false;

  const candidates = [
    typeof skillLike === 'string' ? skillLike : null,
    skillLike?.key,
    skillLike?.skillKey,
    skillLike?.slug,
    skillLike?.name,
    skillLike?.displayName,
  ].map(normalizeText).filter(Boolean);

  return candidates.includes(normalizedSkillKey);
}

export function getInstalledInternalSkill(installedSkills = [], skillKey) {
  return installedSkills.find((skill) => matchesInternalSkillKey(skill, skillKey)) || null;
}

export function isInternalSkillActive(skill) {
  return Boolean(skill?.isActive || Number(skill?.assignedCount || 0) > 0);
}

export function buildInternalSkillSearchText(skill) {
  return [
    skill?.displayName,
    skill?.key,
    skill?.slug,
    skill?.category,
    skill?.minimumTier,
    skill?.opensSidebarLabel,
    skill?.workerName,
    skill?.shortDescription,
    skill?.fullDescription,
    ...(Array.isArray(skill?.searchTerms) ? skill.searchTerms : []),
    ...(Array.isArray(skill?.unlocks) ? skill.unlocks : []),
    ...(Array.isArray(skill?.roleUnlocks) ? skill.roleUnlocks : []),
  ].map(normalizeText).filter(Boolean).join(' ');
}

export function getInternalSkillState(skillKey, installedSkills = [], workspaceTier = 'FREE') {
  const definition = getInternalSkillDefinition(skillKey);
  if (!definition) return null;

  const normalizedMinimumTier = normalizeTier(definition.minimumTier);
  const isComingSoon = Boolean(definition.isComingSoon);
  const installedSkill = isComingSoon ? null : getInstalledInternalSkill(installedSkills, definition.key);
  const isLocked = !canAccessInternalSkill(workspaceTier, normalizedMinimumTier);
  const isInstalled = Boolean(installedSkill);
  const isActive = isInternalSkillActive(installedSkill);
  const isHidden = Boolean(definition.hideFromBelowMinimum && isLocked);

  return {
    ...definition,
    minimumTier: normalizedMinimumTier,
    installedSkill,
    isComingSoon,
    isLocked,
    isInstalled,
    isActive,
    assignedCount: Number(installedSkill?.assignedCount || 0),
    assignedAgents: Array.isArray(installedSkill?.assignedAgents) ? installedSkill.assignedAgents : [],
    version: installedSkill?.version || null,
    isHidden,
    status: isLocked ? 'locked' : isActive ? 'active' : isInstalled ? 'installed' : 'available',
  };
}
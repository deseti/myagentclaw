export const CRM_PIPELINE_SKILL_KEY = 'crm-pipeline';

export const CRM_PIPELINE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export const CRM_PIPELINE_ACTIVITY_TYPES = [
  'CREATED',
  'STAGE_CHANGED',
  'NOTE_ADDED',
  'APPOINTMENT_CREATED',
  'APPOINTMENT_COMPLETED',
  'PAYMENT_SENT',
  'PAYMENT_COMPLETED',
  'LOST',
  'WON',
  'ASSIGNED_AGENT_CHANGED',
];

export const DEFAULT_CRM_PIPELINE_NAME = 'Sales Pipeline';
export const DEFAULT_CRM_PIPELINE_DESCRIPTION = 'Default sales pipeline for qualifying, following up, and closing leads.';

export const DEFAULT_CRM_PIPELINE_STAGES = Object.freeze([
  {
    name: 'New Lead',
    description: 'Prospek baru yang belum dihubungi.',
    color: '#2563eb',
    position: 1,
    probabilityPercent: 10,
    isDefault: true,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    name: 'Contacted',
    description: 'Lead sudah dihubungi dan menunggu tindak lanjut berikutnya.',
    color: '#0891b2',
    position: 2,
    probabilityPercent: 25,
    isDefault: true,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    name: 'Follow Up',
    description: 'Lead sedang berada dalam proses follow-up aktif.',
    color: '#f59e0b',
    position: 3,
    probabilityPercent: 45,
    isDefault: true,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    name: 'Appointment Scheduled',
    description: 'Lead sudah memiliki appointment aktif dengan agent.',
    color: '#8b5cf6',
    position: 4,
    probabilityPercent: 60,
    isDefault: true,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    name: 'Waiting Payment',
    description: 'Lead menunggu pembayaran atau invoice diselesaikan.',
    color: '#f97316',
    position: 5,
    probabilityPercent: 80,
    isDefault: true,
    isClosedWon: false,
    isClosedLost: false,
  },
  {
    name: 'Won',
    description: 'Deal berhasil ditutup.',
    color: '#16a34a',
    position: 6,
    probabilityPercent: 100,
    isDefault: true,
    isClosedWon: true,
    isClosedLost: false,
  },
  {
    name: 'Lost',
    description: 'Lead tidak berhasil dikonversi.',
    color: '#dc2626',
    position: 7,
    probabilityPercent: 0,
    isDefault: true,
    isClosedWon: false,
    isClosedLost: true,
  },
]);

export const DEFAULT_CRM_AGENT_CONFIG = Object.freeze({
  canManagePipeline: true,
  canMoveStage: true,
  canAssignLead: true,
  canViewAnalytics: true,
});

const STAGE_NAME_ALIASES = Object.freeze({
  appointmentScheduled: ['appointment scheduled', 'appointment', 'meeting scheduled'],
  followUp: ['follow up', 'follow-up', 'followup'],
  waitingPayment: ['waiting payment', 'awaiting payment', 'payment waiting', 'payment'],
  won: ['won', 'closed won'],
  lost: ['lost', 'closed lost'],
});

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeCrmPriority(value, fallback = 'MEDIUM') {
  const normalized = String(value || '').trim().toUpperCase();
  return CRM_PIPELINE_PRIORITIES.includes(normalized) ? normalized : fallback;
}

export function normalizeCurrency(value, fallback = 'IDR') {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || fallback;
}

export function normalizeCrmAgentConfig(value = {}) {
  const raw = asPlainObject(value);

  return {
    canManagePipeline: normalizeBoolean(raw.canManagePipeline, DEFAULT_CRM_AGENT_CONFIG.canManagePipeline),
    canMoveStage: normalizeBoolean(raw.canMoveStage, DEFAULT_CRM_AGENT_CONFIG.canMoveStage),
    canAssignLead: normalizeBoolean(raw.canAssignLead, DEFAULT_CRM_AGENT_CONFIG.canAssignLead),
    canViewAnalytics: normalizeBoolean(raw.canViewAnalytics, DEFAULT_CRM_AGENT_CONFIG.canViewAnalytics),
  };
}

export function getCrmAgentConfig(agentOrConfig) {
  return normalizeCrmAgentConfig(
    agentOrConfig?.configJson?.skillConfigs?.[CRM_PIPELINE_SKILL_KEY]
      || agentOrConfig?.crmPipelineConfig
      || agentOrConfig?.crmPipeline
      || {},
  );
}

export function getDefaultCrmPipelineId(workspaceId) {
  return `crm_default_pipeline_${workspaceId}`;
}

export function getDefaultCrmStageId(workspaceId, position) {
  return `crm_default_stage_${position}_${workspaceId}`;
}

function decimalToNumber(value) {
  if (value === null || value === undefined || value === '') return null;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function isClosedWonStage(stage) {
  return Boolean(stage?.isClosedWon);
}

export function isClosedLostStage(stage) {
  return Boolean(stage?.isClosedLost);
}

export function isClosedCrmStage(stage) {
  return isClosedWonStage(stage) || isClosedLostStage(stage);
}

export function computeCrmEntryFlags(entry, now = new Date()) {
  const currentStage = entry?.stage || null;
  const lastActivityAt = entry?.lastActivityAt ? new Date(entry.lastActivityAt) : null;
  const expectedCloseDate = entry?.expectedCloseDate ? new Date(entry.expectedCloseDate) : null;
  const createdAt = entry?.createdAt ? new Date(entry.createdAt) : null;
  const referenceNow = now instanceof Date ? now : new Date(now);
  const isClosedWon = isClosedWonStage(currentStage);
  const isClosedLost = isClosedLostStage(currentStage);
  const isClosed = isClosedWon || isClosedLost;
  const isStale = !isClosed && lastActivityAt
    ? (referenceNow.getTime() - lastActivityAt.getTime()) > (7 * 24 * 60 * 60 * 1000)
    : false;
  const isOverdue = !isClosed && expectedCloseDate
    ? expectedCloseDate.getTime() < referenceNow.getTime()
    : false;
  const daysOpen = createdAt
    ? Math.max(0, Math.round((referenceNow.getTime() - createdAt.getTime()) / 86_400_000))
    : null;

  return {
    isClosedWon,
    isClosedLost,
    isClosed,
    isStale,
    isOverdue,
    daysOpen,
  };
}

export function findSemanticStage(stages = [], semanticKey) {
  if (!Array.isArray(stages) || stages.length === 0) {
    return null;
  }

  if (semanticKey === 'won') {
    return stages.find((stage) => stage.isClosedWon) || null;
  }

  if (semanticKey === 'lost') {
    return stages.find((stage) => stage.isClosedLost) || null;
  }

  const aliases = STAGE_NAME_ALIASES[semanticKey] || [];
  return stages.find((stage) => aliases.some((alias) => normalizeText(stage?.name).includes(alias))) || null;
}

export function serializeCrmPipelineStage(stage) {
  if (!stage) return null;

  return {
    id: stage.id,
    pipelineId: stage.pipelineId,
    name: stage.name,
    description: stage.description || null,
    color: stage.color || null,
    position: Number(stage.position),
    probabilityPercent: Number(stage.probabilityPercent || 0),
    isDefault: Boolean(stage.isDefault),
    isClosedWon: Boolean(stage.isClosedWon),
    isClosedLost: Boolean(stage.isClosedLost),
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
  };
}

export function serializeCrmPipeline(pipeline) {
  if (!pipeline) return null;

  return {
    id: pipeline.id,
    workspaceId: pipeline.workspaceId,
    name: pipeline.name,
    description: pipeline.description || null,
    color: pipeline.color || '#2563eb',
    isDefault: Boolean(pipeline.isDefault),
    isActive: Boolean(pipeline.isActive),
    createdAt: pipeline.createdAt,
    updatedAt: pipeline.updatedAt,
    usageCount: Number(pipeline.usageCount || pipeline._count?.entries || 0),
    stageCount: Array.isArray(pipeline.stages) ? pipeline.stages.length : Number(pipeline.stageCount || pipeline._count?.stages || 0),
    stages: Array.isArray(pipeline.stages)
      ? [...pipeline.stages].sort((left, right) => left.position - right.position).map(serializeCrmPipelineStage)
      : undefined,
  };
}

export function serializeCrmPipelineActivity(activity) {
  if (!activity) return null;

  return {
    id: activity.id,
    workspaceId: activity.workspaceId,
    customerPipelineEntryId: activity.customerPipelineEntryId,
    type: activity.type,
    previousStageId: activity.previousStageId || null,
    newStageId: activity.newStageId || null,
    note: activity.note || null,
    metadataJson: activity.metadataJson || null,
    createdByUserId: activity.createdByUserId || null,
    createdAt: activity.createdAt,
    previousStage: activity.previousStage ? serializeCrmPipelineStage(activity.previousStage) : null,
    newStage: activity.newStage ? serializeCrmPipelineStage(activity.newStage) : null,
    createdByUser: activity.createdByUser
      ? {
        id: activity.createdByUser.id,
        name: activity.createdByUser.name,
        email: activity.createdByUser.email,
      }
      : null,
  };
}

export function serializeCrmPipelineNote(note) {
  if (!note) return null;

  return {
    id: note.id,
    workspaceId: note.workspaceId,
    customerPipelineEntryId: note.customerPipelineEntryId,
    content: note.content,
    createdByUserId: note.createdByUserId || null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    createdByUser: note.createdByUser
      ? {
        id: note.createdByUser.id,
        name: note.createdByUser.name,
        email: note.createdByUser.email,
      }
      : null,
  };
}

export function serializeCrmCustomerPipelineEntry(entry, options = {}) {
  if (!entry) return null;

  const flags = computeCrmEntryFlags(entry, options.now);

  return {
    id: entry.id,
    workspaceId: entry.workspaceId,
    customerId: entry.customerId,
    pipelineId: entry.pipelineId,
    stageId: entry.stageId,
    assignedAgentId: entry.assignedAgentId || null,
    title: entry.title,
    valueAmount: decimalToNumber(entry.valueAmount),
    currency: entry.currency || 'IDR',
    priority: normalizeCrmPriority(entry.priority),
    expectedCloseDate: entry.expectedCloseDate || null,
    lastActivityAt: entry.lastActivityAt || null,
    source: entry.source || null,
    lostReason: entry.lostReason || null,
    notes: entry.notes || null,
    isArchived: Boolean(entry.isArchived),
    archivedAt: entry.archivedAt || null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    flags,
    customer: entry.customer
      ? {
        id: entry.customer.id,
        name: entry.customer.name || null,
        phoneNumber: entry.customer.phoneNumber,
        isBlocked: Boolean(entry.customer.isBlocked),
        isArchived: Boolean(entry.customer.isArchived),
      }
      : null,
    pipeline: entry.pipeline ? serializeCrmPipeline(entry.pipeline) : null,
    stage: entry.stage ? serializeCrmPipelineStage(entry.stage) : null,
    assignedAgent: entry.assignedAgent
      ? {
        id: entry.assignedAgent.id,
        name: entry.assignedAgent.name,
        status: entry.assignedAgent.status,
        capabilities: getCrmAgentConfig(entry.assignedAgent),
      }
      : null,
    notesList: Array.isArray(entry.pipelineNotes) ? entry.pipelineNotes.map(serializeCrmPipelineNote) : undefined,
    activities: Array.isArray(entry.activities) ? entry.activities.map(serializeCrmPipelineActivity) : undefined,
    noteCount: Number(entry._count?.pipelineNotes || entry.noteCount || 0),
    activityCount: Number(entry._count?.activities || entry.activityCount || 0),
  };
}
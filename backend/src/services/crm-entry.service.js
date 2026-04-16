import prisma from '../lib/prisma.js';
import {
  CRM_PIPELINE_SKILL_KEY,
  findSemanticStage,
  normalizeCrmPriority,
  serializeCrmCustomerPipelineEntry,
  serializeCrmPipelineNote,
} from '../lib/crm-pipeline.js';
import { agentHasAssignedSkill } from '../lib/skill-activation.js';
import { recordCrmActivityTx } from './crm-activity.service.js';
import {
  assertCrmPipelineAccess,
  buildCrmEntryWhere,
  ensureDefaultCrmPipelineForWorkspace,
  serviceError,
} from './crm-pipeline.service.js';

const crmEntryListInclude = {
  customer: {
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      isBlocked: true,
      isArchived: true,
    },
  },
  pipeline: {
    select: {
      id: true,
      workspaceId: true,
      name: true,
      description: true,
      isDefault: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  stage: {
    select: {
      id: true,
      pipelineId: true,
      name: true,
      description: true,
      color: true,
      position: true,
      probabilityPercent: true,
      isDefault: true,
      isClosedWon: true,
      isClosedLost: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  assignedAgent: {
    select: {
      id: true,
      name: true,
      status: true,
      configJson: true,
      openclawSkill: true,
    },
  },
  _count: {
    select: {
      activities: true,
      pipelineNotes: true,
    },
  },
};

const crmEntryDetailInclude = {
  ...crmEntryListInclude,
  activities: {
    include: {
      previousStage: true,
      newStage: true,
      createdByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  },
  pipelineNotes: {
    include: {
      createdByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  },
};

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeOptionalDate(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw serviceError(400, 'Tanggal CRM tidak valid.');
  }
  return date;
}

async function loadPipelineOrThrow(workspaceId, pipelineId) {
  const pipeline = await prisma.crmPipeline.findFirst({
    where: {
      id: pipelineId,
      workspaceId,
    },
    include: {
      stages: {
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!pipeline) {
    throw serviceError(404, 'Pipeline CRM tidak ditemukan');
  }

  return pipeline;
}

async function loadCrmEntryOrThrow({ ownerId, workspaceId, entryId, include = crmEntryDetailInclude }) {
  const entry = await prisma.crmCustomerPipelineEntry.findFirst({
    where: {
      id: entryId,
      workspaceId,
      workspace: { ownerId },
    },
    include,
  });

  if (!entry) {
    throw serviceError(404, 'Lead pipeline tidak ditemukan');
  }

  return entry;
}

async function resolveCustomerOrThrow({ ownerId, workspaceId, customerId }) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      workspaceId,
      workspace: { ownerId },
    },
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      isBlocked: true,
      isArchived: true,
    },
  });

  if (!customer) {
    throw serviceError(404, 'Customer tidak ditemukan');
  }

  return customer;
}

async function resolveAssignedAgentOrThrow({ workspaceId, assignedAgentId }) {
  if (!assignedAgentId) return null;

  const agent = await prisma.agent.findFirst({
    where: {
      id: assignedAgentId,
      workspaceId,
    },
    select: {
      id: true,
      name: true,
      status: true,
      openclawSkill: true,
      configJson: true,
    },
  });

  if (!agent) {
    throw serviceError(404, 'Agent CRM tidak ditemukan');
  }

  if (agent.status !== 'ACTIVE') {
    throw serviceError(409, 'Agent CRM harus aktif.');
  }

  if (!agentHasAssignedSkill(agent, CRM_PIPELINE_SKILL_KEY)) {
    throw serviceError(403, 'Agent yang dipilih belum memakai skill CRM Pipeline.', {
      requiredSkill: CRM_PIPELINE_SKILL_KEY,
    });
  }

  return agent;
}

async function resolvePipelineAndStage({ workspaceId, pipelineId, stageId }) {
  const pipeline = pipelineId
    ? await loadPipelineOrThrow(workspaceId, pipelineId)
    : await ensureDefaultCrmPipelineForWorkspace(workspaceId);
  const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];
  const stage = stageId
    ? stages.find((item) => item.id === stageId) || null
    : stages[0] || null;

  if (!stage) {
    throw serviceError(400, 'Stage CRM belum tersedia untuk pipeline ini.', {
      stageId: ['Stage CRM belum tersedia untuk pipeline ini.'],
    });
  }

  if (stage.pipelineId !== pipeline.id) {
    throw serviceError(400, 'Stage harus berasal dari pipeline yang sama.', {
      stageId: ['Stage harus berasal dari pipeline yang sama.'],
    });
  }

  return { pipeline, stage };
}

async function maybeRecordAssignmentActivityTx(tx, { entry, previousAgentId, nextAgentId, note, createdByUserId, metadataJson }) {
  if (previousAgentId === nextAgentId) {
    return;
  }

  await recordCrmActivityTx(tx, {
    workspaceId: entry.workspaceId,
    customerPipelineEntryId: entry.id,
    type: 'ASSIGNED_AGENT_CHANGED',
    previousStageId: entry.stageId,
    newStageId: entry.stageId,
    note,
    metadataJson: {
      previousAgentId: previousAgentId || null,
      nextAgentId: nextAgentId || null,
      ...(metadataJson || {}),
    },
    createdByUserId,
  });
}

export async function moveCrmEntryStageInternal({
  tx,
  entry,
  targetStage,
  createdByUserId = null,
  note = null,
  lostReason = null,
  activityType = null,
  metadataJson = null,
}) {
  if (entry.stageId === targetStage.id) {
    return tx.crmCustomerPipelineEntry.findUnique({
      where: { id: entry.id },
      include: crmEntryDetailInclude,
    });
  }

  const now = new Date();

  await tx.crmCustomerPipelineEntry.update({
    where: { id: entry.id },
    data: {
      stageId: targetStage.id,
      lostReason: targetStage.isClosedLost ? normalizeOptionalText(lostReason || note) || null : null,
      lastActivityAt: now,
    },
  });

  if (activityType && activityType !== 'STAGE_CHANGED') {
    await recordCrmActivityTx(tx, {
      workspaceId: entry.workspaceId,
      customerPipelineEntryId: entry.id,
      type: activityType,
      previousStageId: entry.stageId,
      newStageId: targetStage.id,
      note,
      metadataJson,
      createdByUserId,
      createdAt: now,
    });
  }

  await recordCrmActivityTx(tx, {
    workspaceId: entry.workspaceId,
    customerPipelineEntryId: entry.id,
    type: 'STAGE_CHANGED',
    previousStageId: entry.stageId,
    newStageId: targetStage.id,
    note,
    metadataJson,
    createdByUserId,
    createdAt: now,
  });

  if (targetStage.isClosedWon) {
    await recordCrmActivityTx(tx, {
      workspaceId: entry.workspaceId,
      customerPipelineEntryId: entry.id,
      type: 'WON',
      previousStageId: entry.stageId,
      newStageId: targetStage.id,
      note,
      metadataJson,
      createdByUserId,
      createdAt: now,
    });
  }

  if (targetStage.isClosedLost) {
    await recordCrmActivityTx(tx, {
      workspaceId: entry.workspaceId,
      customerPipelineEntryId: entry.id,
      type: 'LOST',
      previousStageId: entry.stageId,
      newStageId: targetStage.id,
      note: normalizeOptionalText(lostReason || note) || null,
      metadataJson,
      createdByUserId,
      createdAt: now,
    });
  }

  return tx.crmCustomerPipelineEntry.findUnique({
    where: { id: entry.id },
    include: crmEntryDetailInclude,
  });
}

async function loadEntryHistories(workspaceId, customerId) {
  const [appointments, paymentReminders] = await Promise.all([
    prisma.appointmentSchedule.findMany({
      where: {
        workspaceId,
        customerId,
      },
      orderBy: { scheduledAt: 'desc' },
      take: 20,
      select: {
        id: true,
        title: true,
        appointmentType: true,
        status: true,
        scheduledAt: true,
        endAt: true,
        createdAt: true,
        agent: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.paymentReminder.findMany({
      where: {
        workspaceId,
        customerId,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        amount: true,
        currency: true,
        dueDate: true,
        scheduledAt: true,
        sentAt: true,
        createdAt: true,
        agent: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  return {
    appointmentHistory: appointments,
    paymentReminderHistory: paymentReminders.map((reminder) => ({
      ...reminder,
      amount: reminder.amount === null || reminder.amount === undefined ? null : Number(reminder.amount),
    })),
  };
}

export async function listCrmEntries({ ownerId, workspaceId, filters = {} }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const where = buildCrmEntryWhere({
    workspaceId,
    pipelineId: filters.pipelineId,
    stageId: filters.stageId,
    assignedAgentId: filters.assignedAgentId,
    priority: filters.priority,
    source: filters.source,
    search: filters.search,
    includeArchived: Boolean(filters.includeArchived),
    dateFrom: filters.dateFrom || null,
    dateTo: filters.dateTo || null,
  });

  const entries = await prisma.crmCustomerPipelineEntry.findMany({
    where,
    orderBy: [
      { stage: { position: 'asc' } },
      { updatedAt: 'desc' },
    ],
    include: crmEntryListInclude,
  });

  return {
    entries: entries.map((entry) => serializeCrmCustomerPipelineEntry(entry)),
  };
}

export async function getCrmEntryDetail({ ownerId, workspaceId, entryId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const entry = await loadCrmEntryOrThrow({ ownerId, workspaceId, entryId, include: crmEntryDetailInclude });
  const histories = await loadEntryHistories(workspaceId, entry.customerId);

  return {
    entry: {
      ...serializeCrmCustomerPipelineEntry(entry),
      appointmentHistory: histories.appointmentHistory,
      paymentReminderHistory: histories.paymentReminderHistory,
    },
  };
}

export async function createCrmEntry({ ownerId, workspaceId, createdByUserId, payload = {} }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const customer = await resolveCustomerOrThrow({ ownerId, workspaceId, customerId: payload.customerId });
  const { pipeline, stage } = await resolvePipelineAndStage({
    workspaceId,
    pipelineId: payload.pipelineId,
    stageId: payload.stageId,
  });
  const assignedAgent = await resolveAssignedAgentOrThrow({ workspaceId, assignedAgentId: payload.assignedAgentId });
  const title = String(payload.title || customer.name || customer.phoneNumber || 'CRM Lead').trim();

  const entry = await prisma.$transaction(async (tx) => {
    const createdEntry = await tx.crmCustomerPipelineEntry.create({
      data: {
        workspaceId,
        customerId: customer.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        assignedAgentId: assignedAgent?.id || null,
        title,
        valueAmount: payload.valueAmount ?? null,
        currency: payload.currency || 'IDR',
        priority: normalizeCrmPriority(payload.priority),
        expectedCloseDate: normalizeOptionalDate(payload.expectedCloseDate),
        lastActivityAt: new Date(),
        source: normalizeOptionalText(payload.source),
        lostReason: normalizeOptionalText(payload.lostReason),
        notes: normalizeOptionalText(payload.notes),
      },
      include: crmEntryDetailInclude,
    });

    await recordCrmActivityTx(tx, {
      workspaceId,
      customerPipelineEntryId: createdEntry.id,
      type: 'CREATED',
      previousStageId: null,
      newStageId: stage.id,
      note: normalizeOptionalText(payload.notes) || null,
      metadataJson: {
        source: 'dashboard',
      },
      createdByUserId,
    });

    if (assignedAgent) {
      await maybeRecordAssignmentActivityTx(tx, {
        entry: createdEntry,
        previousAgentId: null,
        nextAgentId: assignedAgent.id,
        note: `Lead diassign ke ${assignedAgent.name}`,
        metadataJson: { source: 'dashboard' },
        createdByUserId,
      });
    }

    return tx.crmCustomerPipelineEntry.findUnique({
      where: { id: createdEntry.id },
      include: crmEntryDetailInclude,
    });
  });

  return {
    entry: serializeCrmCustomerPipelineEntry(entry),
  };
}

export async function updateCrmEntry({ ownerId, workspaceId, entryId, createdByUserId, payload = {} }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const existing = await loadCrmEntryOrThrow({ ownerId, workspaceId, entryId, include: crmEntryDetailInclude });
  const customerId = payload.customerId || existing.customerId;
  const customer = await resolveCustomerOrThrow({ ownerId, workspaceId, customerId });
  const pipelineId = payload.pipelineId || existing.pipelineId;
  const stageId = Object.prototype.hasOwnProperty.call(payload, 'stageId') ? payload.stageId : existing.stageId;
  const { pipeline, stage } = await resolvePipelineAndStage({ workspaceId, pipelineId, stageId });
  const assignedAgent = Object.prototype.hasOwnProperty.call(payload, 'assignedAgentId')
    ? await resolveAssignedAgentOrThrow({ workspaceId, assignedAgentId: payload.assignedAgentId })
    : existing.assignedAgent;
  const previousAgentId = existing.assignedAgentId || null;
  const nextAgentId = assignedAgent?.id || null;

  const updatedEntry = await prisma.$transaction(async (tx) => {
    await tx.crmCustomerPipelineEntry.update({
      where: { id: existing.id },
      data: {
        customerId: customer.id,
        pipelineId: pipeline.id,
        assignedAgentId: nextAgentId,
        title: String(payload.title || existing.title).trim() || existing.title,
        valueAmount: Object.prototype.hasOwnProperty.call(payload, 'valueAmount') ? payload.valueAmount : existing.valueAmount,
        currency: payload.currency || existing.currency,
        priority: Object.prototype.hasOwnProperty.call(payload, 'priority') ? normalizeCrmPriority(payload.priority) : existing.priority,
        expectedCloseDate: Object.prototype.hasOwnProperty.call(payload, 'expectedCloseDate')
          ? normalizeOptionalDate(payload.expectedCloseDate) || null
          : existing.expectedCloseDate,
        source: Object.prototype.hasOwnProperty.call(payload, 'source') ? normalizeOptionalText(payload.source) : existing.source,
        lostReason: Object.prototype.hasOwnProperty.call(payload, 'lostReason') ? normalizeOptionalText(payload.lostReason) : existing.lostReason,
        notes: Object.prototype.hasOwnProperty.call(payload, 'notes') ? normalizeOptionalText(payload.notes) : existing.notes,
      },
    });

    if (previousAgentId !== nextAgentId) {
      await maybeRecordAssignmentActivityTx(tx, {
        entry: existing,
        previousAgentId,
        nextAgentId,
        note: nextAgentId ? `Lead diassign ke ${assignedAgent.name}` : 'Agent lead dilepas',
        metadataJson: { source: 'dashboard' },
        createdByUserId,
      });
    }

    if (existing.stageId !== stage.id) {
      return moveCrmEntryStageInternal({
        tx,
        entry: existing,
        targetStage: stage,
        createdByUserId,
        note: normalizeOptionalText(payload.moveStageNote) || null,
        lostReason: payload.lostReason,
        metadataJson: { source: 'dashboard' },
      });
    }

    return tx.crmCustomerPipelineEntry.findUnique({
      where: { id: existing.id },
      include: crmEntryDetailInclude,
    });
  });

  return {
    entry: serializeCrmCustomerPipelineEntry(updatedEntry),
  };
}

export async function deleteCrmEntry({ ownerId, workspaceId, entryId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const entry = await loadCrmEntryOrThrow({ ownerId, workspaceId, entryId, include: crmEntryListInclude });

  await prisma.crmCustomerPipelineEntry.delete({ where: { id: entry.id } });

  return {
    deletedEntry: serializeCrmCustomerPipelineEntry(entry),
  };
}

export async function moveCrmEntryStage({ ownerId, workspaceId, entryId, createdByUserId, stageId, note, lostReason }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const existing = await loadCrmEntryOrThrow({ ownerId, workspaceId, entryId, include: crmEntryDetailInclude });
  const pipeline = await loadPipelineOrThrow(existing.workspaceId, existing.pipelineId);
  const targetStage = pipeline.stages.find((stage) => stage.id === stageId) || null;

  if (!targetStage) {
    throw serviceError(400, 'Stage harus berasal dari pipeline yang sama.', {
      stageId: ['Stage harus berasal dari pipeline yang sama.'],
    });
  }

  const updatedEntry = await prisma.$transaction((tx) => moveCrmEntryStageInternal({
    tx,
    entry: existing,
    targetStage,
    createdByUserId,
    note: normalizeOptionalText(note) || null,
    lostReason,
    metadataJson: { source: 'dashboard' },
  }));

  return {
    entry: serializeCrmCustomerPipelineEntry(updatedEntry),
  };
}

export async function assignCrmEntryAgent({ ownerId, workspaceId, entryId, createdByUserId, assignedAgentId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const existing = await loadCrmEntryOrThrow({ ownerId, workspaceId, entryId, include: crmEntryDetailInclude });
  const assignedAgent = await resolveAssignedAgentOrThrow({ workspaceId, assignedAgentId });

  const updatedEntry = await prisma.$transaction(async (tx) => {
    await tx.crmCustomerPipelineEntry.update({
      where: { id: existing.id },
      data: {
        assignedAgentId: assignedAgent?.id || null,
      },
    });

    await maybeRecordAssignmentActivityTx(tx, {
      entry: existing,
      previousAgentId: existing.assignedAgentId || null,
      nextAgentId: assignedAgent?.id || null,
      note: assignedAgent ? `Lead diassign ke ${assignedAgent.name}` : 'Agent lead dilepas',
      metadataJson: { source: 'dashboard' },
      createdByUserId,
    });

    return tx.crmCustomerPipelineEntry.findUnique({
      where: { id: existing.id },
      include: crmEntryDetailInclude,
    });
  });

  return {
    entry: serializeCrmCustomerPipelineEntry(updatedEntry),
  };
}

export async function archiveCrmEntry({ ownerId, workspaceId, entryId, createdByUserId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const existing = await loadCrmEntryOrThrow({ ownerId, workspaceId, entryId, include: crmEntryListInclude });

  if (existing.isArchived) {
    throw serviceError(409, 'Lead sudah diarsipkan sebelumnya.');
  }

  const updatedEntry = await prisma.$transaction(async (tx) => {
    const updated = await tx.crmCustomerPipelineEntry.update({
      where: { id: existing.id },
      data: {
        isArchived: true,
        archivedAt: new Date(),
        lastActivityAt: new Date(),
      },
      include: crmEntryListInclude,
    });

    await recordCrmActivityTx(tx, {
      workspaceId,
      customerPipelineEntryId: existing.id,
      type: 'LEAD_ARCHIVED',
      previousStageId: existing.stageId,
      newStageId: existing.stageId,
      note: 'Lead diarsipkan',
      metadataJson: { source: 'dashboard' },
      createdByUserId,
    });

    return updated;
  });

  return {
    entry: serializeCrmCustomerPipelineEntry(updatedEntry),
  };
}

export async function restoreCrmEntry({ ownerId, workspaceId, entryId, createdByUserId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });

  const existing = await prisma.crmCustomerPipelineEntry.findFirst({
    where: { id: entryId, workspaceId, workspace: { ownerId } },
    include: crmEntryListInclude,
  });

  if (!existing) {
    throw serviceError(404, 'Lead pipeline tidak ditemukan');
  }

  if (!existing.isArchived) {
    throw serviceError(409, 'Lead tidak dalam status arsip.');
  }

  const updatedEntry = await prisma.$transaction(async (tx) => {
    const updated = await tx.crmCustomerPipelineEntry.update({
      where: { id: existing.id },
      data: {
        isArchived: false,
        archivedAt: null,
        lastActivityAt: new Date(),
      },
      include: crmEntryListInclude,
    });

    await recordCrmActivityTx(tx, {
      workspaceId,
      customerPipelineEntryId: existing.id,
      type: 'LEAD_RESTORED',
      previousStageId: existing.stageId,
      newStageId: existing.stageId,
      note: 'Lead dikembalikan dari arsip',
      metadataJson: { source: 'dashboard', restoredToStageId: existing.stageId },
      createdByUserId,
    });

    return updated;
  });

  return {
    entry: serializeCrmCustomerPipelineEntry(updatedEntry),
  };
}

export async function permanentDeleteCrmEntry({ ownerId, workspaceId, entryId, createdByUserId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });

  const existing = await prisma.crmCustomerPipelineEntry.findFirst({
    where: { id: entryId, workspaceId, workspace: { ownerId } },
    include: crmEntryListInclude,
  });

  if (!existing) {
    throw serviceError(404, 'Lead pipeline tidak ditemukan');
  }

  if (!existing.isArchived) {
    throw serviceError(409, 'Hanya lead yang sudah diarsipkan dapat dihapus permanen. Arsipkan lead terlebih dahulu.');
  }

  // Record deletion activity before deleting (will be cascade-deleted)
  await prisma.crmPipelineActivity.create({
    data: {
      workspaceId,
      customerPipelineEntryId: existing.id,
      type: 'LEAD_DELETED',
      previousStageId: existing.stageId,
      newStageId: existing.stageId,
      note: 'Lead dihapus permanen',
      metadataJson: { source: 'dashboard', entryTitle: existing.title },
      createdByUserId,
    },
  });

  await prisma.crmCustomerPipelineEntry.delete({ where: { id: existing.id } });

  return {
    deletedEntryId: existing.id,
    deletedEntry: serializeCrmCustomerPipelineEntry(existing),
  };
}

export async function listArchivedCrmEntries({ ownerId, workspaceId, filters = {} }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });

  const normalizedSearch = String(filters.search || '').trim();
  const where = {
    workspaceId,
    isArchived: true,
    ...(filters.pipelineId ? { pipelineId: filters.pipelineId } : {}),
    ...(normalizedSearch
      ? {
        OR: [
          { title: { contains: normalizedSearch, mode: 'insensitive' } },
          { source: { contains: normalizedSearch, mode: 'insensitive' } },
          { notes: { contains: normalizedSearch, mode: 'insensitive' } },
          { customer: { name: { contains: normalizedSearch, mode: 'insensitive' } } },
          { customer: { phoneNumber: { contains: normalizedSearch } } },
        ],
      }
      : {}),
    workspace: { ownerId },
  };

  const entries = await prisma.crmCustomerPipelineEntry.findMany({
    where,
    orderBy: [{ archivedAt: 'desc' }, { updatedAt: 'desc' }],
    include: crmEntryListInclude,
  });

  return {
    entries: entries.map((entry) => serializeCrmCustomerPipelineEntry(entry)),
  };
}

export async function listCrmEntryNotes({ ownerId, workspaceId, entryId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  await loadCrmEntryOrThrow({ ownerId, workspaceId, entryId, include: crmEntryListInclude });

  const notes = await prisma.crmPipelineNote.findMany({
    where: {
      workspaceId,
      customerPipelineEntryId: entryId,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      createdByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return {
    notes: notes.map(serializeCrmPipelineNote),
  };
}

export async function createCrmEntryNote({ ownerId, workspaceId, entryId, createdByUserId, content }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const entry = await loadCrmEntryOrThrow({ ownerId, workspaceId, entryId, include: crmEntryDetailInclude });
  const trimmedContent = String(content || '').trim();

  if (!trimmedContent) {
    throw serviceError(400, 'Isi note wajib diisi.', {
      content: ['Isi note wajib diisi.'],
    });
  }

  const note = await prisma.$transaction(async (tx) => {
    const createdNote = await tx.crmPipelineNote.create({
      data: {
        workspaceId,
        customerPipelineEntryId: entry.id,
        content: trimmedContent,
        createdByUserId,
      },
      include: {
        createdByUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    await recordCrmActivityTx(tx, {
      workspaceId,
      customerPipelineEntryId: entry.id,
      type: 'NOTE_ADDED',
      previousStageId: entry.stageId,
      newStageId: entry.stageId,
      note: trimmedContent,
      metadataJson: { noteId: createdNote.id },
      createdByUserId,
    });

    return createdNote;
  });

  return {
    note: serializeCrmPipelineNote(note),
  };
}

export async function deleteCrmEntryNote({ ownerId, workspaceId, noteId }) {
  await assertCrmPipelineAccess({ ownerId, workspaceId, requireActive: true });
  const note = await prisma.crmPipelineNote.findFirst({
    where: {
      id: noteId,
      workspaceId,
      workspace: { ownerId },
    },
    include: {
      createdByUser: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!note) {
    throw serviceError(404, 'Note CRM tidak ditemukan');
  }

  await prisma.crmPipelineNote.delete({ where: { id: note.id } });

  return {
    deletedNote: serializeCrmPipelineNote(note),
  };
}

export async function findCrmStageBySemantic({ workspaceId, pipelineId, semanticKey }) {
  const pipeline = await loadPipelineOrThrow(workspaceId, pipelineId);
  return findSemanticStage(pipeline.stages, semanticKey);
}

export const crmEntryService = {
  archiveCrmEntry,
  assignCrmEntryAgent,
  createCrmEntry,
  createCrmEntryNote,
  deleteCrmEntry,
  deleteCrmEntryNote,
  findCrmStageBySemantic,
  getCrmEntryDetail,
  listCrmEntries,
  listCrmEntryNotes,
  moveCrmEntryStage,
  moveCrmEntryStageInternal,
  updateCrmEntry,
};
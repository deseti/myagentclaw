import prisma from '../lib/prisma.js';
import { computeCrmEntryFlags, findSemanticStage } from '../lib/crm-pipeline.js';
import { moveCrmEntryStageInternal } from './crm-entry.service.js';

function buildCustomerKey(workspaceId, customerId) {
  return `${workspaceId}:${customerId}`;
}

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isDuplicateAutomationMove(entry, targetStageId, automationKey, now) {
  const lastActivities = Array.isArray(entry.activities) ? entry.activities : [];
  const windowStart = now.getTime() - (6 * 60 * 60 * 1000);

  return lastActivities.some((activity) => {
    const createdAt = new Date(activity.createdAt);
    if (Number.isNaN(createdAt.getTime()) || createdAt.getTime() < windowStart) {
      return false;
    }

    const metadataJson = activity.metadataJson && typeof activity.metadataJson === 'object' ? activity.metadataJson : {};
    return activity.newStageId === targetStageId && metadataJson.automationKey === automationKey;
  });
}

function buildAutomationDecision({ entry, openAppointment, completedAppointment, paymentReminder }) {
  if (paymentReminder) {
    return {
      semanticStage: 'waitingPayment',
      activityType: 'PAYMENT_SENT',
      automationKey: 'payment_reminder_created',
      note: `Auto move setelah payment reminder ${paymentReminder.title || paymentReminder.type} dibuat.`,
      metadataJson: {
        paymentReminderId: paymentReminder.id,
        paymentReminderStatus: paymentReminder.status,
      },
    };
  }

  if (completedAppointment) {
    return {
      semanticStage: 'followUp',
      activityType: 'APPOINTMENT_COMPLETED',
      automationKey: 'appointment_completed_follow_up',
      note: `Auto move setelah appointment ${completedAppointment.title || completedAppointment.id} selesai.`,
      metadataJson: {
        appointmentId: completedAppointment.id,
        appointmentStatus: completedAppointment.status,
      },
    };
  }

  if (openAppointment) {
    return {
      semanticStage: 'appointmentScheduled',
      activityType: 'APPOINTMENT_CREATED',
      automationKey: 'appointment_created',
      note: `Auto move setelah appointment ${openAppointment.title || openAppointment.id} dibuat.`,
      metadataJson: {
        appointmentId: openAppointment.id,
        appointmentStatus: openAppointment.status,
      },
    };
  }

  return null;
}

function collectLatestByCustomer(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const key = buildCustomerKey(row.workspaceId, row.customerId);
    if (!map.has(key)) {
      map.set(key, row);
    }
  }

  return map;
}

async function loadAutomationContext(workspaceIds) {
  const [entries, appointments, completedAppointments, paymentReminders] = await Promise.all([
    prisma.crmCustomerPipelineEntry.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        isArchived: false,
      },
      include: {
        pipeline: {
          include: {
            stages: {
              orderBy: { position: 'asc' },
            },
          },
        },
        stage: true,
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 8,
        },
      },
    }),
    prisma.appointmentSchedule.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        status: { in: ['PENDING', 'CONFIRMED', 'RESCHEDULED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        workspaceId: true,
        customerId: true,
        title: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.appointmentSchedule.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        status: 'COMPLETED',
      },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        workspaceId: true,
        customerId: true,
        title: true,
        status: true,
        completedAt: true,
        createdAt: true,
      },
    }),
    prisma.paymentReminder.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        status: { notIn: ['FAILED', 'CANCELLED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        workspaceId: true,
        customerId: true,
        title: true,
        type: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    entries,
    openAppointmentsByCustomer: collectLatestByCustomer(appointments),
    completedAppointmentsByCustomer: collectLatestByCustomer(completedAppointments),
    paymentRemindersByCustomer: collectLatestByCustomer(paymentReminders),
  };
}

export async function runCrmAutomationTick({ workspaceIds = [], now = new Date() }) {
  const normalizedWorkspaceIds = [...new Set((workspaceIds || []).filter(Boolean))];
  if (normalizedWorkspaceIds.length === 0) {
    return {
      moved: 0,
      staleLeads: 0,
      overdueLeads: 0,
      scannedEntries: 0,
    };
  }

  console.info('[crm-automation-worker] crm:automation:start', {
    workspaceCount: normalizedWorkspaceIds.length,
    now: toIsoString(now),
  });

  const context = await loadAutomationContext(normalizedWorkspaceIds);
  let moved = 0;
  let staleLeads = 0;
  let overdueLeads = 0;

  for (const entry of context.entries) {
    const flags = computeCrmEntryFlags(entry, now);
    if (flags.isClosed) {
      continue;
    }

    if (flags.isStale) {
      staleLeads += 1;
      console.info('[crm-automation-worker] crm:stale-lead:detected', {
        entryId: entry.id,
        workspaceId: entry.workspaceId,
        lastActivityAt: toIsoString(entry.lastActivityAt),
      });
    }

    if (flags.isOverdue) {
      overdueLeads += 1;
      console.info('[crm-automation-worker] crm:overdue:detected', {
        entryId: entry.id,
        workspaceId: entry.workspaceId,
        expectedCloseDate: toIsoString(entry.expectedCloseDate),
      });
    }

    const customerKey = buildCustomerKey(entry.workspaceId, entry.customerId);
    const decision = buildAutomationDecision({
      entry,
      openAppointment: context.openAppointmentsByCustomer.get(customerKey) || null,
      completedAppointment: context.completedAppointmentsByCustomer.get(customerKey) || null,
      paymentReminder: context.paymentRemindersByCustomer.get(customerKey) || null,
    });

    if (!decision) {
      continue;
    }

    const targetStage = findSemanticStage(entry.pipeline?.stages || [], decision.semanticStage);
    if (!targetStage || targetStage.id === entry.stageId) {
      continue;
    }

    if (isDuplicateAutomationMove(entry, targetStage.id, decision.automationKey, now)) {
      continue;
    }

    const updatedEntry = await prisma.$transaction(async (tx) => {
      return moveCrmEntryStageInternal({
        tx,
        entry,
        targetStage,
        createdByUserId: null,
        note: decision.note,
        activityType: decision.activityType,
        metadataJson: {
          auto: true,
          automationKey: decision.automationKey,
          ...(decision.metadataJson || {}),
        },
      });
    });

    moved += 1;
    console.info('[crm-automation-worker] crm:stage:auto-move', {
      entryId: entry.id,
      workspaceId: entry.workspaceId,
      previousStageId: entry.stageId,
      newStageId: targetStage.id,
      automationKey: decision.automationKey,
      updatedAt: toIsoString(updatedEntry?.updatedAt),
    });
  }

  return {
    moved,
    staleLeads,
    overdueLeads,
    scannedEntries: context.entries.length,
  };
}

export const crmAutomationService = {
  runCrmAutomationTick,
};
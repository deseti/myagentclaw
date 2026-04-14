import prisma from '../lib/prisma.js';
import {
  APPOINTMENT_SCHEDULER_SKILL_KEY,
  buildAppointmentRealtimePayload,
  getAppointmentEventName,
  getAppointmentWorkerConfig,
} from '../lib/appointment-scheduler.js';
import { listWorkspaceIdsWithAssignedSkill } from '../lib/skill-activation.js';
import {
  autoCompleteAppointment,
  claimMissedFollowUp,
  getAppointmentsNeeding1hReminder,
  getAppointmentsNeeding24hReminder,
  getMissedAppointments,
  getMissedAppointmentsNeedingFollowUp,
  markAppointmentMissed,
  markMissedFollowUpSent,
  markReminderSent,
  releaseMissedFollowUpClaim,
  sendAppointmentMissedFollowUp,
  sendAppointmentReminder,
} from '../services/appointment.service.js';

const WORKER_CONFIG = getAppointmentWorkerConfig();
const AUTO_COMPLETE_AFTER_MS = WORKER_CONFIG.autoCompleteAfterMs;
const WORKER_INTERVAL_MS = 60_000;
const TRACKED_STATUSES = new Set(['CONFIRMED', 'RESCHEDULED']);

async function getIO() {
  try {
    const { io } = await import('../index.js');
    return io;
  } catch {
    return null;
  }
}

async function emitAppointmentUpdate(appointment, action, extra = {}) {
  const io = await getIO();
  if (!io || !appointment?.workspaceId) {
    return;
  }

  const payload = buildAppointmentRealtimePayload(action, appointment, extra);
  io.to(`workspace:${appointment.workspaceId}`).emit(getAppointmentEventName(action), payload);
  io.to(`workspace:${appointment.workspaceId}`).emit('appointment:updated', payload);
}

function toIsoValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildAppointmentLogContext(appointment, now) {
  const scheduledAt = new Date(appointment.scheduledAt);
  const endAt = new Date(appointment.endAt);

  return {
    appointmentId: appointment.id,
    workspaceId: appointment.workspaceId,
    status: appointment.status,
    now: now.toISOString(),
    scheduledAt: toIsoValue(scheduledAt),
    endAt: toIsoValue(endAt),
    timezone: appointment.timezone || null,
    reminder24hSent: Boolean(appointment.reminder24hSent),
    reminder1hSent: Boolean(appointment.reminder1hSent),
    missedFollowUpSent: Boolean(appointment.missedFollowUpSent),
    missedFollowUpSentAt: toIsoValue(appointment.missedFollowUpSentAt),
    missedFollowUpLockedAt: toIsoValue(appointment.missedFollowUpLockedAt),
    completedAt: toIsoValue(appointment.completedAt),
    cancelledAt: toIsoValue(appointment.cancelledAt),
    msUntilScheduledAt: scheduledAt.getTime() - now.getTime(),
    msUntilEndAt: endAt.getTime() - now.getTime(),
  };
}

function evaluateMissedFollowUpState(appointment) {
  if (appointment.status !== 'MISSED') return { eligible: false, reason: 'status_not_missed' };
  if (appointment.completedAt) return { eligible: false, reason: 'completed_at_present' };
  if (appointment.cancelledAt) return { eligible: false, reason: 'cancelled_at_present' };
  if (appointment.missedFollowUpSent) return { eligible: false, reason: 'follow_up_already_sent' };
  if (appointment.missedFollowUpLockedAt) return { eligible: false, reason: 'follow_up_claimed' };
  if (!WORKER_CONFIG.sendMissedFollowUp) return { eligible: false, reason: 'follow_up_disabled' };
  return { eligible: true, reason: 'due' };
}

function evaluateReminderState(appointment, now, reminderWindow) {
  const leadMs = reminderWindow === '1h'
    ? WORKER_CONFIG.secondReminderLeadMs
    : WORKER_CONFIG.firstReminderLeadMs;
  const sentFlag = reminderWindow === '1h' ? appointment.reminder1hSent : appointment.reminder24hSent;
  const scheduledAt = new Date(appointment.scheduledAt);
  const endAt = new Date(appointment.endAt);
  const lowerBound = now.getTime() - WORKER_CONFIG.reminderCatchUpMs;
  const upperBound = now.getTime() + leadMs;

  if (sentFlag) return { eligible: false, reason: `${reminderWindow}_already_sent` };
  if (!TRACKED_STATUSES.has(appointment.status)) return { eligible: false, reason: 'status_not_trackable' };
  if (appointment.completedAt) return { eligible: false, reason: 'completed_at_present' };
  if (appointment.cancelledAt) return { eligible: false, reason: 'cancelled_at_present' };
  if (endAt.getTime() <= now.getTime()) return { eligible: false, reason: 'appointment_already_ended' };
  if (scheduledAt.getTime() > upperBound) return { eligible: false, reason: 'too_early_for_window' };
  if (scheduledAt.getTime() <= lowerBound) return { eligible: false, reason: 'outside_catch_up_window' };
  return { eligible: true, reason: 'due' };
}

function evaluateMissedState(appointment, now) {
  const endAt = new Date(appointment.endAt);
  const missedCutoff = now.getTime() - WORKER_CONFIG.missedAfterEndMs;

  if (!TRACKED_STATUSES.has(appointment.status)) return { eligible: false, reason: 'status_not_trackable' };
  if (appointment.completedAt) return { eligible: false, reason: 'completed_at_present' };
  if (appointment.cancelledAt) return { eligible: false, reason: 'cancelled_at_present' };
  if (endAt.getTime() > missedCutoff) return { eligible: false, reason: 'before_missed_threshold' };
  return { eligible: true, reason: 'due' };
}

async function logAppointmentAudit(activeWorkspaceIds, now) {
  const inspectionFloor = new Date(now.getTime() - Math.max(AUTO_COMPLETE_AFTER_MS, WORKER_CONFIG.reminderCatchUpMs));
  const inspectionCeiling = new Date(now.getTime() + WORKER_CONFIG.firstReminderLeadMs);
  const appointments = await prisma.appointmentSchedule.findMany({
    where: {
      workspaceId: { in: [...activeWorkspaceIds] },
      OR: [
        {
          status: { in: ['CONFIRMED', 'RESCHEDULED'] },
          scheduledAt: { lte: inspectionCeiling },
          endAt: { gte: inspectionFloor },
        },
        {
          status: 'MISSED',
          updatedAt: { gte: inspectionFloor },
        },
      ],
    },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      scheduledAt: true,
      endAt: true,
      timezone: true,
      reminder24hSent: true,
      reminder1hSent: true,
      completedAt: true,
      cancelledAt: true,
      updatedAt: true,
    },
    orderBy: [{ workspaceId: 'asc' }, { scheduledAt: 'asc' }],
  });

  if (appointments.length === 0) {
    console.info('[appointment-reminder-worker] audit:none', {
      now: now.toISOString(),
      workspaceCount: activeWorkspaceIds.size,
      devMode: WORKER_CONFIG.devMode,
    });
    return;
  }

  for (const appointment of appointments) {
    console.info('[appointment-reminder-worker] audit:appointment', {
      ...buildAppointmentLogContext(appointment, now),
      firstReminder: evaluateReminderState(appointment, now, '24h'),
      secondReminder: evaluateReminderState(appointment, now, '1h'),
      missed: evaluateMissedState(appointment, now),
      missedFollowUp: evaluateMissedFollowUpState(appointment),
    });
  }
}

async function findCandidateWorkspaceIds(now) {
  const nextFirstReminderCutoff = new Date(now.getTime() + WORKER_CONFIG.firstReminderLeadMs);
  const nextSecondReminderCutoff = new Date(now.getTime() + WORKER_CONFIG.secondReminderLeadMs);
  const reminderGraceCutoff = new Date(now.getTime() - WORKER_CONFIG.reminderCatchUpMs);
  const missedCutoff = new Date(now.getTime() - WORKER_CONFIG.missedAfterEndMs);
  const rows = await prisma.appointmentSchedule.findMany({
    where: {
      OR: [
        {
          status: { in: ['CONFIRMED', 'RESCHEDULED'] },
          completedAt: null,
          cancelledAt: null,
          endAt: { gt: now },
          reminder24hSent: false,
          scheduledAt: {
            gt: reminderGraceCutoff,
            lte: nextFirstReminderCutoff,
          },
        },
        {
          status: { in: ['CONFIRMED', 'RESCHEDULED'] },
          completedAt: null,
          cancelledAt: null,
          endAt: { gt: now },
          reminder1hSent: false,
          scheduledAt: {
            gt: reminderGraceCutoff,
            lte: nextSecondReminderCutoff,
          },
        },
        {
          status: { in: ['CONFIRMED', 'RESCHEDULED'] },
          completedAt: null,
          cancelledAt: null,
          endAt: { lte: missedCutoff },
        },
        ...(WORKER_CONFIG.sendMissedFollowUp ? [{
          status: 'MISSED',
          completedAt: null,
          cancelledAt: null,
          missedFollowUpSent: false,
          missedFollowUpLockedAt: null,
        }] : []),
      ],
    },
    select: { workspaceId: true },
    distinct: ['workspaceId'],
  });

  return rows.map((row) => row.workspaceId).filter(Boolean);
}

async function process24hReminders(activeWorkspaceIds, now) {
  const appointments = await getAppointmentsNeeding24hReminder({
    workspaceIds: [...activeWorkspaceIds],
    now,
  });

  console.info('[appointment-reminder-worker] reminder24h:scan', {
    now: now.toISOString(),
    candidateCount: appointments.length,
    devMode: WORKER_CONFIG.devMode,
    leadMs: WORKER_CONFIG.firstReminderLeadMs,
    catchUpMs: WORKER_CONFIG.reminderCatchUpMs,
  });

  for (const appointment of appointments) {
    try {
      console.info('[appointment-reminder-worker] reminder24h:due', buildAppointmentLogContext(appointment, now));
      const delivery = await sendAppointmentReminder({
        appointmentId: appointment.id,
        reminderWindow: '24h',
      });
      const updated = await markReminderSent({
        appointmentId: appointment.id,
        reminderWindow: '24h',
        actionBy: 'system',
      });

      console.info('[appointment-reminder-worker] reminder24h:sent', {
        appointmentId: appointment.id,
        workspaceId: appointment.workspaceId,
        conversationId: delivery.conversation?.id || null,
        messageId: delivery.message?.id || null,
      });

      await emitAppointmentUpdate(updated, 'reminder24h', {
        reminderWindow: '24h',
        conversationId: delivery.conversation?.id || null,
        messageId: delivery.message?.id || null,
      });
    } catch (error) {
      console.error('[appointment-reminder-worker] reminder24h:failed', {
        ...buildAppointmentLogContext(appointment, now),
        error: error.message,
        reason: 'send_or_mark_failed',
      });
    }
  }
}

async function process1hReminders(activeWorkspaceIds, now) {
  const appointments = await getAppointmentsNeeding1hReminder({
    workspaceIds: [...activeWorkspaceIds],
    now,
  });

  console.info('[appointment-reminder-worker] reminder1h:scan', {
    now: now.toISOString(),
    candidateCount: appointments.length,
    devMode: WORKER_CONFIG.devMode,
    leadMs: WORKER_CONFIG.secondReminderLeadMs,
    catchUpMs: WORKER_CONFIG.reminderCatchUpMs,
  });

  for (const appointment of appointments) {
    try {
      console.info('[appointment-reminder-worker] reminder1h:due', buildAppointmentLogContext(appointment, now));
      const delivery = await sendAppointmentReminder({
        appointmentId: appointment.id,
        reminderWindow: '1h',
      });
      const updated = await markReminderSent({
        appointmentId: appointment.id,
        reminderWindow: '1h',
        actionBy: 'system',
      });

      console.info('[appointment-reminder-worker] reminder1h:sent', {
        appointmentId: appointment.id,
        workspaceId: appointment.workspaceId,
        conversationId: delivery.conversation?.id || null,
        messageId: delivery.message?.id || null,
      });

      await emitAppointmentUpdate(updated, 'reminder1h', {
        reminderWindow: '1h',
        conversationId: delivery.conversation?.id || null,
        messageId: delivery.message?.id || null,
      });
    } catch (error) {
      console.error('[appointment-reminder-worker] reminder1h:failed', {
        ...buildAppointmentLogContext(appointment, now),
        error: error.message,
        reason: 'send_or_mark_failed',
      });
    }
  }
}

async function processMissedAppointments(activeWorkspaceIds, now) {
  const missedCutoff = new Date(now.getTime() - WORKER_CONFIG.missedAfterEndMs);

  for (const workspaceId of activeWorkspaceIds) {
    const candidates = await getMissedAppointments({ workspaceId, now });
    const autoCompleteThreshold = now.getTime() - AUTO_COMPLETE_AFTER_MS;
    const missedWindowAppointments = candidates.filter((appointment) => new Date(appointment.endAt).getTime() > autoCompleteThreshold);

    console.info('[appointment-reminder-worker] missed:scan', {
      now: now.toISOString(),
      workspaceId,
      candidateCount: candidates.length,
      actionableCount: missedWindowAppointments.length,
      missedCutoff: missedCutoff.toISOString(),
      autoCompleteThreshold: new Date(autoCompleteThreshold).toISOString(),
      devMode: WORKER_CONFIG.devMode,
    });

    for (const appointment of missedWindowAppointments) {
      try {
        console.info('[appointment-reminder-worker] missed:due', buildAppointmentLogContext(appointment, now));
        const updated = await markAppointmentMissed({
          appointmentId: appointment.id,
          notes: 'Appointment lewat dari jadwal dan belum diselesaikan.',
          actionBy: 'system',
        });

        if (!updated) {
          console.info('[appointment-reminder-worker] missed:skipped', {
            ...buildAppointmentLogContext(appointment, now),
            reason: 'mark_appointment_missed_returned_null',
          });
          continue;
        }

        console.info('[appointment-reminder-worker] missed:updated', {
          appointmentId: updated.id,
          workspaceId: updated.workspaceId,
          endAt: updated.endAt,
          reason: 'end_at_passed_and_not_completed_or_cancelled',
        });

        await emitAppointmentUpdate(updated, 'missed');
      } catch (error) {
        console.error('[appointment-reminder-worker] missed:failed', {
          ...buildAppointmentLogContext(appointment, now),
          error: error.message,
          reason: 'mark_missed_failed',
        });
      }
    }
  }
}

async function processMissedFollowUps(activeWorkspaceIds, now) {
  if (!WORKER_CONFIG.sendMissedFollowUp) {
    console.info('[appointment-reminder-worker] missed:follow-up-scan', {
      now: now.toISOString(),
      candidateCount: 0,
      reason: 'follow_up_disabled',
    });
    return;
  }

  const appointments = await getMissedAppointmentsNeedingFollowUp({
    workspaceIds: [...activeWorkspaceIds],
  });

  console.info('[appointment-reminder-worker] missed:follow-up-scan', {
    now: now.toISOString(),
    candidateCount: appointments.length,
  });

  for (const appointment of appointments) {
    const claimed = await claimMissedFollowUp({ appointmentId: appointment.id });

    if (!claimed) {
      console.info('[appointment-reminder-worker] missed:follow-up-skipped', {
        ...buildAppointmentLogContext(appointment, now),
        reason: 'follow_up_already_claimed_or_sent',
      });
      continue;
    }

    try {
      const delivery = await sendAppointmentMissedFollowUp({ appointmentId: claimed.id });
      const updated = await markMissedFollowUpSent({ appointmentId: claimed.id, actionBy: 'system' });

      console.info('[appointment-reminder-worker] missed:follow-up-sent', {
        appointmentId: claimed.id,
        workspaceId: claimed.workspaceId,
        conversationId: delivery.conversation?.id || null,
        messageId: delivery.message?.id || null,
      });

      if (updated) {
        await emitAppointmentUpdate(updated, 'updated', { missedFollowUpSent: true });
      }
    } catch (error) {
      await releaseMissedFollowUpClaim({ appointmentId: claimed.id });
      console.error('[appointment-reminder-worker] missed:follow-up-failed', {
        ...buildAppointmentLogContext(claimed, now),
        error: error.message,
      });
    }
  }
}

async function processAutoComplete(activeWorkspaceIds, now) {
  for (const workspaceId of activeWorkspaceIds) {
    const candidates = await getMissedAppointments({ workspaceId, now });
    const autoCompleteThreshold = now.getTime() - AUTO_COMPLETE_AFTER_MS;
    const autoCompleteCandidates = candidates.filter((appointment) => new Date(appointment.endAt).getTime() <= autoCompleteThreshold);

    console.info('[appointment-reminder-worker] auto-complete:scan', {
      now: now.toISOString(),
      workspaceId,
      candidateCount: candidates.length,
      actionableCount: autoCompleteCandidates.length,
      autoCompleteThreshold: new Date(autoCompleteThreshold).toISOString(),
      devMode: WORKER_CONFIG.devMode,
    });

    for (const appointment of autoCompleteCandidates) {
      try {
        console.info('[appointment-reminder-worker] auto-complete:due', buildAppointmentLogContext(appointment, now));
        const updated = await autoCompleteAppointment({
          appointmentId: appointment.id,
          notes: 'Appointment di-auto-complete karena sudah lewat lebih dari 2 jam dari endAt.',
          actionBy: 'system',
        });

        if (!updated) {
          console.info('[appointment-reminder-worker] auto-complete:skipped', {
            ...buildAppointmentLogContext(appointment, now),
            reason: 'auto_complete_returned_null',
          });
          continue;
        }

        console.info('[appointment-reminder-worker] auto-complete:updated', {
          appointmentId: updated.id,
          workspaceId: updated.workspaceId,
          endAt: updated.endAt,
        });

        await emitAppointmentUpdate(updated, 'completed', { autoCompleted: true });
      } catch (error) {
        console.error('[appointment-reminder-worker] auto-complete:failed', {
          ...buildAppointmentLogContext(appointment, now),
          error: error.message,
        });
      }
    }
  }
}

let schedulerBusy = false;

async function runAppointmentSchedulerTick() {
  if (schedulerBusy) {
    return;
  }

  schedulerBusy = true;
  const startedAt = new Date();

  try {
    const workspaceIds = await findCandidateWorkspaceIds(startedAt);
    const activeWorkspaceIds = await listWorkspaceIdsWithAssignedSkill(workspaceIds, APPOINTMENT_SCHEDULER_SKILL_KEY);

    if (activeWorkspaceIds.size === 0) {
      console.info('[appointment-reminder-worker] tick:idle', {
        at: startedAt.toISOString(),
        candidateWorkspaces: workspaceIds.length,
      });
      return;
    }

    console.info('[appointment-reminder-worker] tick:start', {
      at: startedAt.toISOString(),
      activeWorkspaces: [...activeWorkspaceIds],
      devMode: WORKER_CONFIG.devMode,
      workerConfig: WORKER_CONFIG,
    });

    await logAppointmentAudit(activeWorkspaceIds, startedAt);

    await process24hReminders(activeWorkspaceIds, startedAt);
    await process1hReminders(activeWorkspaceIds, startedAt);
    await processMissedAppointments(activeWorkspaceIds, startedAt);
    await processMissedFollowUps(activeWorkspaceIds, startedAt);
    await processAutoComplete(activeWorkspaceIds, startedAt);

    console.info('[appointment-reminder-worker] tick:complete', {
      at: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      activeWorkspaceCount: activeWorkspaceIds.size,
    });
  } catch (error) {
    console.error('[appointment-reminder-worker] tick:failed', {
      at: new Date().toISOString(),
      error: error.message,
    });
  } finally {
    schedulerBusy = false;
  }
}

const schedulerTimer = setInterval(() => {
  runAppointmentSchedulerTick().catch((error) => {
    console.error('[appointment-reminder-worker] scheduler:error', { error: error.message });
  });
}, WORKER_INTERVAL_MS);

if (typeof schedulerTimer.unref === 'function') {
  schedulerTimer.unref();
}

runAppointmentSchedulerTick().catch((error) => {
  console.error('[appointment-reminder-worker] bootstrap:error', { error: error.message });
});

console.log('[appointment-reminder-worker] Started and listening for periodic appointment scheduler ticks');
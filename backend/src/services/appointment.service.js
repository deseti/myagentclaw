import prisma from '../lib/prisma.js';
import { handleOutbound } from '../channels/gateway.js';
import {
  APPOINTMENT_ACTIVITY_ACTIONS,
  APPOINTMENT_SCHEDULER_SKILL_KEY,
  DEFAULT_APPOINTMENT_TIMEZONE,
  appointmentFitsAvailability,
  buildAppointmentMissedFollowUpMessage,
  buildAppointmentReminderMessage,
  buildAppointmentStats,
  buildAvailabilityRowsFromConfig,
  getAppointmentLocalDayKey,
  getAppointmentSchedulerConfig,
  getAppointmentWorkerConfig,
  inferAppointmentEndAt,
  normalizeAppointmentLocationType,
  normalizeAppointmentStatus,
  normalizeAppointmentType,
  serializeAppointment,
  serializeAppointmentAvailability,
} from '../lib/appointment-scheduler.js';
import { agentHasAssignedSkill, listAgentsUsingSkill, matchesSkillKey, workspaceHasAssignedSkill } from '../lib/skill-activation.js';
import {
  formatInternalSkillTierLabel,
  getInternalSkillDefinition,
  workspaceMeetsMinimumTier,
} from '../lib/internal-skills.js';
import { ocListInstalledSkills } from '../lib/openclaw-client.js';
import { ensureWorkspaceRuntime } from '../lib/runtime-manager.js';

const APPOINTMENT_SKILL_DEFINITION = getInternalSkillDefinition(APPOINTMENT_SCHEDULER_SKILL_KEY);
const ACTIVE_APPOINTMENT_STATUSES = ['PENDING', 'CONFIRMED', 'RESCHEDULED'];
const NON_CONFLICT_STATUSES = ['CANCELLED', 'COMPLETED', 'MISSED'];
const REMINDER_TRACKING_STATUSES = ['CONFIRMED', 'RESCHEDULED'];

const appointmentSummaryInclude = {
  customer: {
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      isBlocked: true,
      isArchived: true,
    },
  },
  agent: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
};

const appointmentDetailInclude = {
  ...appointmentSummaryInclude,
  activityLogs: {
    orderBy: { createdAt: 'desc' },
    take: 50,
  },
};

const conversationRoutingSelect = {
  id: true,
  status: true,
  channelId: true,
  channelType: true,
  channel: {
    select: {
      id: true,
      status: true,
      type: true,
    },
  },
};

export class AppointmentServiceError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'AppointmentServiceError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

function serviceError(statusCode, message, details) {
  return new AppointmentServiceError(statusCode, message, details);
}

function normalizeDateInput(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw serviceError(400, 'Tanggal appointment tidak valid.');
  }
  return date;
}

function buildListWhere({ workspaceId, status, agentId, customerId, startDate, endDate }) {
  return {
    workspaceId,
    ...(status ? { status } : {}),
    ...(agentId ? { agentId } : {}),
    ...(customerId ? { customerId } : {}),
    ...((startDate || endDate)
      ? {
        scheduledAt: {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {}),
        },
      }
      : {}),
  };
}

function buildSkillStatus(access) {
  return {
    key: APPOINTMENT_SCHEDULER_SKILL_KEY,
    installed: Boolean(access?.isInstalled),
    active: Boolean(access?.isActive),
    assignedCount: Number(access?.assignedCount || 0),
    usedBy: Array.isArray(access?.assignedAgents) ? access.assignedAgents : [],
    opensSidebar: 'Appointment Scheduler',
    worker: 'appointment-reminder-worker',
  };
}

function ensureEndAtAfterScheduledAt(scheduledAt, endAt) {
  if (endAt.getTime() <= scheduledAt.getTime()) {
    throw serviceError(400, 'endAt harus lebih besar dari scheduledAt.', {
      endAt: ['endAt harus lebih besar dari scheduledAt.'],
    });
  }
}

async function createActivityLogTx(tx, payload) {
  return tx.appointmentActivityLog.create({
    data: {
      workspaceId: payload.workspaceId,
      appointmentId: payload.appointmentId,
      actionType: payload.actionType,
      actionBy: payload.actionBy,
      previousStatus: payload.previousStatus || null,
      newStatus: payload.newStatus || null,
      notes: payload.notes || null,
    },
  });
}

async function loadWorkspace(ownerId, workspaceId) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId },
    select: { id: true, ownerId: true, name: true, subTier: true, subStatus: true },
  });

  if (!workspace) {
    throw serviceError(404, 'Workspace tidak ditemukan');
  }

  return workspace;
}

export async function assertAppointmentSchedulerAccess({ ownerId, workspaceId, requireActive = true }) {
  const workspace = await loadWorkspace(ownerId, workspaceId);

  if (!workspaceMeetsMinimumTier(workspace.subTier, APPOINTMENT_SKILL_DEFINITION?.minimumTier || 'STARTER')) {
    throw serviceError(
      403,
      `Appointment Scheduler memerlukan minimum paket ${formatInternalSkillTierLabel(APPOINTMENT_SKILL_DEFINITION?.minimumTier)}.`,
    );
  }

  try {
    const runtime = await ensureWorkspaceRuntime({ ...workspace, ownerId });
    const installedPayload = await ocListInstalledSkills(runtime);
    const installedSkills = Array.isArray(installedPayload?.skills) ? installedPayload.skills : [];
    const skillInstalled = installedSkills.some((skill) => matchesSkillKey(skill, APPOINTMENT_SCHEDULER_SKILL_KEY));

    if (!skillInstalled) {
      throw serviceError(403, 'Skill built-in Appointment Scheduler belum diinstall untuk workspace ini.', {
        requiredSkill: APPOINTMENT_SCHEDULER_SKILL_KEY,
      });
    }

    const assignedAgents = await listAgentsUsingSkill(workspace.id, APPOINTMENT_SCHEDULER_SKILL_KEY);
    const isActive = assignedAgents.length > 0;

    if (requireActive && !isActive) {
      throw serviceError(
        403,
        'Skill Appointment Scheduler sudah terinstall, tetapi belum aktif. Assign skill ini ke minimal satu agent untuk membuka dashboard dan worker.',
        { requiredSkill: APPOINTMENT_SCHEDULER_SKILL_KEY },
      );
    }

    return {
      workspace,
      runtime,
      isInstalled: true,
      isActive,
      assignedCount: assignedAgents.length,
      assignedAgents: assignedAgents.map(({ id, name, status }) => ({ id, name, status })),
      skillStatus: buildSkillStatus({ isInstalled: true, isActive, assignedCount: assignedAgents.length, assignedAgents }),
    };
  } catch (error) {
    if (error instanceof AppointmentServiceError) {
      throw error;
    }

    throw serviceError(502, 'Gagal memverifikasi skill Appointment Scheduler di runtime workspace.');
  }
}

async function resolveAppointmentRelations({ ownerId, workspaceId, agentId, customerId }) {
  const [agent, customer] = await Promise.all([
    prisma.agent.findFirst({
      where: { id: agentId, workspaceId, workspace: { ownerId } },
      include: {
        appointmentAvailabilities: {
          where: { isEnabled: true },
          orderBy: [{ dayOfWeek: 'asc' }, { startHour: 'asc' }],
        },
      },
    }),
    prisma.customer.findFirst({
      where: { id: customerId, workspaceId, workspace: { ownerId } },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        isBlocked: true,
        isArchived: true,
      },
    }),
  ]);

  if (!agent) {
    throw serviceError(404, 'Agent tidak ditemukan');
  }

  if (!customer) {
    throw serviceError(404, 'Customer tidak ditemukan');
  }

  if (agent.status !== 'ACTIVE') {
    throw serviceError(409, 'Agent Appointment Scheduler harus aktif.');
  }

  if (!agentHasAssignedSkill(agent, APPOINTMENT_SCHEDULER_SKILL_KEY)) {
    throw serviceError(403, 'Agent yang dipilih belum memakai skill Appointment Scheduler.', {
      requiredSkill: APPOINTMENT_SCHEDULER_SKILL_KEY,
    });
  }

  return {
    agent,
    customer,
    skillConfig: getAppointmentSchedulerConfig(agent),
  };
}

async function loadAppointmentRecordOrThrow({ ownerId, workspaceId, appointmentId, include = appointmentDetailInclude }) {
  const appointment = await prisma.appointmentSchedule.findFirst({
    where: {
      id: appointmentId,
      workspaceId,
      workspace: { ownerId },
    },
    include,
  });

  if (!appointment) {
    throw serviceError(404, 'Appointment tidak ditemukan');
  }

  return appointment;
}

export async function checkAppointmentConflict({
  workspaceId,
  agentId,
  customerId,
  scheduledAt,
  endAt,
  excludeAppointmentId,
}) {
  const conflicts = await prisma.appointmentSchedule.findMany({
    where: {
      workspaceId,
      id: excludeAppointmentId ? { not: excludeAppointmentId } : undefined,
      status: { notIn: NON_CONFLICT_STATUSES },
      scheduledAt: { lt: endAt },
      endAt: { gt: scheduledAt },
      OR: [
        { agentId },
        { customerId },
      ],
    },
    include: appointmentSummaryInclude,
    orderBy: { scheduledAt: 'asc' },
  });

  return {
    hasConflict: conflicts.length > 0,
    conflicts: conflicts.map(serializeAppointment),
  };
}

export async function checkAgentAvailability({ workspaceId, agentId, scheduledAt, endAt }) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, workspaceId },
    include: {
      appointmentAvailabilities: {
        where: { isEnabled: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startHour: 'asc' }],
      },
    },
  });

  if (!agent) {
    throw serviceError(404, 'Agent tidak ditemukan');
  }

  const skillConfig = getAppointmentSchedulerConfig(agent);
  const availabilityRows = agent.appointmentAvailabilities.length > 0
    ? agent.appointmentAvailabilities
    : buildAvailabilityRowsFromConfig({ workspaceId, agentId, config: skillConfig });

  if (!skillConfig.enableBooking) {
    return {
      available: false,
      reason: 'Booking untuk agent ini sedang dinonaktifkan.',
      availability: availabilityRows.map(serializeAppointmentAvailability),
      skillConfig,
    };
  }

  const matchingAvailability = availabilityRows.find((availability) => appointmentFitsAvailability({
    scheduledAt,
    endAt,
    availability,
  }));

  return {
    available: Boolean(matchingAvailability),
    reason: matchingAvailability ? null : 'Slot agent tidak tersedia pada jam dan hari yang dipilih.',
    availability: availabilityRows.map(serializeAppointmentAvailability),
    matchingAvailability: serializeAppointmentAvailability(matchingAvailability),
    skillConfig,
  };
}

async function computeWorkspaceAppointmentStats(workspaceId) {
  const statsRows = await prisma.appointmentSchedule.findMany({
    where: { workspaceId },
    select: {
      status: true,
      scheduledAt: true,
      timezone: true,
    },
  });

  return buildAppointmentStats(statsRows);
}

export async function listAppointments({
  ownerId,
  workspaceId,
  status,
  agentId,
  customerId,
  startDate,
  endDate,
}) {
  const access = await assertAppointmentSchedulerAccess({ ownerId, workspaceId, requireActive: true });
  const where = buildListWhere({ workspaceId: access.workspace.id, status, agentId, customerId, startDate, endDate });

  const [appointments, stats] = await Promise.all([
    prisma.appointmentSchedule.findMany({
      where,
      include: appointmentSummaryInclude,
      orderBy: [
        { scheduledAt: 'asc' },
        { createdAt: 'desc' },
      ],
    }),
    computeWorkspaceAppointmentStats(access.workspace.id),
  ]);

  return {
    access,
    appointments: appointments.map(serializeAppointment),
    stats,
  };
}

export async function getAppointmentById({ ownerId, workspaceId, appointmentId }) {
  const access = await assertAppointmentSchedulerAccess({ ownerId, workspaceId, requireActive: true });
  const appointment = await loadAppointmentRecordOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    appointmentId,
    include: appointmentDetailInclude,
  });

  return {
    access,
    appointment,
    serializedAppointment: serializeAppointment(appointment),
  };
}

function resolveAppointmentEndAt(rawEndAt, scheduledAt, fallbackDurationMinutes) {
  return rawEndAt
    ? normalizeDateInput(rawEndAt)
    : inferAppointmentEndAt(scheduledAt, fallbackDurationMinutes);
}

function resolveStatusTimestamps(status, existing = null) {
  const normalizedStatus = normalizeAppointmentStatus(status, existing?.status || 'PENDING');
  return {
    status: normalizedStatus,
    cancelledAt: normalizedStatus === 'CANCELLED' ? new Date() : existing?.cancelledAt || null,
    completedAt: normalizedStatus === 'COMPLETED' ? new Date() : existing?.completedAt || null,
  };
}

export async function createAppointment({ ownerId, input, actionBy }) {
  const access = await assertAppointmentSchedulerAccess({ ownerId, workspaceId: input.workspaceId, requireActive: true });
  const relations = await resolveAppointmentRelations({
    ownerId,
    workspaceId: access.workspace.id,
    agentId: input.agentId,
    customerId: input.customerId,
  });

  const scheduledAt = normalizeDateInput(input.scheduledAt);
  const endAt = resolveAppointmentEndAt(input.endAt, scheduledAt, relations.skillConfig.defaultMeetingDuration);
  ensureEndAtAfterScheduledAt(scheduledAt, endAt);

  const [conflict, availability] = await Promise.all([
    checkAppointmentConflict({
      workspaceId: access.workspace.id,
      agentId: relations.agent.id,
      customerId: relations.customer.id,
      scheduledAt,
      endAt,
    }),
    checkAgentAvailability({
      workspaceId: access.workspace.id,
      agentId: relations.agent.id,
      scheduledAt,
      endAt,
    }),
  ]);

  if (conflict.hasConflict) {
    throw serviceError(409, 'Jadwal appointment bentrok dengan appointment lain.', {
      conflicts: conflict.conflicts,
    });
  }

  if (!availability.available) {
    throw serviceError(409, availability.reason || 'Slot agent tidak tersedia.', {
      availability: availability.availability,
    });
  }

  const status = normalizeAppointmentStatus(input.status, 'CONFIRMED');
  const timestamps = resolveStatusTimestamps(status);

  const appointment = await prisma.$transaction(async (tx) => {
    const created = await tx.appointmentSchedule.create({
      data: {
        workspaceId: access.workspace.id,
        agentId: relations.agent.id,
        customerId: relations.customer.id,
        title: input.title,
        description: input.description || null,
        appointmentType: normalizeAppointmentType(input.appointmentType),
        status: timestamps.status,
        scheduledAt,
        endAt,
        timezone: input.timezone || relations.skillConfig.timezone || DEFAULT_APPOINTMENT_TIMEZONE,
        locationType: normalizeAppointmentLocationType(input.locationType, 'ONLINE'),
        meetingLink: input.meetingLink || null,
        physicalLocation: input.physicalLocation || null,
        notes: input.notes || null,
        cancelledAt: timestamps.cancelledAt,
        completedAt: timestamps.completedAt,
      },
      include: appointmentDetailInclude,
    });

    await createActivityLogTx(tx, {
      workspaceId: access.workspace.id,
      appointmentId: created.id,
      actionType: APPOINTMENT_ACTIVITY_ACTIONS.CREATED,
      actionBy,
      previousStatus: null,
      newStatus: created.status,
      notes: input.notes || null,
    });

    return tx.appointmentSchedule.findUnique({
      where: { id: created.id },
      include: appointmentDetailInclude,
    });
  });

  return {
    access,
    appointment,
    serializedAppointment: serializeAppointment(appointment),
  };
}

export async function updateAppointment({ ownerId, appointmentId, input, actionBy }) {
  const access = await assertAppointmentSchedulerAccess({ ownerId, workspaceId: input.workspaceId, requireActive: true });
  const existing = await loadAppointmentRecordOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    appointmentId,
    include: appointmentDetailInclude,
  });

  const relations = await resolveAppointmentRelations({
    ownerId,
    workspaceId: access.workspace.id,
    agentId: existing.agentId,
    customerId: existing.customerId,
  });

  const scheduledAt = input.scheduledAt ? normalizeDateInput(input.scheduledAt) : existing.scheduledAt;
  const endAt = (input.scheduledAt || input.endAt)
    ? resolveAppointmentEndAt(input.endAt, scheduledAt, relations.skillConfig.defaultMeetingDuration)
    : existing.endAt;
  ensureEndAtAfterScheduledAt(scheduledAt, endAt);

  if (input.scheduledAt || input.endAt) {
    const [conflict, availability] = await Promise.all([
      checkAppointmentConflict({
        workspaceId: access.workspace.id,
        agentId: existing.agentId,
        customerId: existing.customerId,
        scheduledAt,
        endAt,
        excludeAppointmentId: existing.id,
      }),
      checkAgentAvailability({
        workspaceId: access.workspace.id,
        agentId: existing.agentId,
        scheduledAt,
        endAt,
      }),
    ]);

    if (conflict.hasConflict) {
      throw serviceError(409, 'Jadwal appointment bentrok dengan appointment lain.', {
        conflicts: conflict.conflicts,
      });
    }

    if (!availability.available) {
      throw serviceError(409, availability.reason || 'Slot agent tidak tersedia.', {
        availability: availability.availability,
      });
    }
  }

  const nextStatus = input.status ? normalizeAppointmentStatus(input.status, existing.status) : existing.status;
  const timestamps = resolveStatusTimestamps(nextStatus, existing);
  const statusChanged = existing.status !== nextStatus;

  const appointment = await prisma.$transaction(async (tx) => {
    await tx.appointmentSchedule.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description || null } : {}),
        ...(input.appointmentType !== undefined ? { appointmentType: normalizeAppointmentType(input.appointmentType, existing.appointmentType) } : {}),
        ...(input.meetingLink !== undefined ? { meetingLink: input.meetingLink || null } : {}),
        ...(input.physicalLocation !== undefined ? { physicalLocation: input.physicalLocation || null } : {}),
        ...(input.locationType !== undefined ? { locationType: normalizeAppointmentLocationType(input.locationType, existing.locationType) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone || existing.timezone || DEFAULT_APPOINTMENT_TIMEZONE } : {}),
        ...(input.scheduledAt !== undefined ? { scheduledAt } : {}),
        ...(input.scheduledAt !== undefined || input.endAt !== undefined ? { endAt } : {}),
        ...(input.status !== undefined ? { status: nextStatus } : {}),
        ...(statusChanged ? { cancelledAt: timestamps.cancelledAt, completedAt: timestamps.completedAt } : {}),
      },
    });

    await createActivityLogTx(tx, {
      workspaceId: access.workspace.id,
      appointmentId: existing.id,
      actionType: APPOINTMENT_ACTIVITY_ACTIONS.UPDATED,
      actionBy,
      previousStatus: existing.status,
      newStatus: nextStatus,
      notes: input.notes || input.description || null,
    });

    return tx.appointmentSchedule.findUnique({
      where: { id: existing.id },
      include: appointmentDetailInclude,
    });
  });

  return {
    access,
    appointment,
    serializedAppointment: serializeAppointment(appointment),
  };
}

export async function rescheduleAppointment({ ownerId, appointmentId, input, actionBy }) {
  const access = await assertAppointmentSchedulerAccess({ ownerId, workspaceId: input.workspaceId, requireActive: true });
  const existing = await loadAppointmentRecordOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    appointmentId,
    include: appointmentDetailInclude,
  });

  const relations = await resolveAppointmentRelations({
    ownerId,
    workspaceId: access.workspace.id,
    agentId: existing.agentId,
    customerId: existing.customerId,
  });

  if (!relations.skillConfig.enableReschedule) {
    throw serviceError(409, 'Reschedule untuk agent ini sedang dinonaktifkan.');
  }

  const scheduledAt = normalizeDateInput(input.scheduledAt);
  const endAt = resolveAppointmentEndAt(input.endAt, scheduledAt, relations.skillConfig.defaultMeetingDuration);
  ensureEndAtAfterScheduledAt(scheduledAt, endAt);

  const [conflict, availability] = await Promise.all([
    checkAppointmentConflict({
      workspaceId: access.workspace.id,
      agentId: existing.agentId,
      customerId: existing.customerId,
      scheduledAt,
      endAt,
      excludeAppointmentId: existing.id,
    }),
    checkAgentAvailability({
      workspaceId: access.workspace.id,
      agentId: existing.agentId,
      scheduledAt,
      endAt,
    }),
  ]);

  if (conflict.hasConflict) {
    throw serviceError(409, 'Jadwal baru bentrok dengan appointment lain.', {
      conflicts: conflict.conflicts,
    });
  }

  if (!availability.available) {
    throw serviceError(409, availability.reason || 'Slot agent tidak tersedia.', {
      availability: availability.availability,
    });
  }

  const appointment = await prisma.$transaction(async (tx) => {
    await tx.appointmentSchedule.update({
      where: { id: existing.id },
      data: {
        scheduledAt,
        endAt,
        status: 'RESCHEDULED',
        reminder24hSent: false,
        reminder1hSent: false,
        missedFollowUpSent: false,
        missedFollowUpSentAt: null,
        missedFollowUpLockedAt: null,
        cancelledAt: null,
        notes: input.notes !== undefined ? (input.notes || null) : existing.notes,
      },
    });

    await createActivityLogTx(tx, {
      workspaceId: access.workspace.id,
      appointmentId: existing.id,
      actionType: APPOINTMENT_ACTIVITY_ACTIONS.RESCHEDULED,
      actionBy,
      previousStatus: existing.status,
      newStatus: 'RESCHEDULED',
      notes: input.notes || null,
    });

    return tx.appointmentSchedule.findUnique({
      where: { id: existing.id },
      include: appointmentDetailInclude,
    });
  });

  return {
    access,
    appointment,
    serializedAppointment: serializeAppointment(appointment),
  };
}

export async function cancelAppointment({ ownerId, appointmentId, input, actionBy }) {
  const access = await assertAppointmentSchedulerAccess({ ownerId, workspaceId: input.workspaceId, requireActive: true });
  const existing = await loadAppointmentRecordOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    appointmentId,
    include: appointmentDetailInclude,
  });

  const relations = await resolveAppointmentRelations({
    ownerId,
    workspaceId: access.workspace.id,
    agentId: existing.agentId,
    customerId: existing.customerId,
  });

  if (!relations.skillConfig.enableCancellation) {
    throw serviceError(409, 'Cancellation untuk agent ini sedang dinonaktifkan.');
  }

  const appointment = await prisma.$transaction(async (tx) => {
    await tx.appointmentSchedule.update({
      where: { id: existing.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        notes: input.notes !== undefined ? (input.notes || null) : existing.notes,
      },
    });

    await createActivityLogTx(tx, {
      workspaceId: access.workspace.id,
      appointmentId: existing.id,
      actionType: APPOINTMENT_ACTIVITY_ACTIONS.CANCELLED,
      actionBy,
      previousStatus: existing.status,
      newStatus: 'CANCELLED',
      notes: input.notes || null,
    });

    return tx.appointmentSchedule.findUnique({
      where: { id: existing.id },
      include: appointmentDetailInclude,
    });
  });

  return {
    access,
    appointment,
    serializedAppointment: serializeAppointment(appointment),
  };
}

export async function completeAppointment({ ownerId, appointmentId, input, actionBy }) {
  const access = await assertAppointmentSchedulerAccess({ ownerId, workspaceId: input.workspaceId, requireActive: true });
  const existing = await loadAppointmentRecordOrThrow({
    ownerId,
    workspaceId: access.workspace.id,
    appointmentId,
    include: appointmentDetailInclude,
  });

  const completedAt = input.completedAt ? normalizeDateInput(input.completedAt) : new Date();

  const appointment = await prisma.$transaction(async (tx) => {
    await tx.appointmentSchedule.update({
      where: { id: existing.id },
      data: {
        status: 'COMPLETED',
        completedAt,
        notes: input.notes !== undefined ? (input.notes || null) : existing.notes,
      },
    });

    await createActivityLogTx(tx, {
      workspaceId: access.workspace.id,
      appointmentId: existing.id,
      actionType: APPOINTMENT_ACTIVITY_ACTIONS.COMPLETED,
      actionBy,
      previousStatus: existing.status,
      newStatus: 'COMPLETED',
      notes: input.notes || null,
    });

    return tx.appointmentSchedule.findUnique({
      where: { id: existing.id },
      include: appointmentDetailInclude,
    });
  });

  return {
    access,
    appointment,
    serializedAppointment: serializeAppointment(appointment),
  };
}

export async function markAppointmentMissed({ appointmentId, notes = null, actionBy = 'system' }) {
  const existing = await prisma.appointmentSchedule.findUnique({
    where: { id: appointmentId },
    include: appointmentDetailInclude,
  });

  if (!existing || !['CONFIRMED', 'RESCHEDULED'].includes(existing.status)) {
    return null;
  }

  const appointment = await prisma.$transaction(async (tx) => {
    await tx.appointmentSchedule.update({
      where: { id: existing.id },
      data: {
        status: 'MISSED',
        missedFollowUpSent: false,
        missedFollowUpSentAt: null,
        missedFollowUpLockedAt: null,
        notes: notes || existing.notes,
      },
    });

    await createActivityLogTx(tx, {
      workspaceId: existing.workspaceId,
      appointmentId: existing.id,
      actionType: APPOINTMENT_ACTIVITY_ACTIONS.MARKED_MISSED,
      actionBy,
      previousStatus: existing.status,
      newStatus: 'MISSED',
      notes,
    });

    return tx.appointmentSchedule.findUnique({
      where: { id: existing.id },
      include: appointmentDetailInclude,
    });
  });

  return appointment;
}

export async function autoCompleteAppointment({ appointmentId, notes = null, actionBy = 'system' }) {
  const existing = await prisma.appointmentSchedule.findUnique({
    where: { id: appointmentId },
    include: appointmentDetailInclude,
  });

  if (!existing || !['CONFIRMED', 'RESCHEDULED'].includes(existing.status)) {
    return null;
  }

  const appointment = await prisma.$transaction(async (tx) => {
    await tx.appointmentSchedule.update({
      where: { id: existing.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        notes: notes || existing.notes,
      },
    });

    await createActivityLogTx(tx, {
      workspaceId: existing.workspaceId,
      appointmentId: existing.id,
      actionType: APPOINTMENT_ACTIVITY_ACTIONS.AUTO_COMPLETED,
      actionBy,
      previousStatus: existing.status,
      newStatus: 'COMPLETED',
      notes,
    });

    return tx.appointmentSchedule.findUnique({
      where: { id: existing.id },
      include: appointmentDetailInclude,
    });
  });

  return appointment;
}

export async function getUpcomingAppointments({ workspaceId, now = new Date() }) {
  return prisma.appointmentSchedule.findMany({
    where: {
      workspaceId,
      status: { in: ACTIVE_APPOINTMENT_STATUSES },
      scheduledAt: { gte: now },
    },
    include: appointmentSummaryInclude,
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function getTodayAppointments({ workspaceId, now = new Date() }) {
  const appointments = await prisma.appointmentSchedule.findMany({
    where: { workspaceId },
    include: appointmentSummaryInclude,
    orderBy: { scheduledAt: 'asc' },
  });

  return appointments.filter((appointment) => {
    const timezone = appointment.timezone || DEFAULT_APPOINTMENT_TIMEZONE;
    return getAppointmentLocalDayKey(appointment.scheduledAt, timezone) === getAppointmentLocalDayKey(now, timezone);
  });
}

export async function getMissedAppointments({ workspaceId, now = new Date() }) {
  const workerConfig = getAppointmentWorkerConfig();
  const missedCutoff = new Date(now.getTime() - workerConfig.missedAfterEndMs);

  return prisma.appointmentSchedule.findMany({
    where: {
      workspaceId,
      status: { in: REMINDER_TRACKING_STATUSES },
      completedAt: null,
      cancelledAt: null,
      endAt: { lte: missedCutoff },
    },
    include: appointmentSummaryInclude,
    orderBy: { endAt: 'asc' },
  });
}

export async function getMissedAppointmentsNeedingFollowUp({ workspaceIds }) {
  return prisma.appointmentSchedule.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      status: 'MISSED',
      completedAt: null,
      cancelledAt: null,
      missedFollowUpSent: false,
      missedFollowUpLockedAt: null,
    },
    include: appointmentSummaryInclude,
    orderBy: { updatedAt: 'asc' },
  });
}

export async function getAppointmentsNeeding24hReminder({ workspaceIds, now = new Date() }) {
  const workerConfig = getAppointmentWorkerConfig();
  const nextReminderCutoff = new Date(now.getTime() + workerConfig.firstReminderLeadMs);
  const reminderGraceCutoff = new Date(now.getTime() - workerConfig.reminderCatchUpMs);

  return prisma.appointmentSchedule.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      status: { in: REMINDER_TRACKING_STATUSES },
      completedAt: null,
      cancelledAt: null,
      endAt: { gt: now },
      scheduledAt: {
        gt: reminderGraceCutoff,
        lte: nextReminderCutoff,
      },
      reminder24hSent: false,
    },
    include: appointmentSummaryInclude,
    orderBy: { scheduledAt: 'asc' },
  });
}

export async function getAppointmentsNeeding1hReminder({ workspaceIds, now = new Date() }) {
  const workerConfig = getAppointmentWorkerConfig();
  const nextReminderCutoff = new Date(now.getTime() + workerConfig.secondReminderLeadMs);
  const reminderGraceCutoff = new Date(now.getTime() - workerConfig.reminderCatchUpMs);

  return prisma.appointmentSchedule.findMany({
    where: {
      workspaceId: { in: workspaceIds },
      status: { in: REMINDER_TRACKING_STATUSES },
      completedAt: null,
      cancelledAt: null,
      endAt: { gt: now },
      scheduledAt: {
        gt: reminderGraceCutoff,
        lte: nextReminderCutoff,
      },
      reminder1hSent: false,
    },
    include: appointmentSummaryInclude,
    orderBy: { scheduledAt: 'asc' },
  });
}

async function sendAppointmentOutboundMessage({ appointmentRecord, text, messageType }) {
  const appointment = appointmentRecord;

  if (!appointment) {
    throw serviceError(404, 'Appointment tidak ditemukan');
  }

  const agent = await prisma.agent.findUnique({
    where: { id: appointment.agentId },
    include: {
      appointmentAvailabilities: {
        where: { isEnabled: true },
      },
    },
  });

  if (!agent || !agentHasAssignedSkill(agent, APPOINTMENT_SCHEDULER_SKILL_KEY)) {
    throw serviceError(409, 'Agent appointment scheduler tidak aktif untuk reminder ini.');
  }

  const skillConfig = getAppointmentSchedulerConfig(agent);
  if (!skillConfig.enableReminder) {
    throw serviceError(409, 'Reminder appointment dimatikan untuk agent ini.');
  }

  if (!appointment.customer?.phoneNumber) {
    throw serviceError(409, 'Customer appointment belum memiliki nomor telepon aktif.');
  }

  const conversationResolution = await resolveAppointmentConversation(appointment);
  if (conversationResolution.error) {
    throw serviceError(503, conversationResolution.error);
  }

  const outboundResult = await handleOutbound({
    workspaceId: appointment.workspaceId,
    phoneNumber: appointment.customer.phoneNumber,
    text,
    conversationId: conversationResolution.conversation.id,
    messageRole: 'AI',
    messageType,
  });

  if (outboundResult.error) {
    throw serviceError(outboundResult.statusCode || 502, outboundResult.error);
  }

  return {
    appointment,
    conversation: conversationResolution.conversation,
    message: outboundResult.message || null,
  };
}

async function findConnectedAgentChannel(agentId, preferredType = null) {
  const baseWhere = {
    agentId,
    status: 'CONNECTED',
  };

  return prisma.channel.findFirst({
    where: preferredType ? { ...baseWhere, type: preferredType } : baseWhere,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      status: true,
    },
  });
}

async function bindConversationToConnectedChannel(conversation, appointment) {
  const preferredType = conversation?.channel?.type || conversation?.channelType || null;
  const nextChannel = await findConnectedAgentChannel(appointment.agentId, preferredType)
    || await findConnectedAgentChannel(appointment.agentId);

  if (!nextChannel) {
    return { error: 'Tidak ada channel aktif untuk agent appointment.' };
  }

  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      channelId: nextChannel.id,
      channelType: nextChannel.type,
    },
    select: {
      id: true,
      status: true,
      channelId: true,
      channelType: true,
    },
  });

  return { conversation: updatedConversation };
}

async function resolveAppointmentConversation(appointment) {
  const existingConversation = await prisma.conversation.findFirst({
    where: {
      customerId: appointment.customerId,
      agentId: appointment.agentId,
      status: { in: ['ACTIVE', 'NEEDS_ADMIN'] },
    },
    orderBy: { createdAt: 'desc' },
    select: conversationRoutingSelect,
  });

  if (existingConversation) {
    if (existingConversation.channel?.status === 'CONNECTED') {
      return {
        conversation: {
          id: existingConversation.id,
          status: existingConversation.status,
          channelId: existingConversation.channelId,
          channelType: existingConversation.channelType,
        },
      };
    }

    return bindConversationToConnectedChannel(existingConversation, appointment);
  }

  const channel = await findConnectedAgentChannel(appointment.agentId);
  if (!channel) {
    return { error: 'Tidak ada channel aktif untuk agent appointment.' };
  }

  const conversation = await prisma.conversation.create({
    data: {
      customerId: appointment.customerId,
      agentId: appointment.agentId,
      channelId: channel.id,
      channelType: channel.type,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      status: true,
      channelId: true,
      channelType: true,
    },
  });

  return { conversation };
}

export async function sendAppointmentReminder({ appointmentId, reminderWindow = '24h' }) {
  const appointment = typeof appointmentId === 'string'
    ? await prisma.appointmentSchedule.findUnique({
      where: { id: appointmentId },
      include: appointmentSummaryInclude,
    })
    : appointmentId;

  if (!appointment) {
    throw serviceError(404, 'Appointment tidak ditemukan');
  }

  return sendAppointmentOutboundMessage({
    appointmentRecord: appointment,
    text: buildAppointmentReminderMessage(appointment, reminderWindow),
    messageType: 'appointment_reminder',
  });
}

export async function sendAppointmentMissedFollowUp({ appointmentId }) {
  const appointment = await prisma.appointmentSchedule.findUnique({
    where: { id: appointmentId },
    include: appointmentSummaryInclude,
  });

  if (!appointment) {
    throw serviceError(404, 'Appointment tidak ditemukan');
  }

  if (appointment.status !== 'MISSED') {
    throw serviceError(409, 'Follow-up missed hanya dapat dikirim untuk appointment MISSED.');
  }

  return sendAppointmentOutboundMessage({
    appointmentRecord: appointment,
    text: buildAppointmentMissedFollowUpMessage(appointment),
    messageType: 'appointment_missed_follow_up',
  });
}

export async function claimMissedFollowUp({ appointmentId }) {
  const claimedAt = new Date();

  const result = await prisma.appointmentSchedule.updateMany({
    where: {
      id: appointmentId,
      status: 'MISSED',
      completedAt: null,
      cancelledAt: null,
      missedFollowUpSent: false,
      missedFollowUpLockedAt: null,
    },
    data: {
      missedFollowUpLockedAt: claimedAt,
    },
  });

  if (result.count === 0) {
    return null;
  }

  return prisma.appointmentSchedule.findUnique({
    where: { id: appointmentId },
    include: appointmentDetailInclude,
  });
}

export async function releaseMissedFollowUpClaim({ appointmentId }) {
  await prisma.appointmentSchedule.updateMany({
    where: {
      id: appointmentId,
      missedFollowUpSent: false,
    },
    data: {
      missedFollowUpLockedAt: null,
    },
  });
}

export async function markMissedFollowUpSent({ appointmentId, actionBy = 'system' }) {
  const existing = await prisma.appointmentSchedule.findUnique({
    where: { id: appointmentId },
    include: appointmentDetailInclude,
  });

  if (!existing || existing.status !== 'MISSED' || existing.missedFollowUpSent) {
    return null;
  }

  const sentAt = new Date();

  const appointment = await prisma.$transaction(async (tx) => {
    await tx.appointmentSchedule.update({
      where: { id: existing.id },
      data: {
        missedFollowUpSent: true,
        missedFollowUpSentAt: sentAt,
        missedFollowUpLockedAt: null,
      },
    });

    await createActivityLogTx(tx, {
      workspaceId: existing.workspaceId,
      appointmentId: existing.id,
      actionType: APPOINTMENT_ACTIVITY_ACTIONS.MISSED_FOLLOWUP_SENT,
      actionBy,
      previousStatus: existing.status,
      newStatus: existing.status,
      notes: null,
    });

    return tx.appointmentSchedule.findUnique({
      where: { id: existing.id },
      include: appointmentDetailInclude,
    });
  });

  return appointment;
}

export async function markReminderSent({ appointmentId, reminderWindow = '24h', actionBy = 'system' }) {
  const existing = await prisma.appointmentSchedule.findUnique({
    where: { id: appointmentId },
    include: appointmentDetailInclude,
  });

  if (!existing) {
    return null;
  }

  const data = reminderWindow === '1h'
    ? { reminder1hSent: true }
    : { reminder24hSent: true };
  const actionType = reminderWindow === '1h'
    ? APPOINTMENT_ACTIVITY_ACTIONS.REMINDER_1H
    : APPOINTMENT_ACTIVITY_ACTIONS.REMINDER_24H;

  const appointment = await prisma.$transaction(async (tx) => {
    await tx.appointmentSchedule.update({
      where: { id: existing.id },
      data,
    });

    await createActivityLogTx(tx, {
      workspaceId: existing.workspaceId,
      appointmentId: existing.id,
      actionType,
      actionBy,
      previousStatus: existing.status,
      newStatus: existing.status,
      notes: null,
    });

    return tx.appointmentSchedule.findUnique({
      where: { id: existing.id },
      include: appointmentDetailInclude,
    });
  });

  return appointment;
}

export async function syncAgentAppointmentAvailability({ workspaceId, agentId, config }) {
  const rows = config
    ? buildAvailabilityRowsFromConfig({ workspaceId, agentId, config })
    : [];

  await prisma.$transaction(async (tx) => {
    await tx.appointmentAvailability.deleteMany({
      where: { workspaceId, agentId },
    });

    if (rows.length > 0) {
      await tx.appointmentAvailability.createMany({
        data: rows,
      });
    }
  });

  return rows.map(serializeAppointmentAvailability);
}

export async function isAppointmentSchedulerActiveForWorkspace(workspaceId) {
  return workspaceHasAssignedSkill(workspaceId, APPOINTMENT_SCHEDULER_SKILL_KEY);
}
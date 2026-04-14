import { getAgentSkillConfig } from './agent-config.js';

export const APPOINTMENT_SCHEDULER_SKILL_KEY = 'appointment-scheduler';
export const DEFAULT_APPOINTMENT_TIMEZONE = 'Asia/Jakarta';
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60;
export const DEFAULT_APPOINTMENT_WORKING_DAYS = [1, 2, 3, 4, 5];

export const APPOINTMENT_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'RESCHEDULED',
  'MISSED',
];

export const APPOINTMENT_TYPES = [
  'SALES_CALL',
  'DEMO',
  'CONSULTATION',
  'SUPPORT',
  'FOLLOW_UP',
  'CUSTOM',
];

export const APPOINTMENT_LOCATION_TYPES = [
  'ONLINE',
  'OFFLINE',
  'PHONE_CALL',
];

export const APPOINTMENT_ACTIVITY_ACTIONS = Object.freeze({
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  RESCHEDULED: 'RESCHEDULED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  MARKED_MISSED: 'MARKED_MISSED',
  MISSED_FOLLOWUP_SENT: 'MISSED_FOLLOWUP_SENT',
  AUTO_COMPLETED: 'AUTO_COMPLETED',
  REMINDER_24H: 'REMINDER_24H',
  REMINDER_1H: 'REMINDER_1H',
});

export const APPOINTMENT_EVENT_MAP = Object.freeze({
  created: 'appointment.created',
  updated: 'appointment.updated',
  rescheduled: 'appointment.rescheduled',
  cancelled: 'appointment.cancelled',
  completed: 'appointment.completed',
  missed: 'appointment.missed',
  reminder24h: 'appointment.reminder-24h',
  reminder1h: 'appointment.reminder-1h',
});

export const DEFAULT_APPOINTMENT_SCHEDULER_CONFIG = Object.freeze({
  enableBooking: true,
  enableReschedule: true,
  enableCancellation: true,
  enableReminder: true,
  enableAutoSuggestSlot: true,
  defaultMeetingDuration: DEFAULT_APPOINTMENT_DURATION_MINUTES,
  workingHoursStart: '09:00',
  workingHoursEnd: '17:00',
  workingDays: DEFAULT_APPOINTMENT_WORKING_DAYS,
  timezone: DEFAULT_APPOINTMENT_TIMEZONE,
});

const WEEKDAY_INDEX = Object.freeze({
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
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

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function normalizeAppointmentStatus(value, fallback = 'PENDING') {
  const normalized = String(value || '').trim().toUpperCase();
  return APPOINTMENT_STATUSES.includes(normalized) ? normalized : fallback;
}

export function normalizeAppointmentType(value, fallback = 'CUSTOM') {
  const normalized = String(value || '').trim().toUpperCase();
  return APPOINTMENT_TYPES.includes(normalized) ? normalized : fallback;
}

export function normalizeAppointmentLocationType(value, fallback = 'ONLINE') {
  const normalized = String(value || '').trim().toUpperCase();
  return APPOINTMENT_LOCATION_TYPES.includes(normalized) ? normalized : fallback;
}

export function normalizeTimeString(value, fallback = '09:00') {
  const normalized = String(value || '').trim();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) {
    return fallback;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2] || '00');
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) {
    return fallback;
  }
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return fallback;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function timeStringToMinutes(value, fallback = 0) {
  const normalized = normalizeTimeString(value, null);
  if (!normalized) {
    return fallback;
  }

  const [hours, minutes] = normalized.split(':').map(Number);
  return (hours * 60) + minutes;
}

export function normalizeAppointmentDuration(value, fallback = DEFAULT_APPOINTMENT_DURATION_MINUTES) {
  const numericValue = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(480, Math.max(15, numericValue));
}

export function normalizeWorkingDays(value, fallback = DEFAULT_APPOINTMENT_WORKING_DAYS) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const normalized = [...new Set(source
    .map((entry) => Number.parseInt(String(entry), 10))
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6))]
    .sort((left, right) => left - right);

  return normalized.length > 0 ? normalized : [...fallback];
}

export function normalizeAppointmentSchedulerConfig(value = {}) {
  const raw = asPlainObject(value);
  const workingHoursStart = normalizeTimeString(raw.workingHoursStart, DEFAULT_APPOINTMENT_SCHEDULER_CONFIG.workingHoursStart);
  const workingHoursEnd = normalizeTimeString(raw.workingHoursEnd, DEFAULT_APPOINTMENT_SCHEDULER_CONFIG.workingHoursEnd);
  const timezone = normalizeOptionalText(raw.timezone) || DEFAULT_APPOINTMENT_TIMEZONE;

  const startMinutes = timeStringToMinutes(workingHoursStart, 9 * 60);
  const endMinutes = Math.max(startMinutes + 15, timeStringToMinutes(workingHoursEnd, 17 * 60));

  return {
    enableBooking: normalizeBoolean(raw.enableBooking, DEFAULT_APPOINTMENT_SCHEDULER_CONFIG.enableBooking),
    enableReschedule: normalizeBoolean(raw.enableReschedule, DEFAULT_APPOINTMENT_SCHEDULER_CONFIG.enableReschedule),
    enableCancellation: normalizeBoolean(raw.enableCancellation, DEFAULT_APPOINTMENT_SCHEDULER_CONFIG.enableCancellation),
    enableReminder: normalizeBoolean(raw.enableReminder, DEFAULT_APPOINTMENT_SCHEDULER_CONFIG.enableReminder),
    enableAutoSuggestSlot: normalizeBoolean(raw.enableAutoSuggestSlot, DEFAULT_APPOINTMENT_SCHEDULER_CONFIG.enableAutoSuggestSlot),
    defaultMeetingDuration: normalizeAppointmentDuration(
      raw.defaultMeetingDuration,
      DEFAULT_APPOINTMENT_SCHEDULER_CONFIG.defaultMeetingDuration,
    ),
    workingHoursStart,
    workingHoursEnd: `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`,
    workingDays: normalizeWorkingDays(raw.workingDays),
    timezone,
  };
}

export function getAppointmentSchedulerConfig(agentOrConfig) {
  return normalizeAppointmentSchedulerConfig(
    getAgentSkillConfig(agentOrConfig, APPOINTMENT_SCHEDULER_SKILL_KEY)
      || agentOrConfig?.appointmentSchedulerConfig
      || agentOrConfig?.appointmentScheduler
      || {},
  );
}

export function getAppointmentWorkerConfig() {
  const devMode = normalizeBoolean(process.env.APPOINTMENT_DEV_MODE, false);
  const sendMissedFollowUp = normalizeBoolean(process.env.APPOINTMENT_SEND_MISSED_FOLLOW_UP, true);

  return {
    devMode,
    sendMissedFollowUp,
    firstReminderLeadMs: devMode ? 2 * 60 * 1000 : 24 * 60 * 60 * 1000,
    secondReminderLeadMs: devMode ? 60 * 1000 : 60 * 60 * 1000,
    reminderCatchUpMs: devMode ? 90 * 1000 : 5 * 60 * 1000,
    missedAfterEndMs: devMode ? 60 * 1000 : 0,
    autoCompleteAfterMs: devMode ? 10 * 60 * 1000 : 2 * 60 * 60 * 1000,
  };
}

export function addMinutes(dateInput, minutesToAdd) {
  const date = new Date(dateInput);
  return new Date(date.getTime() + (minutesToAdd * 60_000));
}

export function inferAppointmentEndAt(scheduledAt, durationMinutes = DEFAULT_APPOINTMENT_DURATION_MINUTES) {
  return addMinutes(scheduledAt, normalizeAppointmentDuration(durationMinutes));
}

export function getAppointmentEventName(action = 'updated') {
  const normalized = String(action || 'updated').trim();
  return APPOINTMENT_EVENT_MAP[normalized] || APPOINTMENT_EVENT_MAP.updated;
}

export function serializeAppointmentAvailability(availability) {
  if (!availability) return null;

  return {
    id: availability.id,
    workspaceId: availability.workspaceId,
    agentId: availability.agentId,
    dayOfWeek: Number(availability.dayOfWeek),
    startHour: availability.startHour,
    endHour: availability.endHour,
    timezone: availability.timezone,
    isEnabled: Boolean(availability.isEnabled),
    createdAt: availability.createdAt,
    updatedAt: availability.updatedAt,
  };
}

export function serializeAppointmentActivityLog(log) {
  if (!log) return null;

  return {
    id: log.id,
    workspaceId: log.workspaceId,
    appointmentId: log.appointmentId,
    actionType: log.actionType,
    actionBy: log.actionBy,
    previousStatus: log.previousStatus || null,
    newStatus: log.newStatus || null,
    notes: log.notes || null,
    createdAt: log.createdAt,
  };
}

export function serializeAppointment(appointment) {
  if (!appointment) return null;

  return {
    id: appointment.id,
    workspaceId: appointment.workspaceId,
    agentId: appointment.agentId,
    customerId: appointment.customerId,
    title: appointment.title,
    description: appointment.description || null,
    appointmentType: appointment.appointmentType,
    status: appointment.status,
    scheduledAt: appointment.scheduledAt,
    endAt: appointment.endAt,
    timezone: appointment.timezone,
    locationType: appointment.locationType,
    meetingLink: appointment.meetingLink || null,
    physicalLocation: appointment.physicalLocation || null,
    notes: appointment.notes || null,
    reminder24hSent: Boolean(appointment.reminder24hSent),
    reminder1hSent: Boolean(appointment.reminder1hSent),
    missedFollowUpSent: Boolean(appointment.missedFollowUpSent),
    missedFollowUpSentAt: appointment.missedFollowUpSentAt || null,
    missedFollowUpLockedAt: appointment.missedFollowUpLockedAt || null,
    cancelledAt: appointment.cancelledAt || null,
    completedAt: appointment.completedAt || null,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
    customer: appointment.customer
      ? {
        id: appointment.customer.id,
        name: appointment.customer.name || null,
        phoneNumber: appointment.customer.phoneNumber || null,
        isBlocked: Boolean(appointment.customer.isBlocked),
        isArchived: Boolean(appointment.customer.isArchived),
      }
      : null,
    agent: appointment.agent
      ? {
        id: appointment.agent.id,
        name: appointment.agent.name,
        status: appointment.agent.status,
      }
      : null,
    activityLogs: Array.isArray(appointment.activityLogs)
      ? appointment.activityLogs.map(serializeAppointmentActivityLog)
      : [],
  };
}

export function buildAppointmentRealtimePayload(action, appointment, extra = {}) {
  return {
    action,
    workspaceId: appointment?.workspaceId || extra.workspaceId || null,
    appointment: serializeAppointment(appointment),
    ...extra,
  };
}

function getDatePartsInTimezone(dateInput, timezone = DEFAULT_APPOINTMENT_TIMEZONE) {
  const date = new Date(dateInput);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== 'literal') {
      accumulator[part.type] = part.value;
    }
    return accumulator;
  }, {});

  return {
    weekday: WEEKDAY_INDEX[String(parts.weekday || '').trim().toLowerCase()] ?? 0,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function getAppointmentLocalDayKey(dateInput, timezone = DEFAULT_APPOINTMENT_TIMEZONE) {
  const parts = getDatePartsInTimezone(dateInput, timezone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function getAppointmentDayOfWeek(dateInput, timezone = DEFAULT_APPOINTMENT_TIMEZONE) {
  return getDatePartsInTimezone(dateInput, timezone).weekday;
}

export function getAppointmentMinutesOfDay(dateInput, timezone = DEFAULT_APPOINTMENT_TIMEZONE) {
  const parts = getDatePartsInTimezone(dateInput, timezone);
  return (parts.hour * 60) + parts.minute;
}

export function appointmentFitsAvailability({ scheduledAt, endAt, availability }) {
  if (!availability?.isEnabled) {
    return false;
  }

  const timezone = availability.timezone || DEFAULT_APPOINTMENT_TIMEZONE;
  const startDayKey = getAppointmentLocalDayKey(scheduledAt, timezone);
  const endDayKey = getAppointmentLocalDayKey(endAt, timezone);
  if (startDayKey !== endDayKey) {
    return false;
  }

  const appointmentDayOfWeek = getAppointmentDayOfWeek(scheduledAt, timezone);
  if (appointmentDayOfWeek !== Number(availability.dayOfWeek)) {
    return false;
  }

  const appointmentStartMinutes = getAppointmentMinutesOfDay(scheduledAt, timezone);
  const appointmentEndMinutes = getAppointmentMinutesOfDay(endAt, timezone);
  const availabilityStartMinutes = timeStringToMinutes(availability.startHour, 0);
  const availabilityEndMinutes = timeStringToMinutes(availability.endHour, 24 * 60);

  return appointmentStartMinutes >= availabilityStartMinutes && appointmentEndMinutes <= availabilityEndMinutes;
}

export function buildAvailabilityRowsFromConfig({ workspaceId, agentId, config }) {
  const normalizedConfig = normalizeAppointmentSchedulerConfig(config);
  return normalizedConfig.workingDays.map((dayOfWeek) => ({
    workspaceId,
    agentId,
    dayOfWeek,
    startHour: normalizedConfig.workingHoursStart,
    endHour: normalizedConfig.workingHoursEnd,
    timezone: normalizedConfig.timezone,
    isEnabled: true,
  }));
}

export function buildAppointmentReminderMessage(appointment, reminderWindow = '24h') {
  const customerName = appointment?.customer?.name || 'Pelanggan';
  const workerConfig = getAppointmentWorkerConfig();
  const whenLabel = reminderWindow === '1h'
    ? (workerConfig.devMode ? 'kurang dari 1 menit lagi' : 'kurang dari 1 jam lagi')
    : (workerConfig.devMode ? 'kurang dari 2 menit lagi' : 'kurang dari 24 jam lagi');
  const locationLabel = appointment?.locationType === 'ONLINE'
    ? `Link meeting: ${appointment?.meetingLink || '-'}`
    : appointment?.locationType === 'PHONE_CALL'
      ? 'Meeting akan dilakukan melalui telepon.'
      : `Lokasi: ${appointment?.physicalLocation || '-'}`;

  return [
    `Halo ${customerName}, ini reminder untuk appointment "${appointment?.title || 'Appointment'}" yang dijadwalkan ${whenLabel}.`,
    `Jadwal: ${new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: appointment?.timezone || DEFAULT_APPOINTMENT_TIMEZONE,
    }).format(new Date(appointment?.scheduledAt || Date.now()))}`,
    `Tipe: ${String(appointment?.appointmentType || 'CUSTOM').replaceAll('_', ' ')}`,
    locationLabel,
  ].join('\n');
}

export function buildAppointmentMissedFollowUpMessage(appointment) {
  return 'Appointment Anda terlewat. Silakan hubungi agent untuk menjadwalkan ulang.';
}

export function buildAppointmentStats(appointments = [], now = new Date()) {
  const nowDate = new Date(now);

  return appointments.reduce((stats, appointment) => {
    const status = normalizeAppointmentStatus(appointment?.status, 'PENDING');
    const scheduledAt = appointment?.scheduledAt ? new Date(appointment.scheduledAt) : null;
    const appointmentTimezone = appointment?.timezone || DEFAULT_APPOINTMENT_TIMEZONE;
    const todayKey = getAppointmentLocalDayKey(nowDate, appointmentTimezone);

    stats.total += 1;

    if (status === 'CANCELLED') stats.cancelled += 1;
    if (status === 'MISSED') stats.missed += 1;

    if (scheduledAt && scheduledAt.getTime() >= nowDate.getTime() && ['PENDING', 'CONFIRMED', 'RESCHEDULED'].includes(status)) {
      stats.upcoming += 1;
    }

    if (scheduledAt && getAppointmentLocalDayKey(scheduledAt, appointmentTimezone) === todayKey) {
      stats.today += 1;
    }

    return stats;
  }, {
    total: 0,
    today: 0,
    upcoming: 0,
    cancelled: 0,
    missed: 0,
  });
}
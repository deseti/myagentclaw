import { z } from 'zod';
import {
  APPOINTMENT_LOCATION_TYPES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
} from '../lib/appointment-scheduler.js';

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function parseDateInput(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value instanceof Date) {
    return value;
  }

  return new Date(value);
}

const optionalTextSchema = z.preprocess(normalizeOptionalText, z.string().max(2000).optional());
const optionalUrlSchema = z.preprocess(normalizeOptionalText, z.string().url().max(1000).optional());
const optionalDateSchema = z.preprocess(parseDateInput, z.date().optional());
const requiredDateSchema = z.preprocess(parseDateInput, z.date());

const appointmentStatusEnum = z.enum(APPOINTMENT_STATUSES);
const appointmentTypeEnum = z.enum(APPOINTMENT_TYPES);
const appointmentLocationTypeEnum = z.enum(APPOINTMENT_LOCATION_TYPES);

export const appointmentListQuerySchema = z.object({
  workspaceId: z.string().min(1),
  status: appointmentStatusEnum.optional(),
  agentId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  startDate: optionalDateSchema,
  endDate: optionalDateSchema,
});

export const appointmentParamsSchema = z.object({
  id: z.string().min(1),
});

export const appointmentAgentParamsSchema = z.object({
  agentId: z.string().min(1),
});

export const appointmentCustomerParamsSchema = z.object({
  customerId: z.string().min(1),
});

export const appointmentWorkspaceQuerySchema = z.object({
  workspaceId: z.string().min(1),
});

export const createAppointmentSchema = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().min(1),
  customerId: z.string().min(1),
  title: z.string().trim().min(2).max(200),
  description: optionalTextSchema,
  appointmentType: appointmentTypeEnum,
  status: appointmentStatusEnum.optional(),
  scheduledAt: requiredDateSchema,
  endAt: optionalDateSchema,
  timezone: z.string().trim().min(1).max(120).optional(),
  locationType: appointmentLocationTypeEnum,
  meetingLink: optionalUrlSchema,
  physicalLocation: optionalTextSchema,
  notes: optionalTextSchema,
}).superRefine((value, context) => {
  if (value.locationType === 'ONLINE' && !value.meetingLink) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['meetingLink'],
      message: 'meetingLink wajib diisi untuk appointment online.',
    });
  }

  if (value.locationType === 'OFFLINE' && !value.physicalLocation) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['physicalLocation'],
      message: 'physicalLocation wajib diisi untuk appointment offline.',
    });
  }
});

export const updateAppointmentSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().trim().min(2).max(200).optional(),
  description: optionalTextSchema,
  appointmentType: appointmentTypeEnum.optional(),
  status: appointmentStatusEnum.optional(),
  scheduledAt: optionalDateSchema,
  endAt: optionalDateSchema,
  timezone: z.string().trim().min(1).max(120).optional(),
  locationType: appointmentLocationTypeEnum.optional(),
  meetingLink: optionalUrlSchema,
  physicalLocation: optionalTextSchema,
  notes: optionalTextSchema,
});

export const rescheduleAppointmentSchema = z.object({
  workspaceId: z.string().min(1),
  scheduledAt: requiredDateSchema,
  endAt: optionalDateSchema,
  notes: optionalTextSchema,
});

export const cancelAppointmentSchema = z.object({
  workspaceId: z.string().min(1),
  notes: optionalTextSchema,
});

export const completeAppointmentSchema = z.object({
  workspaceId: z.string().min(1),
  completedAt: optionalDateSchema,
  notes: optionalTextSchema,
});
import {
  buildAppointmentRealtimePayload,
  getAppointmentEventName,
} from '../lib/appointment-scheduler.js';
import {
  AppointmentServiceError,
  cancelAppointment,
  completeAppointment,
  createAppointment,
  getAppointmentById,
  listAppointments,
  rescheduleAppointment,
  updateAppointment,
} from '../services/appointment.service.js';
import {
  appointmentAgentParamsSchema,
  appointmentCustomerParamsSchema,
  appointmentListQuerySchema,
  appointmentParamsSchema,
  appointmentWorkspaceQuerySchema,
  cancelAppointmentSchema,
  completeAppointmentSchema,
  createAppointmentSchema,
  rescheduleAppointmentSchema,
  updateAppointmentSchema,
} from '../validation/appointment.validation.js';

function sendValidationError(reply, parsed) {
  return reply.code(400).send({
    error: 'Validation error',
    details: parsed.error.flatten().fieldErrors,
  });
}

function sendServiceError(reply, error, fallbackMessage) {
  if (error instanceof AppointmentServiceError) {
    return reply.code(error.statusCode || 500).send({
      error: error.statusCode >= 500 ? 'Internal Server Error' : 'Request Failed',
      message: error.message,
      details: error.details,
    });
  }

  return reply.code(500).send({
    error: 'Internal Server Error',
    message: fallbackMessage,
  });
}

function emitAppointmentUpdate(request, action, appointment, extra = {}) {
  const payload = buildAppointmentRealtimePayload(action, appointment, extra);
  const eventName = getAppointmentEventName(action);

  request.server.io.to(`workspace:${appointment.workspaceId}`).emit(eventName, payload);
  request.server.io.to(`workspace:${appointment.workspaceId}`).emit('appointment:updated', payload);
}

export async function listAppointmentsHandler(request, reply) {
  const parsed = appointmentListQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const result = await listAppointments({
      ownerId: request.user.ownerId,
      workspaceId: parsed.data.workspaceId,
      status: parsed.data.status,
      agentId: parsed.data.agentId,
      customerId: parsed.data.customerId,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
    });

    return reply.send({
      appointments: result.appointments,
      stats: result.stats,
      skillStatus: result.access.skillStatus,
    });
  } catch (error) {
    request.log.error({ err: error.message }, 'Failed to list appointments');
    return sendServiceError(reply, error, 'Gagal memuat daftar appointment');
  }
}

export async function getAppointmentByIdHandler(request, reply) {
  const paramsParsed = appointmentParamsSchema.safeParse(request.params);
  if (!paramsParsed.success) {
    return sendValidationError(reply, paramsParsed);
  }

  const queryParsed = appointmentWorkspaceQuerySchema.safeParse(request.query);
  if (!queryParsed.success) {
    return sendValidationError(reply, queryParsed);
  }

  try {
    const result = await getAppointmentById({
      ownerId: request.user.ownerId,
      workspaceId: queryParsed.data.workspaceId,
      appointmentId: paramsParsed.data.id,
    });

    return reply.send({
      appointment: result.serializedAppointment,
      skillStatus: result.access.skillStatus,
    });
  } catch (error) {
    request.log.error({ err: error.message, appointmentId: request.params?.id }, 'Failed to load appointment detail');
    return sendServiceError(reply, error, 'Gagal memuat detail appointment');
  }
}

export async function createAppointmentHandler(request, reply) {
  const parsed = createAppointmentSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const result = await createAppointment({
      ownerId: request.user.ownerId,
      input: parsed.data,
      actionBy: request.user.ownerId,
    });

    emitAppointmentUpdate(request, 'created', result.appointment);

    return reply.code(201).send({
      message: 'Appointment berhasil dibuat',
      appointment: result.serializedAppointment,
      skillStatus: result.access.skillStatus,
    });
  } catch (error) {
    request.log.error({ err: error.message }, 'Failed to create appointment');
    return sendServiceError(reply, error, 'Gagal membuat appointment');
  }
}

export async function updateAppointmentHandler(request, reply) {
  const paramsParsed = appointmentParamsSchema.safeParse(request.params);
  if (!paramsParsed.success) {
    return sendValidationError(reply, paramsParsed);
  }

  const parsed = updateAppointmentSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const result = await updateAppointment({
      ownerId: request.user.ownerId,
      appointmentId: paramsParsed.data.id,
      input: parsed.data,
      actionBy: request.user.ownerId,
    });

    emitAppointmentUpdate(request, 'updated', result.appointment);

    return reply.send({
      message: 'Appointment berhasil diupdate',
      appointment: result.serializedAppointment,
      skillStatus: result.access.skillStatus,
    });
  } catch (error) {
    request.log.error({ err: error.message, appointmentId: request.params?.id }, 'Failed to update appointment');
    return sendServiceError(reply, error, 'Gagal mengupdate appointment');
  }
}

export async function rescheduleAppointmentHandler(request, reply) {
  const paramsParsed = appointmentParamsSchema.safeParse(request.params);
  if (!paramsParsed.success) {
    return sendValidationError(reply, paramsParsed);
  }

  const parsed = rescheduleAppointmentSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const result = await rescheduleAppointment({
      ownerId: request.user.ownerId,
      appointmentId: paramsParsed.data.id,
      input: parsed.data,
      actionBy: request.user.ownerId,
    });

    emitAppointmentUpdate(request, 'rescheduled', result.appointment);

    return reply.send({
      message: 'Appointment berhasil dijadwalkan ulang',
      appointment: result.serializedAppointment,
      skillStatus: result.access.skillStatus,
    });
  } catch (error) {
    request.log.error({ err: error.message, appointmentId: request.params?.id }, 'Failed to reschedule appointment');
    return sendServiceError(reply, error, 'Gagal menjadwalkan ulang appointment');
  }
}

export async function cancelAppointmentHandler(request, reply) {
  const paramsParsed = appointmentParamsSchema.safeParse(request.params);
  if (!paramsParsed.success) {
    return sendValidationError(reply, paramsParsed);
  }

  const parsed = cancelAppointmentSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const result = await cancelAppointment({
      ownerId: request.user.ownerId,
      appointmentId: paramsParsed.data.id,
      input: parsed.data,
      actionBy: request.user.ownerId,
    });

    emitAppointmentUpdate(request, 'cancelled', result.appointment);

    return reply.send({
      message: 'Appointment berhasil dibatalkan',
      appointment: result.serializedAppointment,
      skillStatus: result.access.skillStatus,
    });
  } catch (error) {
    request.log.error({ err: error.message, appointmentId: request.params?.id }, 'Failed to cancel appointment');
    return sendServiceError(reply, error, 'Gagal membatalkan appointment');
  }
}

export async function completeAppointmentHandler(request, reply) {
  const paramsParsed = appointmentParamsSchema.safeParse(request.params);
  if (!paramsParsed.success) {
    return sendValidationError(reply, paramsParsed);
  }

  const parsed = completeAppointmentSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const result = await completeAppointment({
      ownerId: request.user.ownerId,
      appointmentId: paramsParsed.data.id,
      input: parsed.data,
      actionBy: request.user.ownerId,
    });

    emitAppointmentUpdate(request, 'completed', result.appointment);

    return reply.send({
      message: 'Appointment berhasil diselesaikan',
      appointment: result.serializedAppointment,
      skillStatus: result.access.skillStatus,
    });
  } catch (error) {
    request.log.error({ err: error.message, appointmentId: request.params?.id }, 'Failed to complete appointment');
    return sendServiceError(reply, error, 'Gagal menyelesaikan appointment');
  }
}

export async function listAppointmentsByAgentHandler(request, reply) {
  const paramsParsed = appointmentAgentParamsSchema.safeParse(request.params);
  if (!paramsParsed.success) {
    return sendValidationError(reply, paramsParsed);
  }

  const queryParsed = appointmentListQuerySchema.safeParse({
    ...request.query,
    agentId: paramsParsed.data.agentId,
  });
  if (!queryParsed.success) {
    return sendValidationError(reply, queryParsed);
  }

  try {
    const result = await listAppointments({
      ownerId: request.user.ownerId,
      workspaceId: queryParsed.data.workspaceId,
      status: queryParsed.data.status,
      agentId: paramsParsed.data.agentId,
      customerId: queryParsed.data.customerId,
      startDate: queryParsed.data.startDate,
      endDate: queryParsed.data.endDate,
    });

    return reply.send({
      appointments: result.appointments,
      stats: result.stats,
      skillStatus: result.access.skillStatus,
    });
  } catch (error) {
    request.log.error({ err: error.message, agentId: request.params?.agentId }, 'Failed to list appointments by agent');
    return sendServiceError(reply, error, 'Gagal memuat appointment agent');
  }
}

export async function listAppointmentsByCustomerHandler(request, reply) {
  const paramsParsed = appointmentCustomerParamsSchema.safeParse(request.params);
  if (!paramsParsed.success) {
    return sendValidationError(reply, paramsParsed);
  }

  const queryParsed = appointmentListQuerySchema.safeParse({
    ...request.query,
    customerId: paramsParsed.data.customerId,
  });
  if (!queryParsed.success) {
    return sendValidationError(reply, queryParsed);
  }

  try {
    const result = await listAppointments({
      ownerId: request.user.ownerId,
      workspaceId: queryParsed.data.workspaceId,
      status: queryParsed.data.status,
      agentId: queryParsed.data.agentId,
      customerId: paramsParsed.data.customerId,
      startDate: queryParsed.data.startDate,
      endDate: queryParsed.data.endDate,
    });

    return reply.send({
      appointments: result.appointments,
      stats: result.stats,
      skillStatus: result.access.skillStatus,
    });
  } catch (error) {
    request.log.error({ err: error.message, customerId: request.params?.customerId }, 'Failed to list appointments by customer');
    return sendServiceError(reply, error, 'Gagal memuat appointment customer');
  }
}
import { authenticate } from '../middleware/auth.middleware.js';
import {
  cancelAppointmentHandler,
  completeAppointmentHandler,
  createAppointmentHandler,
  getAppointmentByIdHandler,
  listAppointmentsByAgentHandler,
  listAppointmentsByCustomerHandler,
  listAppointmentsHandler,
  rescheduleAppointmentHandler,
  updateAppointmentHandler,
} from '../controllers/appointment.controller.js';

export default async function appointmentRoute(fastify) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/', listAppointmentsHandler);
  fastify.get('/agent/:agentId', listAppointmentsByAgentHandler);
  fastify.get('/customer/:customerId', listAppointmentsByCustomerHandler);
  fastify.get('/:id', getAppointmentByIdHandler);
  fastify.post('/', createAppointmentHandler);
  fastify.put('/:id', updateAppointmentHandler);
  fastify.post('/:id/reschedule', rescheduleAppointmentHandler);
  fastify.post('/:id/cancel', cancelAppointmentHandler);
  fastify.post('/:id/complete', completeAppointmentHandler);
}
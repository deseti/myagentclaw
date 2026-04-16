import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';

import { Server as SocketIOServer } from 'socket.io';
import prisma from './lib/prisma.js';
import { validateAiProviderConfig } from './lib/ai-provider-config.js';
import { syncAgentToGateway } from './lib/agent-provisioner.js';

// ---------------------------------------------------------------------------
// Init Fastify dengan Pino logger
// ---------------------------------------------------------------------------
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
});

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------
await fastify.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
});

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET,
  sign: { expiresIn: '24h' },
});

// ---------------------------------------------------------------------------
// Decorator: verifikasi JWT token (dipakai di protected routes)
// ---------------------------------------------------------------------------
fastify.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized', message: 'Token tidak valid atau sudah expired' });
  }
});

// ---------------------------------------------------------------------------
// Decorator: verifikasi x-internal-key header (dipakai di internal routes)
// ---------------------------------------------------------------------------
fastify.decorate('authenticateInternal', async function (request, reply) {
  const allowKnowledgeQueryKey =
    request.method === 'GET'
    && request.raw.url?.startsWith('/internal/knowledge/')
    && typeof request.query?.internal_key === 'string';
  const key = request.headers['x-internal-key'] || (allowKnowledgeQueryKey ? request.query.internal_key : undefined);
  if (!key || key !== process.env.INTERNAL_SECRET_KEY) {
    reply.code(403).send({ error: 'Forbidden', message: 'Internal key tidak valid' });
  }
});

// ---------------------------------------------------------------------------
// Routes — public & protected (prefix: /api)
// ---------------------------------------------------------------------------
await fastify.register(async (app) => {
  const { default: authRoute } = await import('./routes/auth.route.js');
  const { default: agentRoute } = await import('./routes/agent.route.js');
  const { default: knowledgeRoute } = await import('./routes/knowledge.route.js');
  const { default: customerRoute } = await import('./routes/customer.route.js');
  const { default: billingRoute } = await import('./routes/billing.route.js');
  const { default: channelRoute } = await import('./routes/channel.route.js');
  const { default: webhookRoute } = await import('./routes/webhook.route.js');
  const { default: conversationRoute } = await import('./routes/conversation.route.js');
  const { default: dashboardRoute } = await import('./routes/dashboard.route.js');
  const { default: appointmentRoute } = await import('./routes/appointments.route.js');
  const { default: paymentReminderRoute } = await import('./routes/payment-reminders.route.js');
  const { default: crmRoute } = await import('./routes/crm.route.js');
  const { default: broadcastCampaignRoute } = await import('./routes/broadcast-campaign.route.js');
  const { default: polymarketRoute } = await import('./routes/polymarket.route.js');
  const { default: polymarketAutopilotRoute } = await import('./routes/polymarket-autopilot.route.js');
  const { default: skillsRoute } = await import('./routes/skills.route.js');

  app.register(authRoute, { prefix: '/auth' });
  app.register(agentRoute, { prefix: '/agents' });
  app.register(knowledgeRoute, { prefix: '/knowledge' });
  app.register(customerRoute, { prefix: '/customers' });
  app.register(billingRoute, { prefix: '/billing' });
  app.register(channelRoute, { prefix: '/channels' });
  app.register(conversationRoute, { prefix: '/conversations' });
  app.register(dashboardRoute, { prefix: '/dashboard' });
  app.register(appointmentRoute, { prefix: '/appointments' });
  app.register(paymentReminderRoute, { prefix: '/payment-reminders' });
  app.register(crmRoute, { prefix: '/crm' });
  app.register(broadcastCampaignRoute, { prefix: '/broadcast-campaigns' });
  app.register(polymarketRoute, { prefix: '/polymarket' });
  app.register(polymarketAutopilotRoute, { prefix: '/polymarket/autopilot' });
  app.register(skillsRoute, { prefix: '/skills' });
  // Webhooks tidak butuh JWT — autentikasi via x-callback-token Xendit
  app.register(webhookRoute, { prefix: '/webhooks' });
}, { prefix: '/api' });

// ---------------------------------------------------------------------------
// Internal Routes — hanya bisa diakses dari Docker network internal (prefix: /internal)
// ---------------------------------------------------------------------------
await fastify.register(async (app) => {
  const { default: internalKnowledgeRoute } = await import('./routes/internal/knowledge.internal.js');
  const { default: internalLeadRoute } = await import('./routes/internal/lead.internal.js');
  const { default: internalFollowupRoute } = await import('./routes/internal/followup.internal.js');
  const { default: internalReminderRoute } = await import('./routes/internal/reminder.internal.js');
  const { default: internalAdminRoute } = await import('./routes/internal/admin.internal.js');
  const { default: internalQuotaRoute } = await import('./routes/internal/quota.internal.js');
  const { default: internalQuotaIncrementRoute } = await import('./routes/internal/quota-increment.internal.js');
  const { default: internalMessageRoute } = await import('./routes/internal/message.internal.js');
  const { default: internalPolymarketRoute } = await import('./routes/internal/polymarket.internal.js');
  const { default: internalPolymarketAutopilotRoute } = await import('./routes/internal/polymarket-autopilot.internal.js');

  // Semua /internal routes wajib x-internal-key
  app.addHook('preHandler', app.authenticateInternal);

  app.register(internalKnowledgeRoute, { prefix: '/knowledge' });
  app.register(internalLeadRoute, { prefix: '/lead' });
  app.register(internalFollowupRoute, { prefix: '/followup' });
  app.register(internalReminderRoute, { prefix: '/payment-reminder' });
  app.register(internalAdminRoute, { prefix: '/admin' });
  app.register(internalQuotaRoute, { prefix: '/quota' });
  app.register(internalQuotaIncrementRoute, { prefix: '/quota' });
  app.register(internalMessageRoute, { prefix: '/message' });
  app.register(internalPolymarketRoute, { prefix: '/polymarket' });
  app.register(internalPolymarketAutopilotRoute, { prefix: '/polymarket/autopilot' });
}, { prefix: '/internal' });

// ---------------------------------------------------------------------------
// Health check (tidak butuh auth)
// ---------------------------------------------------------------------------
fastify.get('/health', async () => {
  return { status: 'ok', service: 'myagentclaw-backend', timestamp: new Date().toISOString() };
});

// ---------------------------------------------------------------------------
// Socket.io — attach ke HTTP server yang sama dengan Fastify
// ---------------------------------------------------------------------------
// getIO() untuk lazy import di workers/modules yang butuh Socket.io
export function getIO() { return io; }

export const io = new SocketIOServer(fastify.server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  path: '/ws',
});

fastify.io = io;
fastify.server.io = io;

io.use((socket, next) => {
  // Verifikasi JWT saat koneksi Socket.io
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  try {
    const decoded = fastify.jwt.verify(token);
    socket.data.owner = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const { ownerId, workspaceId } = socket.data.owner;
  fastify.log.info({ ownerId, workspaceId }, 'Socket.io client connected');

  // Join room per workspace agar broadcast spesifik ke workspace
  socket.join(`workspace:${workspaceId}`);

  socket.on('disconnect', () => {
    fastify.log.info({ ownerId }, 'Socket.io client disconnected');
  });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal) {
  fastify.log.info({ signal }, 'Shutting down...');
  try {
    await fastify.close();
    await prisma.$disconnect();
    fastify.log.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    fastify.log.error(err, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Sync CONNECTED channels dari DB ke openclaw gateway saat startup
// ---------------------------------------------------------------------------
async function syncBotsToOpenclaw() {
  // openclaw mungkin masih starting — retry sampai 12x dengan jeda 5 detik (1 menit)
  const MAX_RETRIES = 12;
  const RETRY_DELAY_MS = 5000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const channels = await prisma.channel.findMany({
        where: { status: { not: 'DISCONNECTED' } },
        select: { agentId: true },
      });

      const agentIds = [...new Set(channels.map((channel) => channel.agentId).filter(Boolean))];

      for (const agentId of agentIds) {
        await syncAgentToGateway(agentId)
          .catch((err) => fastify.log.warn({ agentId }, `sync bot failed: ${err.message}`));
      }

      fastify.log.info(`openclaw sync selesai — ${agentIds.length} agent diproses`);
      return;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        fastify.log.warn(`openclaw belum siap (attempt ${attempt}/${MAX_RETRIES}), retry in ${RETRY_DELAY_MS}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw err;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3001', 10);

try {
  validateAiProviderConfig(fastify.log);
  await prisma.$connect();
  fastify.log.info('Prisma connected to database');

  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  fastify.log.info(`myagentclaw backend listening on port ${PORT}`);

  // Sync semua CONNECTED channels ke openclaw gateway
  syncBotsToOpenclaw().catch((err) => fastify.log.warn(err, 'openclaw sync failed'));

  // Start BullMQ workers (fire-and-forget imports)
  import('./queues/followup.worker.js').catch((err) => fastify.log.warn(err, 'followup-worker init failed'));
  import('./queues/reminder.worker.js').catch((err) => fastify.log.warn(err, 'reminder-worker init failed'));
  import('./queues/appointment-reminder.worker.js').catch((err) => fastify.log.warn(err, 'appointment-reminder-worker init failed'));
  import('./queues/crm-automation.worker.js').catch((err) => fastify.log.warn(err, 'crm-automation-worker init failed'));
  import('./queues/polymarket-autopilot.worker.js').catch((err) => fastify.log.warn(err, 'polymarket-autopilot-worker init failed'));
  import('./queues/broadcast-campaign.worker.js').catch((err) => fastify.log.warn(err, 'broadcast-campaign-worker init failed'));
} catch (err) {
  fastify.log.error(err, 'Failed to start server');
  await prisma.$disconnect();
  process.exit(1);
}

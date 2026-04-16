import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';

/**
 * Buat Fastify app instance yang ringan untuk testing.
 * Tidak attach Socket.io dan tidak listen ke port.
 */
export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: '*' });
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'test_jwt_secret_min_32_chars_here',
    sign: { expiresIn: '24h' },
  });

  // Decorator auth
  app.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.decorate('authenticateInternal', async function (request, reply) {
    const key = request.headers['x-internal-key'];
    if (!key || key !== process.env.INTERNAL_SECRET_KEY) {
      reply.code(403).send({ error: 'Forbidden' });
    }
  });

  // Register routes
  await app.register(async (api) => {
    const { default: authRoute } = await import('../../src/routes/auth.route.js');
    const { default: agentRoute } = await import('../../src/routes/agent.route.js');
    const { default: billingRoute } = await import('../../src/routes/billing.route.js');
    const { default: conversationRoute } = await import('../../src/routes/conversation.route.js');
    const { default: crmRoute } = await import('../../src/routes/crm.route.js');
    const { default: webhookRoute } = await import('../../src/routes/webhook.route.js');

    api.register(authRoute, { prefix: '/auth' });
    api.register(agentRoute, { prefix: '/agents' });
    api.register(billingRoute, { prefix: '/billing' });
    api.register(conversationRoute, { prefix: '/conversations' });
    api.register(crmRoute, { prefix: '/crm' });
    api.register(webhookRoute, { prefix: '/webhooks' });
  }, { prefix: '/api' });

  await app.ready();
  return app;
}

/**
 * Login sebagai owner dan return Bearer token
 */
export async function loginAs(app, email, password) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  return res.json().token;
}

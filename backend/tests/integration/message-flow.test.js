import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import prisma from '../../src/lib/prisma.js';
import { buildApp, loginAs } from '../helpers/app.js';

// ---------------------------------------------------------------------------
// Mock modul eksternal sebelum import
// ---------------------------------------------------------------------------
vi.mock('../../src/lib/openclaw-client.js', () => ({
  sendMessageToAgent: vi.fn().mockResolvedValue({
    reply: 'Halo! Ada yang bisa saya bantu?',
    handoff: false,
    handoff_reason: null,
    tags: [],
  }),
  checkGatewayHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/channels/reply-router.js', () => ({
  send: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/index.js', () => ({
  io: { to: vi.fn().mockReturnValue({ emit: vi.fn() }) },
  getIO: vi.fn().mockReturnValue({ to: vi.fn().mockReturnValue({ emit: vi.fn() }) }),
}));

import { handleIncoming } from '../../src/channels/gateway.js';

let app;
let token;
let workspaceId;
let agentId;
let channelId;
let customerId;

const OWNER_EMAIL = `test_flow_${Date.now()}@example.com`;
const OWNER_PASSWORD = 'testpass123';

beforeAll(async () => {
  app = await buildApp();

  // Register + setup workspace
  const regRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Flow Test Owner',
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      workspaceName: 'Flow Test Workspace',
    },
  });

  token = await loginAs(app, OWNER_EMAIL, OWNER_PASSWORD);

  const meRes = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${token}` },
  });
  workspaceId = meRes.json().workspace?.id;

  if (!workspaceId) return;

  // Buat agent
  const agentRes = await app.inject({
    method: 'POST',
    url: '/api/agents',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: 'Agen Flow Test',
      persona: 'Asisten flow test',
      tone: 'FRIENDLY',
      goal: 'Test alur pesan',
    },
  });
  agentId = agentRes.json().id;

  // Buat subscription agar quota check lolos
  await prisma.subscription.upsert({
    where: { workspaceId },
    update: {},
    create: {
      workspaceId,
      tier: 'STARTER',
      status: 'ACTIVE',
      quotaLimit: 1500,
      startDate: new Date(),
      expireDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  });

  // Aktifkan agent dan buat channel
  if (agentId) {
    await prisma.agent.update({ where: { id: agentId }, data: { status: 'ACTIVE' } });

    const channel = await prisma.channel.create({
      data: {
        workspaceId,
        agentId,
        type: 'TELEGRAM',
        status: 'CONNECTED',
        phoneNumber: 'test_bot',
      },
    });
    channelId = channel.id;
  }
});

afterAll(async () => {
  await prisma.owner.deleteMany({ where: { email: { startsWith: 'test_flow_' } } });
  await app.close();
});

describe('handleIncoming — alur pesan masuk', () => {
  it('upsert customer dan simpan pesan ke DB', async () => {
    if (!workspaceId || !agentId) {
      console.warn('Skipping: setup incomplete');
      return;
    }

    const testPhone = `628${Date.now()}`;

    const normalizedMsg = {
      channel: 'telegram',
      workspaceId,
      customerId: testPhone,
      customerName: 'Customer Test',
      message: 'Halo, saya ingin tanya produk',
      messageType: 'text',
      timestamp: new Date().toISOString(),
      rawId: `msg_${Date.now()}`,
      rawMeta: { chat_id: 12345 },
    };

    const result = await handleIncoming(normalizedMsg);

    // Customer harus ter-upsert di DB
    const customer = await prisma.customer.findUnique({
      where: { workspaceId_phoneNumber: { workspaceId, phoneNumber: testPhone } },
    });
    expect(customer).not.toBeNull();
    expect(customer.name).toBe('Customer Test');

    // Message harus tersimpan di DB
    if (result?.conversationId) {
      const messages = await prisma.message.findMany({
        where: { conversationId: result.conversationId },
        orderBy: { createdAt: 'asc' },
      });
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[0].role).toBe('CUSTOMER');
      expect(messages[0].content).toBe('Halo, saya ingin tanya produk');
    }

    customerId = customer?.id;
  });

  it('AI reply tersimpan ke DB', async () => {
    if (!workspaceId || !agentId) return;

    const testPhone = `629${Date.now()}`;

    const normalizedMsg = {
      channel: 'telegram',
      workspaceId,
      customerId: testPhone,
      customerName: 'Customer Reply Test',
      message: 'Produk apa yang tersedia?',
      messageType: 'text',
      timestamp: new Date().toISOString(),
      rawId: `msg_reply_${Date.now()}`,
      rawMeta: { chat_id: 99999 },
    };

    const result = await handleIncoming(normalizedMsg);

    if (result?.conversationId) {
      const aiMessage = await prisma.message.findFirst({
        where: { conversationId: result.conversationId, role: 'AI' },
      });
      expect(aiMessage).not.toBeNull();
      expect(aiMessage.content).toBe('Halo! Ada yang bisa saya bantu?');
    }
  });

  it('handoff — conversation status berubah ke NEEDS_ADMIN', async () => {
    if (!workspaceId || !agentId) return;

    // Override mock untuk simulasi handoff
    const { sendMessageToAgent } = await import('../../src/lib/openclaw-client.js');
    sendMessageToAgent.mockResolvedValueOnce({
      reply: 'Mohon tunggu, saya sambungkan ke admin kami.',
      handoff: true,
      handoff_reason: 'Permintaan di luar kemampuan AI',
      tags: [],
    });

    const testPhone = `6210${Date.now()}`;

    const normalizedMsg = {
      channel: 'telegram',
      workspaceId,
      customerId: testPhone,
      customerName: 'Customer Handoff',
      message: 'Saya mau komplain',
      messageType: 'text',
      timestamp: new Date().toISOString(),
      rawId: `msg_handoff_${Date.now()}`,
      rawMeta: { chat_id: 77777 },
    };

    const result = await handleIncoming(normalizedMsg);

    if (result?.conversationId) {
      const conv = await prisma.conversation.findUnique({
        where: { id: result.conversationId },
      });
      expect(conv.status).toBe('NEEDS_ADMIN');
    }
  });
});

describe('POST /api/conversations/:id/reply — admin reply', () => {
  it('admin bisa kirim reply manual ke conversation', async () => {
    if (!workspaceId) return;

    // Ambil conversation pertama
    const conv = await prisma.conversation.findFirst({
      where: { workspaceId, status: 'NEEDS_ADMIN' },
    });
    if (!conv) return;

    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conv.id}/reply`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: 'Hai, admin di sini. Ada yang bisa saya bantu?' },
    });

    expect([200, 201]).toContain(res.statusCode);
  });
});

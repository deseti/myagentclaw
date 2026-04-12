import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, loginAs } from '../helpers/app.js';
import prisma from '../../src/lib/prisma.js';

let app;
let token;
let workspaceId;
let createdAgentId;

const OWNER_EMAIL = `test_agent_${Date.now()}@example.com`;
const OWNER_PASSWORD = 'testpass123';

beforeAll(async () => {
  app = await buildApp();

  // Register + setup workspace
  await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      name: 'Agent Test Owner',
      email: OWNER_EMAIL,
      password: OWNER_PASSWORD,
      workspaceName: 'Agent Test Workspace',
    },
  });

  token = await loginAs(app, OWNER_EMAIL, OWNER_PASSWORD);

  // Ambil workspaceId
  const meRes = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { authorization: `Bearer ${token}` },
  });
  workspaceId = meRes.json().workspace?.id;
});

afterAll(async () => {
  await prisma.owner.deleteMany({ where: { email: { startsWith: 'test_agent_' } } });
  await app.close();
});

describe('POST /api/agents', () => {
  it('berhasil buat agent baru', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Agen Test',
        persona: 'Asisten penjualan yang ramah',
        tone: 'FRIENDLY',
        goal: 'Membantu customer mendapatkan informasi produk',
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Agen Test');
    expect(body.status).toBe('INACTIVE');
    createdAgentId = body.id;
  });

  it('gagal buat agent tanpa nama (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${token}` },
      payload: { persona: 'Tanpa nama' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('gagal tanpa token (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'Test', persona: 'test' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/agents', () => {
  it('berhasil ambil list agents', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe('PUT /api/agents/:id', () => {
  it('berhasil update agent', async () => {
    if (!createdAgentId) return;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/agents/${createdAgentId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Agen Test Updated', persona: 'Updated persona' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Agen Test Updated');
  });
});

describe('PATCH /api/agents/:id/toggle', () => {
  it('berhasil toggle status agent', async () => {
    if (!createdAgentId) return;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${createdAgentId}/toggle`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(['ACTIVE', 'INACTIVE']).toContain(res.json().status);
  });
});

describe('DELETE /api/agents/:id', () => {
  it('berhasil delete agent', async () => {
    if (!createdAgentId) return;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${createdAgentId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../helpers/app.js';
import prisma from '../../src/lib/prisma.js';
import bcrypt from 'bcrypt';

let app;
const TEST_EMAIL = `test_auth_${Date.now()}@example.com`;
const TEST_PASSWORD = 'testpass123';

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  // Cleanup: hapus owner test
  await prisma.owner.deleteMany({ where: { email: { startsWith: 'test_auth_' } } });
  await app.close();
});

describe('POST /api/auth/register', () => {
  it('berhasil register owner baru', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Test Owner',
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        workspaceName: 'Test Workspace',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
  });

  it('gagal register jika email sudah terdaftar (409)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Duplicate Owner',
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        workspaceName: 'Duplicate Workspace',
      },
    });

    expect(res.statusCode).toBe(409);
  });

  it('gagal register jika payload tidak lengkap (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'noemail' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('berhasil login dan dapat JWT token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe('string');
    expect(body.owner).toMatchObject({ email: TEST_EMAIL });
  });

  it('gagal login dengan password salah (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: TEST_EMAIL, password: 'wrongpassword' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('gagal login dengan email tidak terdaftar (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'notexist@example.com', password: TEST_PASSWORD },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  let token;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    });
    token = res.json().token;
  });

  it('berhasil akses /me dengan token valid', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe(TEST_EMAIL);
  });

  it('gagal akses /me tanpa token (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(res.statusCode).toBe(401);
  });

  it('gagal akses /me dengan token palsu (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer invalidtoken123' },
    });

    expect(res.statusCode).toBe(401);
  });
});

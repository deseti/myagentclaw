import { beforeAll, afterAll } from 'vitest';
import prisma from '../src/lib/prisma.js';

// Pastikan menggunakan test database
if (!process.env.DATABASE_URL?.includes('test')) {
  // Fallback ke test DB jika tidak diset secara eksplisit
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ||
    'postgresql://myagentclaw_user:your_strong_password_here@localhost:5432/myagentclaw_test';
}

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_min_32_chars_here';
process.env.INTERNAL_SECRET_KEY = process.env.INTERNAL_SECRET_KEY || 'test_internal_key';
process.env.POLYMARKET_CREDENTIALS_ENCRYPTION_KEY = process.env.POLYMARKET_CREDENTIALS_ENCRYPTION_KEY || 'X7Y0a5Iu0tM4vP1W0m8N8WvQFs6IJb6q2SmM4mO1Z2Y=';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.OPENCLAW_BASE_URL = process.env.OPENCLAW_BASE_URL || 'http://localhost:18789';
process.env.OPENAI_OAUTH_TOKEN = process.env.OPENAI_OAUTH_TOKEN || 'test-openai-codex-token';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-compatible-key';
process.env.OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || '';
process.env.OPENAI_MODEL = process.env.OPENAI_MODEL || 'openai-codex/gpt-5.4';
process.env.OPENAI_TEMPERATURE = process.env.OPENAI_TEMPERATURE || '0.4';
process.env.OPENAI_TOP_P = process.env.OPENAI_TOP_P || '0.95';
process.env.OPENAI_MAX_TOKENS = process.env.OPENAI_MAX_TOKENS || '200';
process.env.OPENAI_STREAM = process.env.OPENAI_STREAM || 'true';
process.env.OPENAI_REASONING = process.env.OPENAI_REASONING || 'none';

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.middleware.js';

const FREE_QUOTA_LIMIT = 100;

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  businessName: z.string().min(2).max(100),
  businessType: z.string().min(2).max(100).default('Toko Online'),
  phone: z.string().min(8).max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const googleAuthSchema = z.object({
  idToken: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
  businessName: z.string().min(2).max(100).optional(),
  businessType: z.string().min(2).max(100).optional(),
}).refine((value) => value.idToken || value.accessToken, {
  message: 'Token Google diperlukan',
  path: ['idToken'],
});

function buildWorkspacePayload(workspace) {
  if (!workspace) return null;

  return {
    id: workspace.id,
    name: workspace.name,
    businessType: workspace.businessType,
    tier: workspace.subTier,
    subscriptionStatus: workspace.subStatus,
  };
}

async function findOwnerByEmail(email) {
  return prisma.owner.findFirst({
    where: {
      email: {
        equals: email.trim(),
        mode: 'insensitive',
      },
    },
    include: {
      workspaces: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        include: { subscriptions: { take: 1, orderBy: { createdAt: 'desc' } } },
      },
    },
  });
}

async function createOwnerWithWorkspace({ name, email, passwordHash, phone, businessName, businessType }) {
  return prisma.$transaction(async (tx) => {
    const owner = await tx.owner.create({
      data: {
        name,
        email,
        passwordHash,
        phone: phone || null,
      },
    });

    await tx.workspace.create({
      data: {
        ownerId: owner.id,
        name: businessName,
        businessType,
        subTier: 'FREE',
        subStatus: 'ACTIVE',
      },
    });

    const workspace = await tx.workspace.findFirst({
      where: { ownerId: owner.id },
      orderBy: { createdAt: 'asc' },
    });

    const periodEnd = new Date();
    periodEnd.setFullYear(periodEnd.getFullYear() + 100);

    await tx.subscription.create({
      data: {
        workspaceId: workspace.id,
        tier: 'FREE',
        status: 'ACTIVE',
        quotaLimit: FREE_QUOTA_LIMIT,
        startDate: new Date(),
        expireDate: periodEnd,
        autoRenew: false,
      },
    });

    return tx.owner.findUnique({
      where: { id: owner.id },
      include: {
        workspaces: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          include: { subscriptions: { take: 1, orderBy: { createdAt: 'desc' } } },
        },
      },
    });
  });
}

async function issueAuthResponse(reply, owner) {
  const workspace = owner.workspaces[0] || null;

  const token = await reply.jwtSign({
    ownerId: owner.id,
    email: owner.email,
    workspaceId: workspace?.id || null,
  });

  return {
    token,
    owner: {
      id: owner.id,
      name: owner.name,
      email: owner.email,
    },
    workspace: buildWorkspacePayload(workspace),
  };
}

function deriveBusinessName({ businessName, name, email }) {
  const trimmedBusinessName = typeof businessName === 'string' ? businessName.trim() : '';
  if (trimmedBusinessName) return trimmedBusinessName;

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (trimmedName.length >= 2) return trimmedName;

  const localPart = String(email || '').split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (localPart && localPart.length >= 2) return localPart;

  return 'Bisnis Saya';
}

function googleAuthError(message, statusCode = 401) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function verifyGoogleIdToken(idToken) {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    throw googleAuthError('Google login belum dikonfigurasi di server.', 503);
  }

  const tokenInfoUrl = new URL('https://oauth2.googleapis.com/tokeninfo');
  tokenInfoUrl.searchParams.set('id_token', idToken);

  const response = await fetch(tokenInfoUrl);
  if (!response.ok) {
    throw googleAuthError('Token Google tidak valid.', 401);
  }

  const payload = await response.json();
  if (payload.aud !== googleClientId) {
    throw googleAuthError('Google client ID tidak cocok.', 401);
  }

  if (payload.email_verified !== 'true') {
    throw googleAuthError('Email Google belum terverifikasi.', 401);
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    throw googleAuthError('Email Google tidak tersedia.', 401);
  }

  const name = String(payload.name || payload.given_name || email.split('@')[0] || 'Pengguna Google').trim();
  return { email, name };
}

async function verifyGoogleAccessToken(accessToken) {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    throw googleAuthError('Google login belum dikonfigurasi di server.', 503);
  }

  const tokenInfoUrl = new URL('https://oauth2.googleapis.com/tokeninfo');
  tokenInfoUrl.searchParams.set('access_token', accessToken);

  const tokenInfoResponse = await fetch(tokenInfoUrl);
  if (!tokenInfoResponse.ok) {
    throw googleAuthError('Access token Google tidak valid.', 401);
  }

  const tokenInfo = await tokenInfoResponse.json();
  if (tokenInfo.aud !== googleClientId) {
    throw googleAuthError('Google client ID tidak cocok.', 401);
  }

  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!userInfoResponse.ok) {
    throw googleAuthError('Gagal mengambil profil Google.', 401);
  }

  const profile = await userInfoResponse.json();
  if (!profile.email_verified) {
    throw googleAuthError('Email Google belum terverifikasi.', 401);
  }

  const email = String(profile.email || '').trim().toLowerCase();
  if (!email) {
    throw googleAuthError('Email Google tidak tersedia.', 401);
  }

  const name = String(profile.name || profile.given_name || email.split('@')[0] || 'Pengguna Google').trim();
  return { email, name };
}

export default async function authRoute(fastify) {
  // POST /api/auth/register
  fastify.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { name, password, businessName, businessType, phone } = parsed.data;
    const email = parsed.data.email.trim().toLowerCase();

    const existing = await findOwnerByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: 'Conflict', message: 'Email sudah terdaftar' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const owner = await createOwnerWithWorkspace({
      name,
      email,
      passwordHash: hashedPassword,
      phone,
      businessName,
      businessType,
    });

    const authResponse = await issueAuthResponse(reply, owner);

    return reply.code(201).send({
      message: 'Registrasi berhasil',
      ...authResponse,
    });
  });

  // POST /api/auth/login
  fastify.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    const { password } = parsed.data;
    const email = parsed.data.email.trim().toLowerCase();

    const owner = await findOwnerByEmail(email);

    if (!owner) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Email atau password salah' });
    }

    const valid = await bcrypt.compare(password, owner.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Email atau password salah' });
    }

    return reply.send(await issueAuthResponse(reply, owner));
  });

  // POST /api/auth/google
  fastify.post('/google', async (request, reply) => {
    const parsed = googleAuthSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten().fieldErrors });
    }

    let profile;
    try {
      profile = parsed.data.idToken
        ? await verifyGoogleIdToken(parsed.data.idToken)
        : await verifyGoogleAccessToken(parsed.data.accessToken);
    } catch (error) {
      return reply.code(error.statusCode || 401).send({ error: 'Unauthorized', message: error.message });
    }

    const existing = await findOwnerByEmail(profile.email);
    if (existing) {
      const authResponse = await issueAuthResponse(reply, existing);
      return reply.send({
        message: 'Login Google berhasil',
        ...authResponse,
      });
    }

    const owner = await createOwnerWithWorkspace({
      name: profile.name,
      email: profile.email,
      passwordHash: await bcrypt.hash(randomUUID(), 10),
      phone: null,
      businessName: deriveBusinessName({
        businessName: parsed.data.businessName,
        name: profile.name,
        email: profile.email,
      }),
      businessType: parsed.data.businessType || 'Toko Online',
    });

    const authResponse = await issueAuthResponse(reply, owner);
    return reply.code(201).send({
      message: 'Registrasi Google berhasil',
      ...authResponse,
    });
  });

  // GET /api/auth/me — profil user yang sedang login
  fastify.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const { ownerId } = request.user;

    const owner = await prisma.owner.findUnique({
      where: { id: ownerId },
      include: {
        workspaces: {
          include: {
            subscriptions: { take: 1, orderBy: { createdAt: 'desc' } },
            _count: { select: { agents: true, channels: true, customers: true } },
          },
        },
      },
    });

    if (!owner) {
      return reply.code(404).send({ error: 'Not Found', message: 'User tidak ditemukan' });
    }

    const workspaces = owner.workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      businessType: ws.businessType,
      tier: ws.subTier,
      subTier: ws.subTier,
      subscriptionStatus: ws.subStatus,
      agentCount: ws._count.agents,
      channelCount: ws._count.channels,
      customerCount: ws._count.customers,
    }));

    return reply.send({
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        createdAt: owner.createdAt,
      },
      workspace: workspaces[0] || null,
      workspaces,
    });
  });
}

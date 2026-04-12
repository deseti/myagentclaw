import prisma from '../lib/prisma.js';
import {
  ocSendChannelMessage,
  sendMessageToAgent,
} from '../lib/openclaw-client.js';
import { ensureWorkspaceRuntime, resolveChannelRuntime } from '../lib/runtime-manager.js';
import {
  getCustomerPhoneChannelType,
  normalizeChannelType,
  normalizeCustomerPhone,
  stripCustomerPhonePrefix,
} from '../lib/channel-utils.js';

/** Lazy getter untuk Socket.IO instance (hindari circular import dengan index.js) */
async function getIO() {
  try {
    const { io } = await import('../index.js');
    return io;
  } catch {
    return null;
  }
}

const QUOTA_EXHAUSTED_MSG =
  'Maaf, layanan kami sedang penuh untuk bulan ini. Silakan coba lagi bulan depan atau upgrade paket Anda.';
const SUSPENDED_MSG =
  'Maaf, layanan sementara tidak tersedia. Hubungi admin untuk informasi lebih lanjut.';
const DEFAULT_LLM_MODEL = process.env.DEFAULT_LLM_MODEL || 'openai-codex/gpt-5.4';

/**
 * handleIncoming — Jalur kompatibilitas lama untuk pesan masuk.
 *
 * Inbound produksi sekarang diproses oleh OpenClaw gateway resmi.
 * Fungsi ini dipertahankan hanya sebagai fallback internal agar perilakunya
 * tetap konsisten bila masih terpanggil dari jalur lama.
 *
 * Alur:
 *  1. Cari channel + agent + workspace aktif
 *  2. Cek status subscription
 *  3. Cek quota bulan ini
 *  4. Upsert customer
 *  5. Cari atau buat conversation aktif
 *  6. Simpan pesan customer ke DB
 *  7. Load 5 pesan terakhir sebagai history
 *  8. Kirim ke runtime agent OpenClaw
 *  9. Simpan AI reply ke DB
 * 10. Increment quota usage
 * 11. Update customer.lastSeen + totalInteractions
 * 12. Handle handoff jika AI meminta
 * 13. Emit Socket.io ke dashboard (real-time)
 * 14. Kirim reply ke channel asal via OpenClaw
 *
 * @param {object} normalizedMsg
 * @param {import('fastify').FastifyInstance} [fastifyInstance]
 * @returns {Promise<{conversationId: string, reply: string}|null>}
 */
export async function handleIncoming(normalizedMsg, fastifyInstance) {
  const { workspaceId, customerId, customerName, message, channel, rawMeta } = normalizedMsg;
  const io = await getIO();
  const log = fastifyInstance?.log ?? console;
  const incomingChannelType = normalizeChannelType(channel || getCustomerPhoneChannelType(customerId), 'TELEGRAM');
  const normalizedCustomerPhone = normalizeCustomerPhone(incomingChannelType, customerId);

  // 1. Cari channel aktif + agent + workspace untuk routing
  const channelRecord = await prisma.channel.findFirst({
    where: { workspaceId, type: incomingChannelType, status: 'CONNECTED' },
    include: {
      agent: {
        include: {
          workspace: {
            include: {
              subscriptions: {
                where: { status: { not: 'EXPIRED' } },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!channelRecord?.agent) {
    log.warn({ workspaceId }, 'handleIncoming: no active channel/agent');
    return null;
  }

  const agent = channelRecord.agent;
  const workspace = agent.workspace;
  const subscription = workspace.subscriptions?.[0] ?? null;
  const runtime = await ensureWorkspaceRuntime(workspace);

  // 2. Cek subscription
  if (!subscription || ['SUSPENDED', 'EXPIRED'].includes(subscription.status)) {
    await ocSendChannelMessage(channelRecord.id, channelRecord.type, stripCustomerPhonePrefix(rawMeta.chatId), SUSPENDED_MSG, {
      replyToId: rawMeta.messageId,
    }, runtime).catch(() => {});
    return null;
  }

  // 3. Cek quota
  const now = new Date();
  const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const quotaUsage = await prisma.quotaUsage.findFirst({
    where: { workspaceId, monthYear },
    select: { usedMessages: true },
  });
  const usedMessages = quotaUsage?.usedMessages ?? 0;

  if (usedMessages >= subscription.quotaLimit) {
    await ocSendChannelMessage(channelRecord.id, channelRecord.type, stripCustomerPhonePrefix(rawMeta.chatId), QUOTA_EXHAUSTED_MSG, {
      replyToId: rawMeta.messageId,
    }, runtime).catch(() => {});
    return null;
  }

  const customer = await prisma.customer.upsert({
    where: {
      workspaceId_phoneNumber: { workspaceId, phoneNumber: normalizedCustomerPhone },
    },
    update: { name: customerName || undefined, lastSeen: now },
    create: { workspaceId, phoneNumber: normalizedCustomerPhone, name: customerName, lastSeen: now },
  });

  // 5. Cari atau buat conversation aktif
  let conversation = await prisma.conversation.findFirst({
    where: { customerId: customer.id, agentId: agent.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        customerId: customer.id,
        agentId: agent.id,
        channelId: channelRecord.id,
        channelType: channelRecord.type,
        status: 'ACTIVE',
      },
    });
  }

  // 6. Simpan pesan customer
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'CUSTOMER',
      content: message,
    },
  });

  // 7. Load 5 pesan terakhir sebagai context history (terbalik: oldest first)
  const recentMessages = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { sentAt: 'desc' },
    take: 6, // ambil 6, buang yang terakhir (pesan yang baru saja disimpan)
    select: { role: true, content: true },
  });
  const historyMessages = recentMessages
    .slice(1) // skip pesan customer yang baru saja disimpan
    .reverse()
    .map((m) => ({
      role: m.role === 'CUSTOMER' ? 'user' : 'assistant',
      content: m.content,
    }));

  // 8. Kirim ke openclaw AI agent
  let aiReply = '';
  let handoff = false;

  try {
    const agentIdForGateway = `agent-${agent.id}`;
    const sessionKey = `${workspaceId}-${normalizedCustomerPhone}`;

    const result = await sendMessageToAgent({
      agentId: agentIdForGateway,
      sessionKey,
      userMessage: message,
      model: agent.llmModel ?? DEFAULT_LLM_MODEL,
      history: historyMessages,
    });

    aiReply = result?.choices?.[0]?.message?.content?.trim() ?? '';

    // Deteksi sinyal handoff dari AI reply
    if (aiReply.includes('[HANDOFF]')) {
      handoff = true;
      aiReply = aiReply.replace('[HANDOFF]', '').trim();
    }
  } catch (err) {
    log.error(err, 'openclaw sendMessageToAgent error');
    aiReply = 'Maaf, terjadi kesalahan teknis. Silakan coba lagi dalam beberapa saat.';
  }

  if (!aiReply) {
    aiReply = 'Maaf, saya tidak dapat memproses pesan Anda saat ini.';
  }

  // 9. Simpan AI reply
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'AI',
      content: aiReply,
    },
  });

  // 10. Increment quota
  await prisma.quotaUsage.upsert({
    where: { workspaceId_monthYear: { workspaceId, monthYear } },
    update: { usedMessages: { increment: 1 } },
    create: { workspaceId, monthYear, usedMessages: 1 },
  });

  // 11. Update customer stats
  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      lastSeen: now,
      totalInteractions: { increment: 1 },
    },
  });

  // 12. Handle handoff — escalate conversation ke admin
  if (handoff) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: 'NEEDS_ADMIN' },
    });

    io?.to(`workspace:${workspaceId}`).emit('chat:handoff_needed', {
      conversationId: conversation.id,
      customerId: customer.id,
      customerName: customer.name,
      lastMessage: message,
    });
  }

  // 13. Emit pesan baru ke dashboard
  io?.to(`workspace:${workspaceId}`).emit('chat:new_message', {
    conversationId: conversation.id,
    customerId: customer.id,
    customerName: customer.name,
    role: 'AI',
    content: aiReply,
    timestamp: now.toISOString(),
  });

  // 14. Kirim reply ke channel asal
  try {
    await ocSendChannelMessage(channelRecord.id, channelRecord.type, stripCustomerPhonePrefix(rawMeta.chatId), aiReply, {
      replyToId: rawMeta.messageId,
    }, runtime);
  } catch (err) {
    log.error(err, 'openclaw outbound send error');
  }

  return { conversationId: conversation.id, reply: aiReply };
}

/**
 * handleOutbound — Kirim pesan dari backend ke customer (admin reply/follow-up).
 *
 * Dipakai oleh:
 *   - Endpoint admin reply di dashboard
 *   - BullMQ workers (FASE 8: follow-up, payment reminder)
 *
 * @param {object} params
 * @param {string} params.workspaceId
 * @param {string} params.phoneNumber     Telegram user ID (customer.phoneNumber)
 * @param {string} params.text            Teks pesan yang akan dikirim
 * @param {string} [params.conversationId] Gunakan conversation spesifik, atau cari yang aktif
 * @param {'AI'|'ADMIN'} [params.messageRole] Role message yang dicatat ke tabel messages
 * @param {string} [params.messageType] Tipe message yang dicatat ke tabel messages
 * @param {boolean} [params.allowArchived] Jika true, customer archived tetap boleh dikirimi pesan
 * @param {boolean} [params.reactivateArchived] Jika true, archived customer diaktifkan kembali saat pesan dikirim
 * @param {import('fastify').FastifyInstance} [params.fastifyInstance]
 * @returns {Promise<{ok: boolean, message?: object}|{error: string, statusCode?: number}>}
 */
export async function handleOutbound({
  workspaceId,
  phoneNumber,
  text,
  conversationId,
  messageRole = 'ADMIN',
  messageType = 'text',
  allowArchived = false,
  reactivateArchived = false,
  fastifyInstance,
}) {
  const io = await getIO();
  const log = fastifyInstance?.log ?? console;
  const outboundMessageRole = String(messageRole || 'ADMIN').toUpperCase() === 'AI' ? 'AI' : 'ADMIN';
  const outboundMessageType = String(messageType || 'text').trim() || 'text';

  // Cari customer
  const customer = await prisma.customer.findUnique({
    where: { workspaceId_phoneNumber: { workspaceId, phoneNumber } },
  });
  if (!customer) return { error: 'Customer tidak ditemukan', statusCode: 404 };
  if (customer.isBlocked) return { error: 'Customer sedang diblokir', statusCode: 409 };
  if (customer.isArchived && !allowArchived) {
    return {
      error: 'Customer sedang diarsipkan. Aktifkan kembali untuk mengirim pesan.',
      statusCode: 409,
    };
  }

  if (customer.isArchived && reactivateArchived) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { isArchived: false, archivedAt: null },
    });
    customer.isArchived = false;
  }

  // Tentukan conversation target
  let conversation;
  if (conversationId) {
    conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (conversation?.status === 'CLOSED') {
      return {
        error: 'Tidak bisa mengirim ke percakapan yang sudah ditutup.',
        statusCode: 409,
      };
    }
  } else {
    conversation = await prisma.conversation.findFirst({
      where: {
        customerId: customer.id,
        status: { in: ['ACTIVE', 'NEEDS_ADMIN'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!conversation) return { error: 'Tidak ada conversation aktif untuk customer ini', statusCode: 404 };

  const outboundChannelId = conversation.channelId || (await prisma.channel.findFirst({
    where: {
      workspaceId,
      status: 'CONNECTED',
      ...(conversation.channelType ? { type: conversation.channelType } : {}),
    },
    select: { id: true, type: true },
  }));

  const resolvedChannelId = typeof outboundChannelId === 'string' ? outboundChannelId : outboundChannelId?.id;
  const resolvedChannelType = typeof outboundChannelId === 'string' ? conversation.channelType : outboundChannelId?.type || conversation.channelType;

  if (!resolvedChannelId) {
    return { error: 'Tidak ada channel aktif untuk workspace ini', statusCode: 503 };
  }

  const runtime = await resolveChannelRuntime(resolvedChannelId);

  try {
    await ocSendChannelMessage(resolvedChannelId, resolvedChannelType || 'TELEGRAM', stripCustomerPhonePrefix(phoneNumber), text, {}, runtime);
  } catch (err) {
    log.error(err, 'handleOutbound: failed to send via OpenClaw');
    return { error: 'Gagal mengirim pesan ke channel', statusCode: 502 };
  }

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: outboundMessageRole,
      content: text,
      type: outboundMessageType,
    },
  });

  // Emit ke dashboard
  io?.to(`workspace:${workspaceId}`).emit('chat:new_message', {
    conversationId: conversation.id,
    customerId: customer.id,
    customerName: customer.name,
    role: outboundMessageRole,
    content: text,
    timestamp: message.createdAt.toISOString(),
  });

  return { ok: true, message };
}

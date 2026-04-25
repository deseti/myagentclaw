import prisma from '../lib/prisma.js';
import { syncTransactionFromInvoice } from '../lib/billing.js';

/**
 * Webhook handler untuk Xendit payment notifications.
 * Endpoint: POST /api/webhooks/xendit
 *
 * Tidak butuh JWT auth — autentikasi via x-callback-token header dari Xendit.
 * Harus didaftarkan TANPA authenticate preHandler.
 */
export default async function xenditWebhookRoute(fastify) {
  async function emitBillingPaymentSuccess({ workspaceId, payload }) {
    try {
      const { io } = await import('../index.js');
      io.to(`workspace:${workspaceId}`).emit('billing:payment_success', payload);
    } catch {
      // Non-critical
    }
  }

  fastify.post('/xendit', {
    config: { rawBody: true }, // Untuk verifikasi signature jika diperlukan
  }, async (request, reply) => {
    // Verifikasi Xendit callback token
    const callbackToken = request.headers['x-callback-token'];
    if (!callbackToken || callbackToken !== process.env.XENDIT_WEBHOOK_TOKEN) {
      fastify.log.warn({ hasCallbackToken: Boolean(callbackToken) }, 'Invalid Xendit webhook token');
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const event = request.body;
    fastify.log.info({ eventType: event?.status, externalId: event?.external_id }, 'Xendit webhook received');

    // Xendit Invoice webhook payload
    const { id: xenditInvoiceId, external_id, status, paid_amount } = event;

    if (!xenditInvoiceId || !external_id) {
      return reply.code(400).send({ error: 'Invalid webhook payload' });
    }

    // Cari transaksi berdasarkan xendit invoice ID
    const transaction = await prisma.transaction.findFirst({
      where: { xenditInvoiceId },
      include: { workspace: { include: { subscriptions: { take: 1, orderBy: { createdAt: 'desc' } } } } },
    });

    if (!transaction) {
      // Bisa jadi webhook duplikat atau invoice dari sistem lain — abaikan dengan 200
      fastify.log.warn({ xenditInvoiceId }, 'Transaction not found for Xendit invoice');
      return reply.send({ ok: true });
    }

    if (transaction.status === 'PAID') {
      // Idempoten — sudah diproses sebelumnya
      return reply.send({ ok: true });
    }

    await syncTransactionFromInvoice({
      transaction,
      invoice: {
        id: xenditInvoiceId,
        external_id,
        status,
        paid_amount,
      },
      logger: fastify.log,
      emitPaymentSuccess: emitBillingPaymentSuccess,
    });

    // Xendit expects HTTP 200 untuk konfirmasi webhook diterima
    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // POST /api/webhooks/telegram/:channelId
  // Path legacy/non-produksi.
  //
  // Dalam arsitektur saat ini, Telegram inbound ditangani langsung oleh OpenClaw
  // gateway resmi. Endpoint backend ini dipertahankan hanya agar jelas bahwa jalur
  // lama sudah tidak dipakai.
  // ---------------------------------------------------------------------------
  fastify.post('/telegram/:channelId', async (request, reply) => {
    const { channelId } = request.params;
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { workspaceId: true, status: true },
    });

    if (!channel || channel.status !== 'CONNECTED') {
      fastify.log.warn({ channelId }, 'Telegram webhook: channel not found or not connected');
      // Tetap balas 200 agar Telegram tidak retry
      return reply.send({ ok: true });
    }

    fastify.log.warn({ channelId, workspaceId: channel.workspaceId }, 'Legacy Telegram webhook hit while OpenClaw gateway should handle inbound traffic');
    return reply.code(410).send({
      ok: false,
      error: 'Legacy Telegram webhook disabled',
      message: 'Telegram inbound sekarang ditangani langsung oleh OpenClaw gateway resmi.',
    });
  });
}

import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../lib/prisma.js';
import {
  ocGenerateFollowupMessage,
  ocSendChannelMessage,
} from '../lib/openclaw-client.js';
import { resolveChannelRuntime } from '../lib/runtime-manager.js';
import { getCustomerPhoneChannelType, stripCustomerPhonePrefix } from '../lib/channel-utils.js';

// ---------------------------------------------------------------------------
// Redis connection
// ---------------------------------------------------------------------------
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // Required by BullMQ
});

// ---------------------------------------------------------------------------
// Queue — digunakan oleh internal route untuk enqueue jobs
// ---------------------------------------------------------------------------
export const followupQueue = new Queue('followup-queue', { connection });

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------
const worker = new Worker(
  'followup-queue',
  async (job) => {
    const { customer_id, workspace_id, agent_id, followup_type, conversation_id } = job.data;

    job.log(`Processing follow-up job ${job.id} for customer ${customer_id}`);

    // 1. Load customer data
    const customer = await prisma.customer.findUnique({
      where: { id: customer_id },
    });

    if (!customer) {
      job.log(`Customer ${customer_id} not found, skipping`);
      return { skipped: true, reason: 'customer_not_found' };
    }

    if (customer.isBlocked) {
      await prisma.followUp.updateMany({
        where: { customerId: customer_id, workspaceId: workspace_id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      job.log(`Customer ${customer_id} is blocked, cancelling follow-up`);
      return { skipped: true, reason: 'customer_blocked' };
    }

    if (customer.isArchived) {
      await prisma.followUp.updateMany({
        where: { customerId: customer_id, workspaceId: workspace_id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      job.log(`Customer ${customer_id} is archived, cancelling follow-up`);
      return { skipped: true, reason: 'customer_archived' };
    }

    const agent = await prisma.agent.findFirst({
      where: { id: agent_id, workspaceId: workspace_id },
      select: { id: true, status: true },
    });

    if (!agent || agent.status !== 'ACTIVE') {
      await prisma.followUp.updateMany({
        where: { customerId: customer_id, workspaceId: workspace_id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      job.log(`Agent ${agent_id} inactive, cancelling follow-up`);
      return { skipped: true, reason: 'agent_inactive' };
    }

    // 2. Cek apakah customer sudah reply sejak job dibuat
    //    Jika ada pesan dari CUSTOMER setelah job created_at, skip
    const lastCustomerMessage = await prisma.message.findFirst({
      where: {
        conversation: {
          is: {
            customerId: customer_id,
            agent: { workspaceId: workspace_id },
          },
        },
        role: 'CUSTOMER',
        createdAt: { gt: job.timestamp ? new Date(job.timestamp) : new Date(0) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (lastCustomerMessage) {
      job.log(`Customer already replied after job creation, skipping follow-up`);

      // Update follow_up record jika ada
      if (conversation_id) {
        await prisma.followUp.updateMany({
          where: { customerId: customer_id, workspaceId: workspace_id, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
      }
      return { skipped: true, reason: 'customer_already_replied' };
    }

    const conversation = conversation_id
      ? await prisma.conversation.findUnique({
        where: { id: conversation_id },
        select: { id: true, channelId: true, channelType: true },
      })
      : await prisma.conversation.findFirst({
        where: {
          customerId: customer_id,
          agent: { workspaceId: workspace_id },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, channelId: true, channelType: true },
      });

    const convId = conversation?.id || null;
    const preferredChannelType = conversation?.channelType || getCustomerPhoneChannelType(customer.phoneNumber);

    const outboundChannel = conversation?.channelId
      ? await prisma.channel.findFirst({
        where: { id: conversation.channelId, status: 'CONNECTED' },
        select: { id: true, type: true },
      })
      : null;

    const fallbackChannel = outboundChannel || await prisma.channel.findFirst({
      where: {
        agentId: agent_id,
        status: 'CONNECTED',
        ...(preferredChannelType ? { type: preferredChannelType } : {}),
      },
      select: { id: true, type: true },
    });

    const channelId = fallbackChannel?.id;
    const channelType = fallbackChannel?.type || preferredChannelType || 'TELEGRAM';

    if (!channelId) {
      await prisma.followUp.updateMany({
        where: { customerId: customer_id, workspaceId: workspace_id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      throw new Error(`Tidak ada channel aktif untuk agent ${agent_id}`);
    }

    const runtime = await resolveChannelRuntime(channelId);

    const recentMessages = convId
      ? (await prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { role: true, content: true },
      })).reverse()
      : [];

    // 3. Generate pesan follow-up via official OpenClaw gateway
    let followupMessage = null;
    let shouldSend = true;

    try {
      const generated = await ocGenerateFollowupMessage({
        channelId,
        channelType,
        agentId: agent_id,
        workspaceId: workspace_id,
        customerId: customer_id,
        customerPhone: stripCustomerPhonePrefix(customer.phoneNumber),
        customerName: customer.name || stripCustomerPhonePrefix(customer.phoneNumber),
        followupType: followup_type || 'FOLLOW_UP',
        recentMessages,
      }, runtime);

      followupMessage = generated.message || null;
      shouldSend = generated.shouldSend !== false;
    } catch (err) {
      job.log(`OpenClaw follow-up generation failed: ${err.message}, using fallback message`);
    }

    // Fallback message jika openclaw gagal
    if (!followupMessage) {
      followupMessage = `Halo ${customer.name || 'Kak'}, kami ingin menindak lanjuti percakapan kita sebelumnya. Ada yang bisa kami bantu?`;
    }

    // 4. Jika should_send false → cancel
    if (!shouldSend) {
      await prisma.followUp.updateMany({
        where: { customerId: customer_id, workspaceId: workspace_id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      job.log('OpenClaw decided not to send follow-up, cancelled');
      return { skipped: true, reason: 'openclaw_no_send' };
    }

    // 5. Kirim pesan via official OpenClaw outbound message tool
    await ocSendChannelMessage(
      channelId,
      channelType,
      stripCustomerPhonePrefix(customer.phoneNumber),
      followupMessage,
      {},
      runtime,
    );

    // 6. Update follow_up record → SENT
    await prisma.followUp.updateMany({
      where: { customerId: customer_id, workspaceId: workspace_id, status: 'PENDING' },
      data: { status: 'SENT', sentAt: new Date() },
    });

    // 7. Simpan ke messages table jika ada conversation aktif
    if (convId) {
      await prisma.message.create({
        data: {
          conversationId: convId,
          role: 'AI',
          content: followupMessage,
          type: 'followup',
          sentAt: new Date(),
        },
      });

    }

    job.log(`Follow-up sent to customer ${customer_id}`);
    return { sent: true, message: followupMessage };
  },
  {
    connection,
    concurrency: 5,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  }
);

worker.on('completed', (job, result) => {
  console.log(`[followup-worker] Job ${job.id} completed:`, result);
});

worker.on('failed', (job, err) => {
  console.error(`[followup-worker] Job ${job.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[followup-worker] Worker error:', err);
});

console.log('[followup-worker] Started and listening on followup-queue');

export default worker;

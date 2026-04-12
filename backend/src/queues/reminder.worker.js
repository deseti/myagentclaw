import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import cron from 'node-cron';
import prisma from '../lib/prisma.js';
import { handleOutbound } from '../channels/gateway.js';
import { agentHasAssignedSkill, listWorkspaceIdsWithAssignedSkill } from '../lib/skill-activation.js';
import {
  buildPaymentReminderRealtimePayload,
  getPaymentReminderEventName,
  PAYMENT_REMINDER_SKILL_KEY,
  serializePaymentReminder,
} from '../lib/payment-reminders.js';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const reminderEmitInclude = {
  customer: {
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      isBlocked: true,
      isArchived: true,
    },
  },
  agent: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  conversation: {
    select: {
      id: true,
      status: true,
      channelType: true,
    },
  },
};

export const reminderQueue = new Queue('reminder-queue', { connection });

export async function enqueuePaymentReminderDispatch({
  reminderId,
  dedupeWindowMs = 30_000,
}) {
  const bucket = Math.floor(Date.now() / dedupeWindowMs);
  return reminderQueue.add(
    'dispatch-payment-reminder',
    { reminderId },
    {
      jobId: `payment-reminder-${reminderId}-${bucket}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  );
}

async function getIO() {
  try {
    const { io } = await import('../index.js');
    return io;
  } catch {
    return null;
  }
}

async function emitReminderUpdate(reminderId, action = 'updated', extra = {}) {
  const [io, reminder] = await Promise.all([
    getIO(),
    prisma.paymentReminder.findUnique({
      where: { id: reminderId },
      include: reminderEmitInclude,
    }),
  ]);

  if (!io || !reminder) return;

  const payload = buildPaymentReminderRealtimePayload(action, reminder, extra);
  const eventName = getPaymentReminderEventName(action);

  io.to(`workspace:${reminder.workspaceId}`).emit(eventName, payload);
  io.to(`workspace:${reminder.workspaceId}`).emit('payment-reminder:updated', payload);
}

async function updateReminderStatus(reminderId, data, action, extra = {}) {
  const reminder = await prisma.paymentReminder.update({
    where: { id: reminderId },
    data,
    include: reminderEmitInclude,
  });

  await emitReminderUpdate(reminder.id, action, extra);
  return reminder;
}

async function cancelReminder(reminderId, reason) {
  console.info('[reminder-worker] dispatch:cancelled', { reminderId, reason });
  return updateReminderStatus(reminderId, {
    status: 'CANCELLED',
    lastError: reason,
    failedAt: null,
  }, 'cancelled');
}

async function failReminder(reminderId, reason) {
  console.error('[reminder-worker] dispatch:failed-state', { reminderId, reason });
  return updateReminderStatus(reminderId, {
    status: 'FAILED',
    failedAt: new Date(),
    lastError: reason,
  }, 'failed');
}

const conversationRoutingSelect = {
  id: true,
  status: true,
  channelId: true,
  channelType: true,
  channel: {
    select: {
      id: true,
      status: true,
      type: true,
    },
  },
};

async function findConnectedAgentChannel(agentId, preferredType = null) {
  const baseWhere = {
    agentId,
    status: 'CONNECTED',
  };

  return prisma.channel.findFirst({
    where: preferredType ? { ...baseWhere, type: preferredType } : baseWhere,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      status: true,
    },
  });
}

async function bindConversationToConnectedChannel(conversation, reminder) {
  const preferredType = conversation?.channel?.type || conversation?.channelType || null;
  const nextChannel = await findConnectedAgentChannel(reminder.agentId, preferredType)
    || await findConnectedAgentChannel(reminder.agentId);

  if (!nextChannel) {
    return { error: 'Tidak ada channel aktif untuk agent reminder.' };
  }

  const updatedConversation = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      channelId: nextChannel.id,
      channelType: nextChannel.type,
    },
    select: {
      id: true,
      status: true,
      channelId: true,
      channelType: true,
    },
  });

  return { conversation: updatedConversation };
}

async function resolveReminderConversation(reminder) {
  if (reminder.conversationId) {
    const linkedConversation = await prisma.conversation.findUnique({
      where: { id: reminder.conversationId },
      select: conversationRoutingSelect,
    });

    if (!linkedConversation) {
      return { error: 'Conversation reminder tidak ditemukan.' };
    }

    if (linkedConversation.status === 'CLOSED') {
      return { cancelReason: 'Conversation sudah CLOSED, reminder tidak dikirim.' };
    }

    if (linkedConversation.channel?.status === 'CONNECTED') {
      return {
        conversation: {
          id: linkedConversation.id,
          status: linkedConversation.status,
          channelId: linkedConversation.channelId,
          channelType: linkedConversation.channelType,
        },
      };
    }

    return bindConversationToConnectedChannel(linkedConversation, reminder);
  }

  const existingConversation = await prisma.conversation.findFirst({
    where: {
      customerId: reminder.customerId,
      agentId: reminder.agentId,
      status: { in: ['ACTIVE', 'NEEDS_ADMIN'] },
    },
    orderBy: { createdAt: 'desc' },
    select: conversationRoutingSelect,
  });

  if (existingConversation) {
    if (existingConversation.channel?.status === 'CONNECTED') {
      return {
        conversation: {
          id: existingConversation.id,
          status: existingConversation.status,
          channelId: existingConversation.channelId,
          channelType: existingConversation.channelType,
        },
      };
    }

    return bindConversationToConnectedChannel(existingConversation, reminder);
  }

  const channel = await findConnectedAgentChannel(reminder.agentId);

  if (!channel) {
    return { error: 'Tidak ada channel aktif untuk agent reminder.' };
  }

  const conversation = await prisma.conversation.create({
    data: {
      customerId: reminder.customerId,
      agentId: reminder.agentId,
      channelId: channel.id,
      channelType: channel.type,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      status: true,
      channelId: true,
      channelType: true,
    },
  });

  return { conversation };
}

function reminderIsDue(reminder) {
  const now = Date.now();

  if (reminder.status === 'SCHEDULED') {
    return new Date(reminder.scheduledAt).getTime() <= now;
  }

  return new Date(reminder.dueDate).getTime() <= now;
}

const worker = new Worker(
  'reminder-queue',
  async (job) => {
    const { reminderId } = job.data;
    job.log(`Processing payment reminder ${reminderId}`);

    const reminder = await prisma.paymentReminder.findUnique({
      where: { id: reminderId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            isBlocked: true,
            isArchived: true,
          },
        },
        agent: {
          select: {
            id: true,
            name: true,
            status: true,
            openclawSkill: true,
            configJson: true,
          },
        },
        conversation: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!reminder) {
      job.log(`Payment reminder ${reminderId} not found`);
      return { skipped: true, reason: 'reminder_not_found' };
    }

    console.info('[reminder-worker] dispatch:start', {
      reminderId: reminder.id,
      workspaceId: reminder.workspaceId,
      customerId: reminder.customerId,
      agentId: reminder.agentId,
      conversationId: reminder.conversationId,
      status: reminder.status,
    });

    if (['SENT', 'CANCELLED'].includes(reminder.status)) {
      job.log(`Payment reminder ${reminderId} already finalized with status ${reminder.status}`);
      return { skipped: true, reason: 'already_finalized' };
    }

    if (!reminderIsDue(reminder)) {
      job.log(`Payment reminder ${reminderId} is not due yet`);
      return { skipped: true, reason: 'not_due' };
    }

    if (!reminder.customer) {
      await failReminder(reminder.id, 'Customer reminder tidak ditemukan.');
      return { skipped: true, reason: 'customer_not_found' };
    }

    if (!reminder.customer.phoneNumber) {
      await failReminder(reminder.id, 'Customer reminder belum memiliki nomor telepon aktif.');
      return { skipped: true, reason: 'customer_phone_missing' };
    }

    if (!reminder.agent) {
      await failReminder(reminder.id, 'Agent reminder tidak ditemukan.');
      return { skipped: true, reason: 'agent_not_found' };
    }

    if (reminder.customer.isBlocked) {
      await cancelReminder(reminder.id, 'Customer blocked, reminder dibatalkan.');
      return { skipped: true, reason: 'customer_blocked' };
    }

    if (reminder.customer.isArchived) {
      await cancelReminder(reminder.id, 'Customer archived, reminder dibatalkan.');
      return { skipped: true, reason: 'customer_archived' };
    }

    if (!agentHasAssignedSkill(reminder.agent, PAYMENT_REMINDER_SKILL_KEY)) {
      await cancelReminder(reminder.id, 'Skill Payment Reminder tidak lagi aktif pada agent ini.');
      return { skipped: true, reason: 'skill_inactive' };
    }

    if (reminder.agent.status !== 'ACTIVE') {
      await failReminder(reminder.id, 'Agent reminder sedang tidak aktif.');
      return { skipped: true, reason: 'agent_inactive' };
    }

    const conversationResolution = await resolveReminderConversation(reminder);
    if (conversationResolution.cancelReason) {
      await cancelReminder(reminder.id, conversationResolution.cancelReason);
      return { skipped: true, reason: 'conversation_closed' };
    }

    if (conversationResolution.error) {
      await failReminder(reminder.id, conversationResolution.error);
      return { skipped: true, reason: 'conversation_unavailable' };
    }

    console.info('[reminder-worker] dispatch:resolved-conversation', {
      reminderId: reminder.id,
      workspaceId: reminder.workspaceId,
      customerId: reminder.customerId,
      agentId: reminder.agentId,
      conversationId: conversationResolution.conversation.id,
      channelId: conversationResolution.conversation.channelId,
      channelType: conversationResolution.conversation.channelType,
    });

    const outboundResult = await handleOutbound({
      workspaceId: reminder.workspaceId,
      phoneNumber: reminder.customer.phoneNumber,
      text: reminder.messageContent,
      conversationId: conversationResolution.conversation.id,
      messageRole: 'AI',
      messageType: 'payment_reminder',
    });

    if (outboundResult.error) {
      console.error('[reminder-worker] dispatch:failed', {
        reminderId: reminder.id,
        workspaceId: reminder.workspaceId,
        customerId: reminder.customerId,
        agentId: reminder.agentId,
        conversationId: conversationResolution.conversation.id,
        channelId: conversationResolution.conversation.channelId,
        channelType: conversationResolution.conversation.channelType,
        statusCode: outboundResult.statusCode || null,
        reason: outboundResult.error,
      });

      if (outboundResult.statusCode === 409) {
        await cancelReminder(reminder.id, outboundResult.error);
        return { skipped: true, reason: 'delivery_blocked' };
      }

      await failReminder(reminder.id, outboundResult.error);
      return { skipped: true, reason: 'delivery_failed' };
    }

    const sentReminder = await updateReminderStatus(reminder.id, {
      conversationId: conversationResolution.conversation.id,
      status: 'SENT',
      sentAt: new Date(),
      failedAt: null,
      lastError: null,
    }, 'sent', {
      delivery: {
        messageId: outboundResult.message?.id || null,
        conversationId: conversationResolution.conversation.id,
        channelId: conversationResolution.conversation.channelId,
        channelType: conversationResolution.conversation.channelType,
      },
    });

    job.log(`Payment reminder ${reminder.id} sent successfully`);
    console.info('[reminder-worker] dispatch:sent', {
      reminderId: reminder.id,
      workspaceId: reminder.workspaceId,
      customerId: reminder.customerId,
      agentId: reminder.agentId,
      conversationId: conversationResolution.conversation.id,
      channelId: conversationResolution.conversation.channelId,
      channelType: conversationResolution.conversation.channelType,
      messageId: outboundResult.message?.id || null,
    });

    return {
      sent: true,
      reminder: serializePaymentReminder(sentReminder),
    };
  },
  {
    connection,
    concurrency: 5,
  },
);

worker.on('completed', (job, result) => {
  console.log(`[reminder-worker] Job ${job.id} completed:`, result);
});

worker.on('failed', (job, err) => {
  console.error(`[reminder-worker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('[reminder-worker] Worker error:', err);
});

let reminderSchedulerBusy = false;

async function scheduleDuePaymentReminders() {
  if (reminderSchedulerBusy) return;
  reminderSchedulerBusy = true;

  try {
    const now = new Date();
    const dueReminders = await prisma.paymentReminder.findMany({
      where: {
        OR: [
          { status: 'PENDING', dueDate: { lte: now } },
          { status: 'SCHEDULED', scheduledAt: { lte: now } },
        ],
      },
      select: { id: true, workspaceId: true },
      orderBy: [
        { scheduledAt: 'asc' },
        { createdAt: 'asc' },
      ],
      take: 100,
    });

    const activeWorkspaceIds = await listWorkspaceIdsWithAssignedSkill(
      dueReminders.map((reminder) => reminder.workspaceId),
      PAYMENT_REMINDER_SKILL_KEY,
    );

    await Promise.all(dueReminders.map(async (reminder) => {
      if (!activeWorkspaceIds.has(reminder.workspaceId)) {
        return;
      }

      await enqueuePaymentReminderDispatch({ reminderId: reminder.id }).catch(() => {
        // Ignore duplicate enqueue attempts inside the dedupe window.
      });
    }));
  } finally {
    reminderSchedulerBusy = false;
  }
}

const reminderSchedulerTimer = setInterval(() => {
  scheduleDuePaymentReminders().catch((error) => {
    console.error('[reminder-worker] Scheduler error:', error.message);
  });
}, 60_000);

if (typeof reminderSchedulerTimer.unref === 'function') {
  reminderSchedulerTimer.unref();
}

cron.schedule('0 1 * * *', async () => {
  console.log('[reminder-worker] Running subscription expiry check...');

  const now = new Date();
  const thresholds = [
    { days: 7, label: '7 hari' },
    { days: 3, label: '3 hari' },
    { days: 1, label: '1 hari' },
  ];

  for (const { days, label } of thresholds) {
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + days);
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    const expiringSubs = await prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'GRACE'] },
        expireDate: { gte: dayStart, lte: dayEnd },
      },
      include: {
        workspace: true,
      },
    });

    for (const sub of expiringSubs) {
      try {
        const io = await getIO();
        if (io) {
          io.to(`workspace:${sub.workspaceId}`).emit('subscription:expiring', {
            expire_date: sub.expireDate.toISOString(),
            days_left: days,
            tier: sub.tier,
          });
        }

        console.log(`[reminder-worker] Notified workspace ${sub.workspaceId} — subscription expires in ${label}`);
      } catch (err) {
        console.error(`[reminder-worker] Failed to notify workspace ${sub.workspaceId}:`, err.message);
      }
    }
  }
});

console.log('[reminder-worker] Started and listening on reminder-queue');

export default worker;

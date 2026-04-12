import prisma from './prisma.js';

export const TIER_PRICING = {
  FREE: { price: 0, quota: 100, label: 'Free' },
  STARTER: { price: 129000, quota: 1500, label: 'Starter' },
  GROWTH: { price: 349000, quota: 5000, label: 'Growth' },
};

export const TOPUP_PRICING = {
  500: { price: 35000, label: 'Top-up 500 pesan', messages: 500 },
  1000: { price: 59000, label: 'Top-up 1.000 pesan', messages: 1000 },
  5000: { price: 249000, label: 'Top-up 5.000 pesan', messages: 5000 },
  10000: { price: 449000, label: 'Top-up 10.000 pesan', messages: 10000 },
};

export const TIER_QUOTA = {
  FREE: 100,
  STARTER: 1500,
  GROWTH: 5000,
  PRO: 15000,
};

const PAID_INVOICE_STATUSES = new Set(['PAID', 'SETTLED']);
const FAILED_INVOICE_STATUSES = new Set(['EXPIRED', 'FAILED']);

function xenditAuthHeader(xenditKey) {
  return `Basic ${Buffer.from(`${xenditKey}:`).toString('base64')}`;
}

function normalizeInvoiceStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function resolvePaidAmount(invoice, fallbackAmount) {
  return invoice?.paid_amount
    ?? invoice?.paidAmount
    ?? invoice?.amount_paid
    ?? fallbackAmount;
}

export function parsePaymentContext(externalId) {
  const parts = String(externalId || '').split('-');
  if (parts[0] !== 'myagentclaw') {
    return null;
  }

  if (parts.length === 4) {
    return {
      type: 'SUBSCRIPTION',
      workspaceId: parts[1],
      tier: parts[2],
    };
  }

  if (parts.length < 5) {
    return null;
  }

  if (parts[1] === 'subscription') {
    return {
      type: 'SUBSCRIPTION',
      workspaceId: parts[2],
      tier: parts[3],
    };
  }

  if (parts[1] === 'topup') {
    return {
      type: 'TOPUP',
      workspaceId: parts[2],
      messages: Number(parts[3]),
    };
  }

  return null;
}

export async function createXenditInvoice({ xenditKey, externalId, amount, payerEmail, description }) {
  const payload = {
    external_id: externalId,
    amount,
    payer_email: payerEmail,
    description,
    invoice_duration: 86400,
    success_redirect_url: `${process.env.FRONTEND_URL}/dashboard/billing?status=success`,
    failure_redirect_url: `${process.env.FRONTEND_URL}/dashboard/billing?status=failed`,
  };

  const xenditRes = await fetch('https://api.xendit.co/v2/invoices', {
    method: 'POST',
    headers: {
      Authorization: xenditAuthHeader(xenditKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!xenditRes.ok) {
    const errBody = await xenditRes.text();
    throw new Error(errBody || 'Xendit invoice creation failed');
  }

  return xenditRes.json();
}

export async function fetchXenditInvoice({ xenditKey, invoiceId }) {
  const response = await fetch(`https://api.xendit.co/v2/invoices/${invoiceId}`, {
    headers: {
      Authorization: xenditAuthHeader(xenditKey),
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(errBody || 'Xendit invoice fetch failed');
  }

  return response.json();
}

export async function applyPaidTransaction({
  transaction,
  invoice,
  now = new Date(),
  prismaClient = prisma,
  logger,
  emitPaymentSuccess,
}) {
  const paymentContext = parsePaymentContext(invoice?.external_id);
  const workspaceId = transaction.workspaceId;

  if (transaction.type === 'SUBSCRIPTION') {
    const tier = paymentContext?.tier;
    if (!tier || !TIER_QUOTA[tier]) {
      logger?.error?.({ xenditInvoiceId: invoice?.id, externalId: invoice?.external_id }, 'Invalid subscription payment context');
      return { updated: false, transactionStatus: transaction.status, reason: 'invalid_subscription_context' };
    }

    const paymentUpdate = {
      status: 'PAID',
      xenditPaymentId: invoice?.id || transaction.xenditPaymentId,
      paidAt: now,
      amount: resolvePaidAmount(invoice, transaction.amount),
    };

    const newerPaidSubscription = await prismaClient.transaction.findFirst({
      where: {
        workspaceId,
        type: 'SUBSCRIPTION',
        status: 'PAID',
        createdAt: { gt: transaction.createdAt },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    if (newerPaidSubscription) {
      await prismaClient.transaction.update({
        where: { id: transaction.id },
        data: paymentUpdate,
      });

      logger?.info?.({
        workspaceId,
        transactionId: transaction.id,
        supersededByTransactionId: newerPaidSubscription.id,
      }, 'Subscription payment marked as paid without downgrading a newer subscription');

      return {
        updated: true,
        transactionStatus: 'PAID',
        type: 'SUBSCRIPTION',
        workspaceId,
        tier,
        appliedToWorkspace: false,
        supersededByTransactionId: newerPaidSubscription.id,
      };
    }

    const quotaLimit = TIER_QUOTA[tier];
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await prismaClient.$transaction(async (tx) => {
      const activeTopups = await tx.addOn.aggregate({
        where: {
          workspaceId,
          type: 'MESSAGE_TOPUP',
          status: 'ACTIVE',
          OR: [
            { expiresAt: null },
            { expiresAt: { gte: now } },
          ],
        },
        _sum: { value: true },
      });
      const activeTopupMessages = Number(activeTopups._sum.value || 0);

      await tx.transaction.update({
        where: { id: transaction.id },
        data: paymentUpdate,
      });

      await tx.subscription.upsert({
        where: { workspaceId },
        update: {
          tier,
          status: 'ACTIVE',
          quotaLimit,
          startDate: now,
          expireDate: periodEnd,
          autoRenew: true,
        },
        create: {
          workspaceId,
          tier,
          status: 'ACTIVE',
          quotaLimit,
          startDate: now,
          expireDate: periodEnd,
          autoRenew: true,
        },
      });

      await tx.workspace.update({
        where: { id: workspaceId },
        data: { subTier: tier, subStatus: 'ACTIVE' },
      });

      const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      await tx.quotaUsage.upsert({
        where: { workspaceId_monthYear: { workspaceId, monthYear } },
        update: { limitMessages: quotaLimit + activeTopupMessages },
        create: { workspaceId, monthYear, usedMessages: 0, limitMessages: quotaLimit + activeTopupMessages },
      });
    });

    logger?.info?.({ workspaceId, tier, transactionId: transaction.id }, 'Subscription upgraded/renewed after payment');

    await emitPaymentSuccess?.({
      workspaceId,
      payload: {
        type: 'SUBSCRIPTION',
        tier,
        expireDate: periodEnd.toISOString(),
      },
    });

    return {
      updated: true,
      transactionStatus: 'PAID',
      type: 'SUBSCRIPTION',
      workspaceId,
      tier,
    };
  }

  if (transaction.type === 'TOPUP') {
    const topupMessages = paymentContext?.messages;
    if (!topupMessages || Number.isNaN(topupMessages)) {
      logger?.error?.({ xenditInvoiceId: invoice?.id, externalId: invoice?.external_id }, 'Invalid top-up payment context');
      return { updated: false, transactionStatus: transaction.status, reason: 'invalid_topup_context' };
    }

    const currentSubscription = transaction.workspace?.subscriptions?.[0]
      || await prismaClient.subscription.findUnique({ where: { workspaceId } });
    const baseLimit = currentSubscription?.quotaLimit || TIER_QUOTA.FREE;
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    await prismaClient.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: 'PAID',
          xenditPaymentId: invoice?.id || transaction.xenditPaymentId,
          paidAt: now,
          amount: resolvePaidAmount(invoice, transaction.amount),
        },
      });

      await tx.quotaUsage.upsert({
        where: { workspaceId_monthYear: { workspaceId, monthYear } },
        update: { limitMessages: { increment: topupMessages } },
        create: {
          workspaceId,
          monthYear,
          usedMessages: 0,
          limitMessages: baseLimit + topupMessages,
        },
      });

      await tx.addOn.create({
        data: {
          workspaceId,
          type: 'MESSAGE_TOPUP',
          value: topupMessages,
          status: 'ACTIVE',
          expiresAt: currentSubscription?.expireDate || null,
        },
      });
    });

    logger?.info?.({ workspaceId, topupMessages, transactionId: transaction.id }, 'Quota top-up activated after payment');

    await emitPaymentSuccess?.({
      workspaceId,
      payload: {
        type: 'TOPUP',
        messages: topupMessages,
      },
    });

    return {
      updated: true,
      transactionStatus: 'PAID',
      type: 'TOPUP',
      workspaceId,
      messages: topupMessages,
    };
  }

  return { updated: false, transactionStatus: transaction.status, reason: 'unsupported_transaction_type' };
}

export async function syncTransactionFromInvoice({
  transaction,
  invoice,
  prismaClient = prisma,
  logger,
  emitPaymentSuccess,
}) {
  if (!transaction) {
    return { updated: false, transactionStatus: null, reason: 'transaction_not_found' };
  }

  if (transaction.status === 'PAID') {
    return { updated: false, transactionStatus: 'PAID', invoiceStatus: normalizeInvoiceStatus(invoice?.status) };
  }

  const invoiceStatus = normalizeInvoiceStatus(invoice?.status);
  if (PAID_INVOICE_STATUSES.has(invoiceStatus)) {
    return applyPaidTransaction({
      transaction,
      invoice,
      prismaClient,
      logger,
      emitPaymentSuccess,
    });
  }

  if (FAILED_INVOICE_STATUSES.has(invoiceStatus)) {
    const nextStatus = invoiceStatus === 'EXPIRED' ? 'EXPIRED' : 'FAILED';
    if (transaction.status !== nextStatus) {
      await prismaClient.transaction.update({
        where: { id: transaction.id },
        data: { status: nextStatus },
      });
      logger?.info?.({ workspaceId: transaction.workspaceId, transactionId: transaction.id, invoiceStatus }, 'Transaction status updated after invoice sync');
      return { updated: true, transactionStatus: nextStatus, invoiceStatus };
    }
    return { updated: false, transactionStatus: nextStatus, invoiceStatus };
  }

  return {
    updated: false,
    transactionStatus: transaction.status,
    invoiceStatus,
  };
}

export async function syncPendingTransactionsForWorkspace({
  workspaceId,
  xenditKey,
  prismaClient = prisma,
  logger,
  emitPaymentSuccess,
}) {
  const pendingTransactions = await prismaClient.transaction.findMany({
    where: {
      workspaceId,
      status: 'PENDING',
      xenditInvoiceId: { not: null },
    },
    include: {
      workspace: {
        include: {
          subscriptions: { take: 1, orderBy: { createdAt: 'desc' } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const results = [];
  for (const transaction of pendingTransactions) {
    try {
      const invoice = await fetchXenditInvoice({
        xenditKey,
        invoiceId: transaction.xenditInvoiceId,
      });

      const syncResult = await syncTransactionFromInvoice({
        transaction,
        invoice,
        prismaClient,
        logger,
        emitPaymentSuccess,
      });

      results.push({
        transactionId: transaction.id,
        invoiceId: transaction.xenditInvoiceId,
        type: transaction.type,
        invoiceStatus: normalizeInvoiceStatus(invoice?.status),
        transactionStatus: syncResult.transactionStatus,
        updated: syncResult.updated,
      });
    } catch (error) {
      logger?.warn?.({ err: error.message, transactionId: transaction.id, invoiceId: transaction.xenditInvoiceId }, 'Failed to sync pending transaction with Xendit');
      results.push({
        transactionId: transaction.id,
        invoiceId: transaction.xenditInvoiceId,
        type: transaction.type,
        updated: false,
        error: error.message,
      });
    }
  }

  return {
    checked: pendingTransactions.length,
    updated: results.filter((item) => item.updated).length,
    paid: results.filter((item) => item.transactionStatus === 'PAID').length,
    results,
  };
}
import prisma from './prisma.js';

export function serializeTradeAuditEntry(entry) {
  return {
    id: entry.id,
    source: entry.source || 'MANUAL',
    action: entry.action,
    status: entry.status,
    marketSlug: entry.marketSlug || null,
    marketQuestion: entry.marketQuestion || null,
    tokenId: entry.tokenId || null,
    outcomeLabel: entry.outcomeLabel || null,
    side: entry.side || null,
    orderKind: entry.orderKind || null,
    orderType: entry.orderType || null,
    price: entry.price?.toString?.() || null,
    size: entry.size?.toString?.() || null,
    amount: entry.amount?.toString?.() || null,
    approvalRequired: Boolean(entry.approvalRequired),
    responseOrderId: entry.responseOrderId || null,
    runId: entry.runId || null,
    decisionId: entry.decisionId || null,
    reasonCode: entry.reasonCode || null,
    request: entry.requestJson || null,
    response: entry.responseJson || null,
    errorMessage: entry.errorMessage || null,
    createdAt: entry.createdAt?.toISOString?.() || null,
  };
}

export async function createTradeAudit({
  workspaceId,
  ownerId,
  source = 'MANUAL',
  action,
  status,
  requestPayload,
  responsePayload,
  errorMessage,
  approvalRequired = false,
  runId = null,
  decisionId = null,
  reasonCode = null,
}) {
  const entry = await prisma.polymarketTradeAudit.create({
    data: {
      workspaceId,
      ownerId,
      source,
      action,
      status,
      marketSlug: requestPayload?.marketSlug || null,
      marketQuestion: requestPayload?.marketQuestion || null,
      tokenId: requestPayload?.tokenId || null,
      outcomeLabel: requestPayload?.outcomeLabel || null,
      side: requestPayload?.side || null,
      orderKind: requestPayload?.orderKind || null,
      orderType: requestPayload?.orderType || null,
      price: requestPayload?.price ?? null,
      size: requestPayload?.size ?? null,
      amount: requestPayload?.amount ?? null,
      approvalRequired,
      responseOrderId: responsePayload?.orderID || responsePayload?.orderId || responsePayload?.id || null,
      runId,
      decisionId,
      reasonCode,
      requestJson: requestPayload || null,
      responseJson: responsePayload || null,
      errorMessage: errorMessage || null,
    },
  });

  return serializeTradeAuditEntry(entry);
}
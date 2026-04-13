import {
  AGENT_ACCESS_MODES,
  AGENT_CUSTOMER_ACCESS_STATUSES,
  normalizeAgentAccessMode,
  normalizeAgentCustomerAccessStatus,
} from './agent-access.js';

export function resolveAgentCustomerAccessStatus(agent, agentAccess) {
  if (normalizeAgentAccessMode(agent?.accessMode) === AGENT_ACCESS_MODES.OPEN_ACCESS) {
    return AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE;
  }

  if (!agentAccess?.status) {
    return AGENT_CUSTOMER_ACCESS_STATUSES.PENDING;
  }

  return normalizeAgentCustomerAccessStatus(agentAccess?.status);
}

export function shouldBlockPendingCustomer(agent, agentAccess) {
  return resolveAgentCustomerAccessStatus(agent, agentAccess) === AGENT_CUSTOMER_ACCESS_STATUSES.PENDING;
}

export function resolveInboundConversationStatus(agent, agentAccess) {
  return shouldBlockPendingCustomer(agent, agentAccess)
    ? 'NEEDS_ADMIN'
    : 'ACTIVE';
}

export async function upsertAgentCustomerAccess(tx, {
  workspaceId,
  agent,
  customerId,
  role,
  now = new Date(),
}) {
  const existing = await tx.agentCustomerAccess.findUnique({
    where: {
      agentId_customerId: {
        agentId: agent.id,
        customerId,
      },
    },
  });

  const agentMode = normalizeAgentAccessMode(agent?.accessMode);
  const isCustomerTurn = role === 'CUSTOMER';
  const nextStatus = agentMode === AGENT_ACCESS_MODES.OPEN_ACCESS
    ? AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE
    : existing?.status === AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE
      ? AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE
      : isCustomerTurn
        ? AGENT_CUSTOMER_ACCESS_STATUSES.PENDING
        : (existing?.status || AGENT_CUSTOMER_ACCESS_STATUSES.PENDING);

  if (existing) {
    return tx.agentCustomerAccess.update({
      where: { id: existing.id },
      data: {
        status: nextStatus,
        approvedAt: nextStatus === AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE
          ? existing.approvedAt || now
          : existing.approvedAt,
        approvalCodeMatchedAt: existing.approvalCodeMatchedAt,
        lastPendingAt: nextStatus === AGENT_CUSTOMER_ACCESS_STATUSES.PENDING ? now : existing.lastPendingAt,
        lastMessageAt: now,
      },
    });
  }

  return tx.agentCustomerAccess.create({
    data: {
      workspaceId,
      agentId: agent.id,
      customerId,
      status: nextStatus,
      approvedAt: nextStatus === AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE ? now : null,
      approvalCodeMatchedAt: null,
      lastPendingAt: nextStatus === AGENT_CUSTOMER_ACCESS_STATUSES.PENDING ? now : null,
      lastMessageAt: now,
    },
  });
}

export async function approveCustomer(prismaClient, {
  workspaceId,
  agentId,
  customerId,
  approvedAt = new Date(),
  approvalCodeMatchedAt,
}) {
  const matchedAtProvided = approvalCodeMatchedAt !== undefined;
  const agentAccess = await prismaClient.agentCustomerAccess.upsert({
    where: {
      agentId_customerId: {
        agentId,
        customerId,
      },
    },
    update: {
      status: AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE,
      approvedAt,
      ...(matchedAtProvided ? { approvalCodeMatchedAt } : {}),
      lastPendingAt: null,
      lastMessageAt: approvedAt,
    },
    create: {
      workspaceId,
      agentId,
      customerId,
      status: AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE,
      approvedAt,
      approvalCodeMatchedAt: matchedAtProvided ? approvalCodeMatchedAt : null,
      lastPendingAt: null,
      lastMessageAt: approvedAt,
    },
  });

  await prismaClient.conversation.updateMany({
    where: {
      agentId,
      customerId,
      status: 'NEEDS_ADMIN',
    },
    data: {
      status: 'ACTIVE',
      endedAt: null,
    },
  });

  return agentAccess;
}

export async function approveAgentCustomerAccess(prismaClient, params) {
  return approveCustomer(prismaClient, params);
}

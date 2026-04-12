import crypto from 'node:crypto';

export const AGENT_ACCESS_MODES = Object.freeze({
  OPEN_ACCESS: 'OPEN_ACCESS',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
});

export const AGENT_CUSTOMER_ACCESS_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
});

export const DEFAULT_PENDING_REPLY = 'Pesan Anda sudah diterima. Kirim pairing code untuk melanjutkan akses.';
export const INVALID_APPROVAL_CODE_REPLY = 'Pairing code tidak valid. Periksa kembali kode Anda lalu kirim ulang.';
export const APPROVAL_SUCCESS_REPLY = 'Akses berhasil diaktifkan. Anda sekarang bisa melanjutkan percakapan.';

const APPROVAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const APPROVAL_CODE_LENGTH = 8;

export function normalizeAgentAccessMode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.values(AGENT_ACCESS_MODES).includes(normalized)
    ? normalized
    : AGENT_ACCESS_MODES.OPEN_ACCESS;
}

export function mapAccessModeToDmPolicy(value) {
  return normalizeAgentAccessMode(value) === AGENT_ACCESS_MODES.APPROVAL_REQUIRED
    ? 'pairing'
    : 'open';
}

export function generateApprovalCode() {
  let code = '';
  for (let index = 0; index < APPROVAL_CODE_LENGTH; index += 1) {
    const nextIndex = crypto.randomInt(0, APPROVAL_CODE_ALPHABET.length);
    code += APPROVAL_CODE_ALPHABET[nextIndex];
  }
  return code;
}

export function normalizeApprovalCodeInput(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function looksLikeApprovalCode(value, codeLength = APPROVAL_CODE_LENGTH) {
  const normalized = normalizeApprovalCodeInput(value);
  return normalized.length === codeLength && /^[A-Z0-9]+$/.test(normalized);
}

export function normalizeAgentCustomerAccessStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.values(AGENT_CUSTOMER_ACCESS_STATUSES).includes(normalized)
    ? normalized
    : AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE;
}

export function getConversationAccessStatus({ agent, agentAccess }) {
  if (normalizeAgentAccessMode(agent?.accessMode) === AGENT_ACCESS_MODES.OPEN_ACCESS) {
    return AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE;
  }
  return normalizeAgentCustomerAccessStatus(agentAccess?.status);
}

export function mapCustomerLifecycleStatus(customer, agentAccess = null) {
  if (customer?.isBlocked) return 'BLOCKED';
  if (customer?.isArchived) return 'ARCHIVED';

  if (agentAccess) {
    return getConversationAccessStatus({ agent: agentAccess.agent || null, agentAccess }) === AGENT_CUSTOMER_ACCESS_STATUSES.PENDING
      ? 'PENDING'
      : 'ACTIVE';
  }

  const accesses = Array.isArray(customer?.agentAccesses) ? customer.agentAccesses : [];
  if (accesses.some((entry) => normalizeAgentCustomerAccessStatus(entry?.status) === AGENT_CUSTOMER_ACCESS_STATUSES.PENDING)) {
    return 'PENDING';
  }
  return 'ACTIVE';
}

export function summarizeCustomerAccesses(accesses = []) {
  const normalizedEntries = Array.isArray(accesses) ? accesses : [];
  const pendingCount = normalizedEntries.filter((entry) => normalizeAgentCustomerAccessStatus(entry?.status) === AGENT_CUSTOMER_ACCESS_STATUSES.PENDING).length;
  const activeCount = normalizedEntries.filter((entry) => normalizeAgentCustomerAccessStatus(entry?.status) === AGENT_CUSTOMER_ACCESS_STATUSES.ACTIVE).length;

  return {
    pendingCount,
    activeCount,
  };
}

export function buildAccessModeBadgeLabel(value) {
  return normalizeAgentAccessMode(value) === AGENT_ACCESS_MODES.APPROVAL_REQUIRED
    ? 'Approval Required'
    : 'Open Access';
}

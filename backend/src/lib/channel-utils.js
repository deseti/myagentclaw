export const CHANNEL_TYPES = Object.freeze({
  TELEGRAM: 'TELEGRAM',
  WHATSAPP: 'WHATSAPP',
});

export const CHANNEL_TYPE_VALUES = Object.freeze(Object.values(CHANNEL_TYPES));

const CHANNEL_TYPE_TO_KEY = Object.freeze({
  [CHANNEL_TYPES.TELEGRAM]: 'telegram',
  [CHANNEL_TYPES.WHATSAPP]: 'whatsapp',
});

const CHANNEL_TYPE_TO_LABEL = Object.freeze({
  [CHANNEL_TYPES.TELEGRAM]: 'Telegram',
  [CHANNEL_TYPES.WHATSAPP]: 'WhatsApp',
});

const CHANNEL_TYPE_TO_CUSTOMER_PREFIX = Object.freeze({
  [CHANNEL_TYPES.TELEGRAM]: 'tg',
  [CHANNEL_TYPES.WHATSAPP]: 'wa',
});

function normalizeString(value) {
  return String(value || '').trim();
}

export function normalizeChannelType(value, fallback = null) {
  const normalized = normalizeString(value).toUpperCase();
  return CHANNEL_TYPES[normalized] || fallback;
}

export function getChannelKey(channelType) {
  return CHANNEL_TYPE_TO_KEY[normalizeChannelType(channelType)] || 'telegram';
}

export function getChannelLabel(channelType) {
  return CHANNEL_TYPE_TO_LABEL[normalizeChannelType(channelType)] || 'Telegram';
}

export function getCustomerPhonePrefix(channelType) {
  return CHANNEL_TYPE_TO_CUSTOMER_PREFIX[normalizeChannelType(channelType)] || 'tg';
}

export function normalizeCustomerPhone(channelType, value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  const prefix = getCustomerPhonePrefix(channelType);
  const withoutPrefix = raw.replace(/^(tg|wa):/i, '');
  return `${prefix}:${withoutPrefix}`;
}

export function stripCustomerPhonePrefix(value) {
  return normalizeString(value).replace(/^(tg|wa):/i, '');
}

export function getCustomerPhoneChannelType(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized.startsWith('tg:')) return CHANNEL_TYPES.TELEGRAM;
  if (normalized.startsWith('wa:')) return CHANNEL_TYPES.WHATSAPP;
  return null;
}

export function channelUsesBotToken(channelType) {
  return normalizeChannelType(channelType) === CHANNEL_TYPES.TELEGRAM;
}

export function channelUsesQrLogin(channelType) {
  return normalizeChannelType(channelType) === CHANNEL_TYPES.WHATSAPP;
}

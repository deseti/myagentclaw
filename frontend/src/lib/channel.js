export function stripChannelPrefix(value) {
  return String(value || '').replace(/^(tg|wa):/i, '');
}

export function inferChannelType(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.startsWith('wa:')) return 'WHATSAPP';
  if (raw.startsWith('tg:')) return 'TELEGRAM';
  return null;
}

export function getChannelLabel(channelType, fallbackValue = '') {
  const inferred = channelType || inferChannelType(fallbackValue);
  return inferred === 'WHATSAPP' ? 'WhatsApp' : 'Telegram';
}

export function getChannelShortLabel(channelType, fallbackValue = '') {
  return getChannelLabel(channelType, fallbackValue) === 'WhatsApp' ? 'WA' : 'TG';
}

export function formatChannelContact(value) {
  return stripChannelPrefix(value);
}

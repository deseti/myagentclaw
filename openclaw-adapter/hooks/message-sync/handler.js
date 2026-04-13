function normalizeChannelType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'whatsapp' ? 'WHATSAPP' : 'TELEGRAM';
}

function normalizePhone(channelType, value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (normalizeChannelType(channelType) === 'WHATSAPP') {
    const stripped = raw
      .replace(/^whatsapp:/i, '')
      .replace(/^wa:/i, '')
      .replace(/@(s\.whatsapp\.net|g\.us)$/i, '');
    return stripped ? `wa:${stripped}` : '';
  }

  const stripped = raw.replace(/^telegram:/i, '').replace(/^tg:/i, '');
  return stripped ? `tg:${stripped}` : '';
}

function debugLog(message, payload) {
  const line = `[message-sync] ${new Date().toISOString()} ${message}${payload ? ` ${JSON.stringify(payload)}` : ''}`;
  console.log(line);
}

async function postMessageSave(event, role) {
  const backendUrl = process.env.BACKEND_INTERNAL_URL || 'http://backend:3001';
  const internalKey = process.env.INTERNAL_SECRET_KEY || '';

  const ctx = event?.context || {};
  const metadata = ctx.metadata && typeof ctx.metadata === 'object' ? ctx.metadata : {};
  const channelId = String(ctx.accountId || '').trim();
  const channelType = normalizeChannelType(ctx.channelId);
  const content = String(ctx.content || '').trim();

  if (!content) {
    debugLog('skip-empty-content', { action: event?.action, role });
    return;
  }

  if (!channelId) {
    debugLog('skip-missing-accountId', { action: event?.action, role, ctx });
    return;
  }

  // Jangan simpan pesan teknis approval agar tidak mengotori conversation feed.
  if (content.toLowerCase().includes('exec approval is required')) return;

  const phone = role === 'CUSTOMER'
    ? normalizePhone(channelType, ctx.from)
    : normalizePhone(channelType, ctx.to);

  if (!phone) {
    debugLog('skip-missing-phone', { action: event?.action, role, ctx });
    return;
  }

  const body = {
    channel_id: channelId,
    customer_phone: phone,
    customer_name: role === 'CUSTOMER'
      ? String(metadata.senderName || metadata.senderUsername || '').trim() || undefined
      : undefined,
    role,
    content,
    channel_type: channelType,
    session_key: String(event?.sessionKey || '').slice(0, 100) || undefined,
  };

  const response = await fetch(`${backendUrl}/internal/message/save`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-key': internalKey,
    },
    body: JSON.stringify(body),
  }).catch((error) => {
    debugLog('fetch-error', { action: event?.action, role, message: String(error?.message || error) });
    return null;
  });

  if (!response) return;
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    debugLog('save-failed', { action: event?.action, role, status: response.status, errorText, body });
    return;
  }

  debugLog('save-ok', { action: event?.action, role, body });
}

export default async function handler(event) {
  if (!event || event.type !== 'message') return;

  if (event.action === 'received') {
    await postMessageSave(event, 'CUSTOMER');
    return;
  }

  if (event.action === 'sent') {
    const success = Boolean(event?.context?.success);
    if (!success) return;
    await postMessageSave(event, 'AI');
  }
}

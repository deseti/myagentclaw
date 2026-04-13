const CUSTOMER_REPLY_LEAK_PREFIX_PATTERNS = [
  /^the user is asking\b/i,
  /^the user wants\b/i,
  /^i will respond\b/i,
  /^i should respond\b/i,
  /^let me think\b/i,
  /^analysis\b/i,
  /^reasoning\b/i,
  /^step by step\b/i,
  /^thinking\b/i,
  /^chain of thought\b/i,
  /^internal (?:analysis|reasoning|note)\b/i,
  /^saya akan menjawab\b/i,
  /^pengguna sedang bertanya\b/i,
  /^langkah demi langkah\b/i,
];

export const CUSTOMER_CHANNEL_SAFE_FALLBACK_TEXT =
  "Maaf, saya sedang mengalami gangguan sebentar. Coba kirim pesan lagi ya.";

export function isCustomerFacingReplyChannel(channel: string | null | undefined): boolean {
  const normalized = String(channel || "").trim().toLowerCase();
  return normalized === "telegram" || normalized === "whatsapp";
}

function isReplyLeakLine(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  const normalized = trimmed.replace(/^[>#*\-\d.()\s]+/, "").trim();
  return CUSTOMER_REPLY_LEAK_PREFIX_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function sanitizeCustomerFacingReplyText(text: string): string {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return "";
  }

  if (isReplyLeakLine(normalized)) {
    return "";
  }

  const sanitizedLines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => {
      if (isReplyLeakLine(line)) {
        return false;
      }
      if (line.trim()) {
        return true;
      }
      const previous = lines[index - 1]?.trim();
      const next = lines[index + 1]?.trim();
      return Boolean(previous && next);
    });

  const compacted = sanitizedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!compacted || isReplyLeakLine(compacted)) {
    return "";
  }

  return compacted;
}
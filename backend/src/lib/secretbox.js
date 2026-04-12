import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const LEGACY_ENCRYPTION_VERSION = 'v1';
const ENVELOPE_PREFIX = 'pmsec';
const ENVELOPE_VERSION = 'v2';
const DEFAULT_KEY_ID = 'local-env';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function decodeBase64Key(rawKey) {
  const normalized = String(rawKey || '').trim();
  if (!normalized) return null;

  try {
    const decoded = Buffer.from(normalized, 'base64');
    if (decoded.length !== 32) return null;

    const normalizedInput = normalized.replace(/=+$/u, '');
    const normalizedDecoded = decoded.toString('base64').replace(/=+$/u, '');
    return normalizedInput === normalizedDecoded ? decoded : null;
  } catch {
    return null;
  }
}

function deriveEncryptionKey(rawKey, envName) {
  const normalized = String(rawKey || '').trim();
  if (!normalized) {
    throw new Error(`Konfigurasi enkripsi credential Polymarket belum aman. Set ${envName} dengan master key khusus.`);
  }

  const decoded = decodeBase64Key(normalized);
  if (decoded) return decoded;

  if (normalized.length < 32) {
    throw new Error(`${envName} harus berupa base64 32-byte atau secret acak minimal 32 karakter.`);
  }

  return createHash('sha256').update(normalized).digest();
}

function deriveLegacyHashedKey(rawKey, envName) {
  const normalized = String(rawKey || '').trim();
  if (!normalized) {
    throw new Error(`Konfigurasi enkripsi credential Polymarket belum aman. Set ${envName} dengan master key khusus.`);
  }

  return createHash('sha256').update(normalized).digest();
}

function getPrimaryKeyMaterial() {
  return {
    rawKey: String(process.env.POLYMARKET_CREDENTIALS_ENCRYPTION_KEY || '').trim(),
    key: deriveEncryptionKey(
      process.env.POLYMARKET_CREDENTIALS_ENCRYPTION_KEY,
      'POLYMARKET_CREDENTIALS_ENCRYPTION_KEY',
    ),
    keyId: String(process.env.POLYMARKET_CREDENTIALS_ENCRYPTION_KEY_ID || '').trim() || DEFAULT_KEY_ID,
  };
}

function getLegacyDecryptionKeyMaterial() {
  const rawKey = String(process.env.POLYMARKET_CREDENTIALS_LEGACY_DECRYPTION_KEY || '').trim();
  if (!rawKey) return null;

  return {
    rawKey,
    key: deriveEncryptionKey(rawKey, 'POLYMARKET_CREDENTIALS_LEGACY_DECRYPTION_KEY'),
    keyId: 'legacy-env',
  };
}

function buildLegacyCompatKeyMaterial(rawKey, keyId) {
  if (!String(rawKey || '').trim()) return null;

  return {
    key: deriveLegacyHashedKey(rawKey, keyId),
    keyId: `${keyId}-hashed-compat`,
  };
}

function serializeEnvelope({ keyId, iv, tag, encrypted }) {
  const envelope = {
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    keyId,
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ciphertext: encrypted.toString('base64url'),
  };

  return `${ENVELOPE_PREFIX}:${Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')}`;
}

function parseEnvelope(payload) {
  const normalized = String(payload || '');
  if (!normalized.startsWith(`${ENVELOPE_PREFIX}:`)) return null;

  const encodedEnvelope = normalized.slice(ENVELOPE_PREFIX.length + 1);
  if (!encodedEnvelope) {
    throw new Error('Envelope credential terenkripsi Polymarket kosong.');
  }

  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(encodedEnvelope, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Envelope credential terenkripsi Polymarket tidak valid.');
  }

  if (
    envelope?.version !== ENVELOPE_VERSION ||
    envelope?.algorithm !== ALGORITHM ||
    !envelope?.iv ||
    !envelope?.tag ||
    !envelope?.ciphertext
  ) {
    throw new Error('Envelope credential terenkripsi Polymarket tidak dikenali.');
  }

  return {
    iv: envelope.iv,
    tag: envelope.tag,
    ciphertext: envelope.ciphertext,
  };
}

function parseLegacyPayload(payload) {
  const [version, ivValue, tagValue, encryptedValue] = String(payload || '').split(':');
  if (version !== LEGACY_ENCRYPTION_VERSION || !ivValue || !tagValue || !encryptedValue) {
    return null;
  }

  return {
    iv: ivValue,
    tag: tagValue,
    ciphertext: encryptedValue,
  };
}

function decryptWithKeyMaterial(parsedPayload, keyMaterial) {
  const decipher = createDecipheriv(
    ALGORITHM,
    keyMaterial.key,
    Buffer.from(parsedPayload.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(parsedPayload.tag, 'base64url'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(parsedPayload.ciphertext, 'base64url')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

function dedupeKeyMaterials(candidates) {
  const seen = new Set();

  return candidates.filter((candidate) => {
    if (!candidate?.key) return false;

    const fingerprint = candidate.key.toString('hex');
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

export function encryptSecret(value) {
  if (value === undefined || value === null) return null;

  const normalized = String(value);
  if (!normalized) return null;

  const iv = randomBytes(IV_LENGTH);
  const keyMaterial = getPrimaryKeyMaterial();
  const cipher = createCipheriv(ALGORITHM, keyMaterial.key, iv);
  const encrypted = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return serializeEnvelope({
    keyId: keyMaterial.keyId,
    iv,
    tag,
    encrypted,
  });
}

export function decryptSecret(payload) {
  if (!payload) return null;

  const legacyPayload = parseLegacyPayload(payload);
  const parsedPayload = parseEnvelope(payload) || legacyPayload;
  if (!parsedPayload) {
    throw new Error('Format credential terenkripsi Polymarket tidak dikenali.');
  }

  const primaryKeyMaterial = getPrimaryKeyMaterial();
  const legacyKeyMaterial = getLegacyDecryptionKeyMaterial();
  const isLegacyPayload = Boolean(legacyPayload);
  const candidateKeys = dedupeKeyMaterials([
    primaryKeyMaterial,
    isLegacyPayload
      ? buildLegacyCompatKeyMaterial(primaryKeyMaterial.rawKey, primaryKeyMaterial.keyId)
      : null,
    legacyKeyMaterial,
    isLegacyPayload && legacyKeyMaterial
      ? buildLegacyCompatKeyMaterial(legacyKeyMaterial.rawKey, legacyKeyMaterial.keyId)
      : null,
  ]);

  let lastError = null;
  for (const candidateKey of candidateKeys) {
    try {
      return decryptWithKeyMaterial(parsedPayload, candidateKey);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Gagal mendekripsi credential Polymarket.');
}
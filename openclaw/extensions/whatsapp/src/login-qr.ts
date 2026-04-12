import { randomUUID } from "node:crypto";
import { DisconnectReason } from "@whiskeysockets/baileys";
import { loadConfig } from "openclaw/plugin-sdk/config-runtime";
import { danger, info, success } from "openclaw/plugin-sdk/runtime-env";
import { defaultRuntime, type RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";
import { resolveWhatsAppAccount } from "./accounts.js";
import { renderQrPngBase64 } from "./qr-image.js";
import {
  createWaSocket,
  formatError,
  getStatusCode,
  logoutWeb,
  readWebSelfId,
  waitForCredsSaveQueueWithTimeout,
  waitForWaConnection,
  webAuthExists,
} from "./session.js";

const LOGGED_OUT_STATUS = DisconnectReason?.loggedOut ?? 401;
const ACTIVE_LOGIN_TTL_MS = 3 * 60_000;
const FINISHED_LOGIN_TTL_MS = 30_000;
const QR_TIMEOUT_FLOOR_MS = 5_000;
const CREDS_PERSIST_TIMEOUT_MS = 15_000;
const SELF_ID_PERSIST_TIMEOUT_MS = 10_000;
const POST_SCAN_STABLE_WINDOW_MS = 2_500;
const POST_SCAN_POLL_MS = 250;
const QR_RENDER_OPTIONS = {
  targetSize: 768,
  marginModules: 6,
  errorCorrectionLevel: "H" as const,
};

type ConnectionUpdate = Partial<import("@whiskeysockets/baileys").ConnectionState>;

type LoginRuntimeStatus =
  | "AUTH_LOADING"
  | "WAITING_QR"
  | "QR_SCANNED"
  | "SESSION_SAVING"
  | "WAITING_SOCKET_CONNECT"
  | "CONNECTED"
  | "LOGIN_FAILED";

type LoginFailureReason =
  | "SESSION_CONFLICT"
  | "BROWSER_CLOSED"
  | "SOCKET_DISCONNECTED"
  | "AUTH_SAVE_FAILED"
  | "QR_EXPIRED_AFTER_SCAN"
  | "WHATSAPP_REJECTED_LINK"
  | "NETWORK_TIMEOUT";

type WaSocket = Awaited<ReturnType<typeof createWaSocket>>;

type ConnectionUpdateSummary = {
  connection: string | null;
  isNewLogin: boolean;
  receivedPendingNotifications: boolean;
  qrPresent: boolean;
  statusCode: number | null;
  lastDisconnectReason: string | null;
};

type ActiveLogin = {
  accountId: string;
  authDir: string;
  isLegacyAuthDir: boolean;
  id: string;
  sock: WaSocket | null;
  startedAt: number;
  qr?: string;
  qrDataUrl?: string;
  qrIssuedAtMs?: number;
  connected: boolean;
  error?: string;
  errorStatus?: number;
  waitPromise: Promise<void>;
  restartAttempted: boolean;
  verbose: boolean;
  runtimeStatus: LoginRuntimeStatus;
  linkState: LoginRuntimeStatus;
  qrScannedAt?: string;
  browserConnectedAt?: string;
  socketConnectedAt?: string;
  authStateLoadedAt?: string;
  sessionPersistedAt?: string;
  lastDisconnectReason?: string;
  loginFailureReason?: LoginFailureReason;
  browserClosedUnexpectedly: boolean;
  whatsappSocketState: string;
  puppeteerBrowserState: string;
  lastDisconnectRaw?: unknown;
  lastSocketError?: string;
  lastSocketErrorRaw?: unknown;
  lastConnectionUpdate?: ConnectionUpdateSummary;
  rawFailure?: unknown;
  retainUntil?: number;
  socketCloseTimer?: ReturnType<typeof setTimeout>;
};

type ActiveWebLoginSnapshot = {
  accountId: string;
  connected: boolean;
  qrDataUrl?: string;
  qrExpiresAt?: string;
  runtimeStatus: LoginRuntimeStatus;
  linkState: LoginRuntimeStatus;
  qrScannedAt?: string;
  browserConnectedAt?: string;
  socketConnectedAt?: string;
  authStateLoadedAt?: string;
  sessionPersistedAt?: string;
  lastDisconnectReason?: string;
  loginFailureReason?: LoginFailureReason;
  browserClosedUnexpectedly: boolean;
  whatsappSocketState: string;
  puppeteerBrowserState: string;
  lastSocketError?: string;
  lastConnectionUpdate?: ConnectionUpdateSummary;
  lastDisconnectRaw?: unknown;
  lastSocketErrorRaw?: unknown;
  rawFailure?: unknown;
  error?: string;
  errorStatus?: number;
  code?: LoginFailureReason;
  restartAttempted: boolean;
  message: string;
};

const activeLogins = new Map<string, ActiveLogin>();

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function closeSocket(sock: WaSocket | null) {
  try {
    sock?.ws?.close();
  } catch {
    // ignore
  }
}

function resolveSocketState(sock: WaSocket | null) {
  const readyState = Number(
    ((sock?.ws as unknown as { readyState?: unknown } | undefined)?.readyState ?? Number.NaN),
  );
  if (readyState === 0) return "CONNECTING";
  if (readyState === 1) return "OPEN";
  if (readyState === 2) return "CLOSING";
  if (readyState === 3) return "CLOSED";
  return sock ? "UNKNOWN" : "INITIALIZING";
}

function scheduleSocketClose(login: ActiveLogin, delayMs = 0) {
  if (login.socketCloseTimer) {
    return;
  }
  login.socketCloseTimer = setTimeout(() => {
    login.socketCloseTimer = undefined;
    closeSocket(login.sock);
  }, Math.max(0, delayMs));
  login.socketCloseTimer.unref?.();
}

function clearSocketCloseTimer(login: ActiveLogin) {
  if (!login.socketCloseTimer) {
    return;
  }
  clearTimeout(login.socketCloseTimer);
  login.socketCloseTimer = undefined;
}

function dropActiveLogin(accountId: string) {
  const login = activeLogins.get(accountId);
  if (!login) {
    return;
  }
  clearSocketCloseTimer(login);
  closeSocket(login.sock);
  activeLogins.delete(accountId);
}

function isLoginFresh(login: ActiveLogin) {
  if (typeof login.retainUntil === "number") {
    return Date.now() < login.retainUntil;
  }
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

function setLoginStage(login: ActiveLogin, stage: LoginRuntimeStatus) {
  login.runtimeStatus = stage;
  login.linkState = stage;
}

function clearEphemeralErrors(login: ActiveLogin) {
  login.error = undefined;
  login.errorStatus = undefined;
  login.rawFailure = undefined;
  login.lastSocketError = undefined;
  login.lastSocketErrorRaw = undefined;
}

function summarizeConnectionUpdate(update: ConnectionUpdate): ConnectionUpdateSummary {
  return {
    connection: typeof update.connection === "string" ? update.connection : null,
    isNewLogin: update.isNewLogin === true,
    receivedPendingNotifications: update.receivedPendingNotifications === true,
    qrPresent: typeof update.qr === "string" && update.qr.length > 0,
    statusCode: getStatusCode(update.lastDisconnect?.error ?? update.lastDisconnect) ?? null,
    lastDisconnectReason: update.lastDisconnect
      ? formatError(update.lastDisconnect?.error ?? update.lastDisconnect)
      : null,
  };
}

function classifyLoginFailureReason(login: ActiveLogin, err: unknown): LoginFailureReason {
  if (login.loginFailureReason === "QR_EXPIRED_AFTER_SCAN") {
    return "QR_EXPIRED_AFTER_SCAN";
  }
  if (login.browserClosedUnexpectedly) {
    return "BROWSER_CLOSED";
  }

  const status = getStatusCode(err);
  const text = [
    formatError(err),
    login.lastDisconnectReason,
    login.lastSocketError,
    typeof (err as { message?: unknown })?.message === "string"
      ? ((err as { message?: unknown }).message as string)
      : undefined,
  ]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .join(" ")
    .toLowerCase();

  if (/conflict|replaced|another session|multidevice|device mismatch/.test(text)) {
    return "SESSION_CONFLICT";
  }

  if (status === LOGGED_OUT_STATUS) {
    if (/reject|unable to link|cannot link|forbidden|not authorized|not-authorized/.test(text)) {
      return "WHATSAPP_REJECTED_LINK";
    }
    return login.qrScannedAt ? "SESSION_CONFLICT" : "WHATSAPP_REJECTED_LINK";
  }

  if (/auth|creds|credential|persist|save/.test(text) && /fail|timeout|timed out|error/.test(text)) {
    return "AUTH_SAVE_FAILED";
  }

  if (
    /qr.*expired|code expired|scan again|generate a new qr|timed out waiting for whatsapp qr/.test(
      text,
    )
  ) {
    return login.qrScannedAt ? "QR_EXPIRED_AFTER_SCAN" : "NETWORK_TIMEOUT";
  }

  if (/browser|websocket|socket closed|stream errored|connection closed|stream error/.test(text)) {
    return login.qrScannedAt ? "BROWSER_CLOSED" : "SOCKET_DISCONNECTED";
  }

  if (/timed out|timeout|etimedout|econnreset|enotfound|eai_again|network/.test(text)) {
    return "NETWORK_TIMEOUT";
  }

  if (/reject|unable to link|cannot link|forbidden|not authorized|not-authorized/.test(text)) {
    return "WHATSAPP_REJECTED_LINK";
  }

  return login.qrScannedAt ? "SOCKET_DISCONNECTED" : "NETWORK_TIMEOUT";
}

function markLoginFailure(
  login: ActiveLogin,
  err: unknown,
  reason?: LoginFailureReason,
) {
  login.connected = false;
  login.rawFailure = err;
  login.error = formatError(err);
  login.errorStatus = getStatusCode(err);
  login.loginFailureReason = reason ?? classifyLoginFailureReason(login, err);
  if (!login.lastDisconnectReason) {
    login.lastDisconnectReason = login.error;
  }
  if (login.loginFailureReason === "BROWSER_CLOSED") {
    login.browserClosedUnexpectedly = true;
  }
  login.whatsappSocketState = resolveSocketState(login.sock);
  setLoginStage(login, "LOGIN_FAILED");
}

function markLoginFinished(login: ActiveLogin, closeDelayMs = 750) {
  login.retainUntil = Date.now() + FINISHED_LOGIN_TTL_MS;
  scheduleSocketClose(login, closeDelayMs);
}

function resetPostScanProgress(login: ActiveLogin) {
  login.connected = false;
  login.qr = undefined;
  login.qrDataUrl = undefined;
  login.qrScannedAt = undefined;
  login.browserConnectedAt = undefined;
  login.socketConnectedAt = undefined;
  login.sessionPersistedAt = undefined;
  login.browserClosedUnexpectedly = false;
  clearEphemeralErrors(login);
}

function markQrScanned(login: ActiveLogin) {
  if (!login.qrIssuedAtMs && !login.qrScannedAt) {
    return;
  }
  const timestamp = nowIso();
  login.qrScannedAt = login.qrScannedAt ?? timestamp;
  login.browserConnectedAt = login.browserConnectedAt ?? timestamp;
  login.qr = undefined;
  login.qrDataUrl = undefined;
}

function markSocketConnected(login: ActiveLogin) {
  markQrScanned(login);
  login.socketConnectedAt = login.socketConnectedAt ?? nowIso();
  login.whatsappSocketState = resolveSocketState(login.sock);
  setLoginStage(login, "WAITING_SOCKET_CONNECT");
}

function resolveLoginMessage(login: ActiveLogin): string {
  if (login.connected || login.runtimeStatus === "CONNECTED") {
    return "✅ Linked! WhatsApp is ready.";
  }

  if (login.runtimeStatus === "WAITING_QR") {
    if (login.loginFailureReason === "QR_EXPIRED_AFTER_SCAN") {
      return "QR sebelumnya kedaluwarsa sesudah dipindai. Scan QR baru untuk melanjutkan.";
    }
    return login.qrDataUrl
      ? "Scan this QR in WhatsApp → Linked Devices."
      : "Menyiapkan QR WhatsApp.";
  }

  if (login.runtimeStatus === "QR_SCANNED") {
    return "QR dipindai. Menunggu konfirmasi dari WhatsApp.";
  }

  if (login.runtimeStatus === "AUTH_LOADING") {
    return "QR dipindai. Memuat status autentikasi WhatsApp.";
  }

  if (login.runtimeStatus === "SESSION_SAVING") {
    return "QR dipindai. Menyimpan sesi WhatsApp ke disk.";
  }

  if (login.runtimeStatus === "WAITING_SOCKET_CONNECT") {
    return "QR dipindai. Menunggu socket WhatsApp stabil.";
  }

  if (login.runtimeStatus === "LOGIN_FAILED") {
    const prefix = login.loginFailureReason ? `${login.loginFailureReason}: ` : "";
    return `WhatsApp login failed: ${prefix}${login.error || login.lastDisconnectReason || "unknown error"}`;
  }

  return "Menyiapkan QR WhatsApp.";
}

function buildActiveWebLoginSnapshot(login: ActiveLogin): ActiveWebLoginSnapshot {
  return {
    accountId: login.accountId,
    connected: Boolean(login.connected),
    qrDataUrl: login.connected ? undefined : login.qrDataUrl,
    qrExpiresAt:
      !login.connected && login.qrDataUrl && login.qrIssuedAtMs
        ? new Date(login.qrIssuedAtMs + ACTIVE_LOGIN_TTL_MS).toISOString()
        : undefined,
    runtimeStatus: login.connected ? "CONNECTED" : login.runtimeStatus,
    linkState: login.connected ? "CONNECTED" : login.linkState,
    qrScannedAt: login.qrScannedAt,
    browserConnectedAt: login.browserConnectedAt,
    socketConnectedAt: login.socketConnectedAt,
    authStateLoadedAt: login.authStateLoadedAt,
    sessionPersistedAt: login.sessionPersistedAt,
    lastDisconnectReason: login.lastDisconnectReason,
    loginFailureReason: login.loginFailureReason,
    browserClosedUnexpectedly: login.browserClosedUnexpectedly === true,
    whatsappSocketState: login.whatsappSocketState,
    puppeteerBrowserState: login.puppeteerBrowserState,
    lastSocketError: login.lastSocketError,
    lastConnectionUpdate: login.lastConnectionUpdate,
    lastDisconnectRaw: login.lastDisconnectRaw,
    lastSocketErrorRaw: login.lastSocketErrorRaw,
    rawFailure: login.rawFailure,
    error: login.error,
    errorStatus: login.errorStatus,
    code: login.loginFailureReason,
    restartAttempted: login.restartAttempted,
    message: resolveLoginMessage(login),
  };
}

export function getActiveWebLoginSnapshot(accountId?: string | null): ActiveWebLoginSnapshot | null {
  const normalizedAccountId = typeof accountId === "string" ? accountId.trim() : "";
  if (!normalizedAccountId) {
    return null;
  }

  const login = activeLogins.get(normalizedAccountId);
  if (!login) {
    return null;
  }

  if (!isLoginFresh(login)) {
    dropActiveLogin(normalizedAccountId);
    return null;
  }

  return buildActiveWebLoginSnapshot(login);
}

async function storeQrForLogin(
  login: ActiveLogin,
  qr: string,
  runtime: RuntimeEnv,
  onFirstQrReady?: () => void,
) {
  const current = activeLogins.get(login.accountId);
  if (current?.id !== login.id) {
    return;
  }

  const hadPreviousScan = Boolean(current.qrScannedAt);
  if (hadPreviousScan && !current.connected) {
    current.loginFailureReason = "QR_EXPIRED_AFTER_SCAN";
    current.lastDisconnectReason =
      current.lastDisconnectReason || "QR expired after scan; waiting for a fresh QR.";
    resetPostScanProgress(current);
  }

  current.qr = qr;
  current.qrIssuedAtMs = Date.now();
  current.whatsappSocketState = resolveSocketState(current.sock);
  setLoginStage(current, "WAITING_QR");
  runtime.log(
    info(
      hadPreviousScan
        ? "WhatsApp generated a fresh QR after the previous scan stalled."
        : "WhatsApp QR received.",
    ),
  );

  const base64 = await renderQrPngBase64(qr, QR_RENDER_OPTIONS);
  const latest = activeLogins.get(login.accountId);
  if (latest?.id !== login.id) {
    return;
  }

  latest.qrDataUrl = `data:image/png;base64,${base64}`;
  onFirstQrReady?.();
}

async function createInstrumentedSocket(
  login: ActiveLogin,
  runtime: RuntimeEnv,
  hooks: {
    onFirstQrReady?: () => void;
    onFirstQrError?: (err: Error) => void;
  } = {},
) {
  return await createWaSocket(false, login.verbose, {
    authDir: login.authDir,
    onAuthStateLoaded: ({ loadedAt }) => {
      login.authStateLoadedAt = login.authStateLoadedAt ?? loadedAt;
      login.whatsappSocketState = resolveSocketState(login.sock);
      if (login.runtimeStatus !== "WAITING_QR") {
        setLoginStage(login, "AUTH_LOADING");
      }
    },
    onQr: (qr: string) => {
      void storeQrForLogin(login, qr, runtime, hooks.onFirstQrReady).catch((err) => {
        const current = activeLogins.get(login.accountId);
        if (current?.id !== login.id) {
          return;
        }
        markLoginFailure(current, err, "NETWORK_TIMEOUT");
        hooks.onFirstQrError?.(err instanceof Error ? err : new Error(String(err)));
      });
    },
    onCredsUpdate: () => {
      if (!login.qrIssuedAtMs && !login.qrScannedAt) {
        return;
      }
      markQrScanned(login);
      login.whatsappSocketState = resolveSocketState(login.sock);
      setLoginStage(login, "AUTH_LOADING");
    },
    onCredsSave: (result) => {
      if (!login.qrIssuedAtMs && !login.qrScannedAt && !login.socketConnectedAt) {
        return;
      }
      if (result.ok) {
        login.sessionPersistedAt = result.savedAt;
        login.whatsappSocketState = resolveSocketState(login.sock);
        setLoginStage(login, "SESSION_SAVING");
        return;
      }

      markLoginFailure(
        login,
        result.error ?? new Error("Failed saving WhatsApp credentials"),
        "AUTH_SAVE_FAILED",
      );
    },
    onConnectionUpdate: (update: ConnectionUpdate) => {
      login.lastConnectionUpdate = summarizeConnectionUpdate(update);
      login.whatsappSocketState = resolveSocketState(login.sock);

      if (
        login.qrIssuedAtMs &&
        !login.connected &&
        (update.isNewLogin === true || update.receivedPendingNotifications === true)
      ) {
        markQrScanned(login);
        setLoginStage(login, "QR_SCANNED");
      }

      if (update.connection === "open") {
        markSocketConnected(login);
      }

      if (update.connection === "close") {
        const disconnectError = update.lastDisconnect?.error ?? update.lastDisconnect;
        login.lastDisconnectRaw = update.lastDisconnect ?? disconnectError;
        login.lastDisconnectReason = disconnectError
          ? formatError(disconnectError)
          : "Connection closed";
        if (login.qrScannedAt && getStatusCode(disconnectError) !== LOGGED_OUT_STATUS) {
          login.browserClosedUnexpectedly = true;
        }
      }
    },
    onSocketError: (err) => {
      login.lastSocketError = formatError(err);
      login.lastSocketErrorRaw = err;
      login.whatsappSocketState = resolveSocketState(login.sock);
      if (login.qrScannedAt && !login.connected) {
        login.browserClosedUnexpectedly = true;
      }
    },
  });
}

function attachLoginWaiter(accountId: string, login: ActiveLogin) {
  if (!login.sock) {
    login.waitPromise = Promise.resolve();
    return;
  }

  login.waitPromise = waitForWaConnection(login.sock)
    .then(() => {
      const current = activeLogins.get(accountId);
      if (current?.id === login.id) {
        markSocketConnected(current);
      }
    })
    .catch((err) => {
      const current = activeLogins.get(accountId);
      if (current?.id !== login.id) {
        return;
      }
      current.lastDisconnectRaw = current.lastDisconnectRaw ?? err;
      current.lastDisconnectReason = current.lastDisconnectReason ?? formatError(err);
      markLoginFailure(current, err);
    });
}

async function restartLoginSocket(login: ActiveLogin, runtime: RuntimeEnv) {
  if (login.restartAttempted) {
    return false;
  }

  login.restartAttempted = true;
  runtime.log(info("WhatsApp login socket needs one restart; waiting for creds to save…"));
  clearSocketCloseTimer(login);
  closeSocket(login.sock);
  await waitForCredsSaveQueueWithTimeout(login.authDir);

  try {
    login.sock = await createInstrumentedSocket(login, runtime);
    login.connected = false;
    clearEphemeralErrors(login);
    login.whatsappSocketState = resolveSocketState(login.sock);
    setLoginStage(login, login.qrDataUrl ? "WAITING_QR" : "WAITING_SOCKET_CONNECT");
    attachLoginWaiter(login.accountId, login);
    return true;
  } catch (err) {
    markLoginFailure(login, err);
    return false;
  }
}

async function waitForPersistedIdentity(login: ActiveLogin) {
  const deadline = Date.now() + SELF_ID_PERSIST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (login.error) {
      throw login.rawFailure ?? new Error(login.error);
    }

    const self = readWebSelfId(login.authDir);
    if (self.e164 || self.jid || self.lid) {
      return self;
    }

    await sleep(POST_SCAN_POLL_MS);
  }

  throw new Error("Timed out waiting for persisted WhatsApp identity after QR scan");
}

async function waitForStableSocket(login: ActiveLogin) {
  const deadline = Date.now() + POST_SCAN_STABLE_WINDOW_MS;
  while (Date.now() < deadline) {
    if (login.error) {
      throw login.rawFailure ?? new Error(login.error);
    }

    const socketState = resolveSocketState(login.sock);
    login.whatsappSocketState = socketState;
    if (socketState === "CLOSING" || socketState === "CLOSED") {
      login.browserClosedUnexpectedly = true;
      throw new Error("WhatsApp socket closed during post-scan stabilization");
    }

    await sleep(POST_SCAN_POLL_MS);
  }
}

async function finalizeConnectedLogin(login: ActiveLogin) {
  markSocketConnected(login);
  setLoginStage(login, "SESSION_SAVING");
  await waitForCredsSaveQueueWithTimeout(login.authDir, CREDS_PERSIST_TIMEOUT_MS);

  if (login.error) {
    throw login.rawFailure ?? new Error(login.error);
  }

  if (!login.sessionPersistedAt) {
    throw new Error("Timed out waiting for WhatsApp credentials to persist");
  }

  setLoginStage(login, "WAITING_SOCKET_CONNECT");
  await waitForPersistedIdentity(login);
  await waitForStableSocket(login);

  login.connected = true;
  clearEphemeralErrors(login);
  login.loginFailureReason = undefined;
  login.browserClosedUnexpectedly = false;
  login.qr = undefined;
  login.qrDataUrl = undefined;
  login.qrIssuedAtMs = undefined;
  login.whatsappSocketState = resolveSocketState(login.sock);
  setLoginStage(login, "CONNECTED");
  markLoginFinished(login, 1_000);
}

function shouldRestartLoginSocket(login: ActiveLogin) {
  if (login.restartAttempted) {
    return false;
  }
  if (login.errorStatus === 515) {
    return true;
  }
  return (
    Boolean(login.qrScannedAt) &&
    ["BROWSER_CLOSED", "SOCKET_DISCONNECTED"].includes(login.loginFailureReason || "")
  );
}

export async function startWebLoginWithQr(
  opts: {
    verbose?: boolean;
    timeoutMs?: number;
    force?: boolean;
    accountId?: string;
    runtime?: RuntimeEnv;
  } = {},
): Promise<{ qrDataUrl?: string; qrExpiresAt?: string; message: string }> {
  const runtime = opts.runtime ?? defaultRuntime;
  const cfg = loadConfig();
  const account = resolveWhatsAppAccount({ cfg, accountId: opts.accountId });

  if (opts.force) {
    await logoutWeb({
      authDir: account.authDir,
      isLegacyAuthDir: account.isLegacyAuthDir,
      runtime,
    }).catch(() => false);
  }

  const hasWeb = await webAuthExists(account.authDir);
  const selfId = readWebSelfId(account.authDir);
  if (hasWeb && !opts.force) {
    const who = selfId.e164 ?? selfId.jid ?? "unknown";
    return {
      message: `WhatsApp is already linked (${who}). Say “relink” if you want a fresh QR.`,
    };
  }

  const existing = activeLogins.get(account.accountId);
  if (existing && isLoginFresh(existing) && existing.qrDataUrl) {
    return buildActiveWebLoginSnapshot(existing);
  }

  dropActiveLogin(account.accountId);

  let resolveQr: (() => void) | null = null;
  let rejectQr: ((err: Error) => void) | null = null;
  const qrPromise = new Promise<void>((resolve, reject) => {
    resolveQr = resolve;
    rejectQr = reject;
  });

  let qrSettled = false;
  const settleQrReady = () => {
    if (qrSettled) {
      return;
    }
    qrSettled = true;
    clearTimeout(qrTimer);
    resolveQr?.();
  };
  const settleQrError = (err: Error) => {
    if (qrSettled) {
      return;
    }
    qrSettled = true;
    clearTimeout(qrTimer);
    rejectQr?.(err);
  };

  const qrTimer = setTimeout(() => {
    settleQrError(new Error("Timed out waiting for WhatsApp QR"));
  }, Math.max(opts.timeoutMs ?? 30_000, QR_TIMEOUT_FLOOR_MS));

  const login: ActiveLogin = {
    accountId: account.accountId,
    authDir: account.authDir,
    isLegacyAuthDir: account.isLegacyAuthDir,
    id: randomUUID(),
    sock: null,
    startedAt: Date.now(),
    connected: false,
    waitPromise: Promise.resolve(),
    restartAttempted: false,
    verbose: Boolean(opts.verbose),
    runtimeStatus: "AUTH_LOADING",
    linkState: "AUTH_LOADING",
    browserClosedUnexpectedly: false,
    whatsappSocketState: "INITIALIZING",
    puppeteerBrowserState: "NOT_USED",
  };
  activeLogins.set(account.accountId, login);

  try {
    login.sock = await createInstrumentedSocket(login, runtime, {
      onFirstQrReady: settleQrReady,
      onFirstQrError: settleQrError,
    });
    login.whatsappSocketState = resolveSocketState(login.sock);
  } catch (err) {
    settleQrError(err instanceof Error ? err : new Error(String(err)));
    markLoginFailure(login, err);
    markLoginFinished(login, 0);
    return buildActiveWebLoginSnapshot(login);
  }

  attachLoginWaiter(account.accountId, login);

  try {
    await qrPromise;
  } catch (err) {
    markLoginFailure(login, err, "NETWORK_TIMEOUT");
    markLoginFinished(login, 0);
    return buildActiveWebLoginSnapshot(login);
  }

  return buildActiveWebLoginSnapshot(login);
}

export async function waitForWebLogin(
  opts: { timeoutMs?: number; runtime?: RuntimeEnv; accountId?: string } = {},
): Promise<{ connected: boolean; message: string }> {
  const runtime = opts.runtime ?? defaultRuntime;
  const cfg = loadConfig();
  const account = resolveWhatsAppAccount({ cfg, accountId: opts.accountId });
  const activeLogin = activeLogins.get(account.accountId);
  if (!activeLogin) {
    return {
      connected: false,
      message: "No active WhatsApp login in progress.",
    };
  }

  const login = activeLogin;
  if (!isLoginFresh(login)) {
    dropActiveLogin(account.accountId);
    return {
      connected: false,
      message: "The login QR expired. Ask me to generate a new one.",
    };
  }

  const timeoutMs = Math.max(opts.timeoutMs ?? 120_000, 1_000);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (login.connected) {
      return buildActiveWebLoginSnapshot(login);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const snapshot = buildActiveWebLoginSnapshot(login);
      return snapshot.runtimeStatus === "AUTH_LOADING" && !snapshot.qrDataUrl
        ? {
            connected: false,
            message: "Still preparing the WhatsApp QR. Let me know if this keeps stalling.",
          }
        : snapshot;
    }

    const result = await Promise.race([
      login.waitPromise.then(() => "done" as const),
      new Promise<"timeout">((resolve) => {
        const timer = setTimeout(() => resolve("timeout"), Math.min(remaining, 1_000));
        timer.unref?.();
      }),
    ]);

    if (login.error) {
      if (login.errorStatus === LOGGED_OUT_STATUS) {
        await logoutWeb({
          authDir: login.authDir,
          isLegacyAuthDir: login.isLegacyAuthDir,
          runtime,
        });
        const message =
          "WhatsApp reported the session is logged out. Cleared cached web session; please scan a new QR.";
        login.error = message;
        login.loginFailureReason = classifyLoginFailureReason(login, login.rawFailure ?? login.error);
        setLoginStage(login, "LOGIN_FAILED");
        markLoginFinished(login, 0);
        runtime.log(danger(message));
        return buildActiveWebLoginSnapshot(login);
      }

      if (shouldRestartLoginSocket(login)) {
        const restarted = await restartLoginSocket(login, runtime);
        if (restarted && isLoginFresh(login)) {
          continue;
        }
      }

      markLoginFinished(login, 0);
      const snapshot = buildActiveWebLoginSnapshot(login);
      runtime.log(danger(snapshot.message));
      return snapshot;
    }

    if (
      result === "done" &&
      !login.connected &&
      (login.socketConnectedAt || login.runtimeStatus === "WAITING_SOCKET_CONNECT")
    ) {
      try {
        await finalizeConnectedLogin(login);
        const snapshot = buildActiveWebLoginSnapshot(login);
        runtime.log(success(snapshot.message));
        return snapshot;
      } catch (err) {
        markLoginFailure(
          login,
          err,
          login.sessionPersistedAt ? undefined : "AUTH_SAVE_FAILED",
        );
        continue;
      }
    }

    if (
      result === "timeout" &&
      login.runtimeStatus === "WAITING_QR" &&
      login.loginFailureReason === "QR_EXPIRED_AFTER_SCAN" &&
      login.qrDataUrl
    ) {
      return buildActiveWebLoginSnapshot(login);
    }

    if (result === "timeout") {
      continue;
    }

    return buildActiveWebLoginSnapshot(login);
  }
}

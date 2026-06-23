/** Ключи localStorage для совместимости с Chat.tsx (email, subscription, Talk-Me snapshot). */

const KEYS = {
  email: "vpn_email",
  subscriptionUrl: "vpn_subscription_url",
  talkmeProfile: "vpn_talkme_profile",
} as const;

/** Ключ sessionStorage для отложенного редиректа после логина из RequireVpnAuth. */
const PENDING_REDIRECT_KEY = "vpn_pending_redirect";
const PENDING_REF_UUID_KEY = "vpn_pending_ref_uuid";
const PENDING_PROMO_CODE_KEY = "vpn_pending_promo_code";
const PENDING_REDIRECT_MAX_LEN = 1024;
const PENDING_REF_UUID_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_PROMO_CODE_TTL_MS = 24 * 60 * 60 * 1000;

type PendingRefUuidRecord = {
  uuid: string;
  ts: number;
};

type PendingPromoCodeRecord = {
  code: string;
  ts: number;
};

const REF_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROMO_CODE_RE = /^[A-Z0-9_-]{2,64}$/;

function isValidRefUuid(value: string): boolean {
  return REF_UUID_RE.test(value.trim());
}

export function normalizePromoCode(value: string): string {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!PROMO_CODE_RE.test(normalized)) return "";
  return normalized;
}

function readPendingRefUuidRecord(): PendingRefUuidRecord | null {
  try {
    const raw = localStorage.getItem(PENDING_REF_UUID_KEY);
    if (!raw) {
      const legacyRaw = sessionStorage.getItem(PENDING_REF_UUID_KEY);
      const legacyUuid = legacyRaw && isValidRefUuid(legacyRaw) ? legacyRaw.trim() : "";
      if (!legacyUuid) return null;

      const record = { uuid: legacyUuid, ts: Date.now() };
      localStorage.setItem(PENDING_REF_UUID_KEY, JSON.stringify(record));
      sessionStorage.removeItem(PENDING_REF_UUID_KEY);
      return record;
    }

    const parsed = JSON.parse(raw) as Partial<PendingRefUuidRecord> | null;
    const uuid = typeof parsed?.uuid === "string" ? parsed.uuid.trim() : "";
    const ts = typeof parsed?.ts === "number" ? parsed.ts : 0;
    if (!uuid || !isValidRefUuid(uuid) || !Number.isFinite(ts)) {
      localStorage.removeItem(PENDING_REF_UUID_KEY);
      return null;
    }
    if (Date.now() - ts > PENDING_REF_UUID_TTL_MS) {
      localStorage.removeItem(PENDING_REF_UUID_KEY);
      return null;
    }
    return { uuid, ts };
  } catch {
    try {
      localStorage.removeItem(PENDING_REF_UUID_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

export const VPN_STORAGE_KEY_PREFIX = "vpn_";

function isSafeInternalPath(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  if (path.length > PENDING_REDIRECT_MAX_LEN) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.startsWith("/\\")) return false;
  if (/^\/*[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false;
  return true;
}

/** Email для чата и sidebar (серверная сессия — отдельно, в cookies). */
export function getVpnAuthEmail(): string {
  try {
    return (localStorage.getItem(KEYS.email) ?? "").trim();
  } catch {
    return "";
  }
}

export function persistChatCompatCache(opts: {
  email: string;
  subscriptionUrl?: string;
  talkmeProfileJson?: string;
}): void {
  try {
    if (opts.email) localStorage.setItem(KEYS.email, opts.email.trim().toLowerCase());
    if (opts.subscriptionUrl) localStorage.setItem(KEYS.subscriptionUrl, opts.subscriptionUrl.trim());
    if (opts.talkmeProfileJson) localStorage.setItem(KEYS.talkmeProfile, opts.talkmeProfileJson);
  } catch {
    // ignore
  }
}

export function clearChatCompatCache(): void {
  try {
    localStorage.removeItem(KEYS.email);
    localStorage.removeItem(KEYS.subscriptionUrl);
    localStorage.removeItem(KEYS.talkmeProfile);
  } catch {
    // ignore
  }
}

/** @deprecated use clearChatCompatCache */
export function clearVpnAuthAndCaches(): void {
  clearChatCompatCache();
}

export function setVpnSubscriptionUrl(url: string): void {
  try {
    localStorage.setItem(KEYS.subscriptionUrl, url);
  } catch {
    // ignore
  }
}

export function setVpnTalkmeProfileJson(json: string): void {
  try {
    localStorage.setItem(KEYS.talkmeProfile, json);
  } catch {
    // ignore
  }
}

export function getVpnSubscriptionUrl(): string {
  try {
    return (localStorage.getItem(KEYS.subscriptionUrl) ?? "").trim();
  } catch {
    return "";
  }
}

export function getVpnTalkmeProfileRaw(): string | null {
  try {
    return localStorage.getItem(KEYS.talkmeProfile);
  } catch {
    return null;
  }
}

export function setVpnPendingRedirect(path: string): void {
  if (!isSafeInternalPath(path)) return;
  try {
    sessionStorage.setItem(PENDING_REDIRECT_KEY, path);
  } catch {
    // ignore
  }
}

export function peekVpnPendingRedirect(): string {
  try {
    const raw = sessionStorage.getItem(PENDING_REDIRECT_KEY);
    if (raw && isSafeInternalPath(raw)) return raw;
  } catch {
    // ignore
  }
  return "";
}

export function consumeVpnPendingRedirect(): string {
  try {
    const raw = sessionStorage.getItem(PENDING_REDIRECT_KEY);
    sessionStorage.removeItem(PENDING_REDIRECT_KEY);
    if (raw && isSafeInternalPath(raw)) return raw;
  } catch {
    // ignore
  }
  return "";
}

export function setPendingRefUuid(uuid: string): void {
  const trimmed = typeof uuid === "string" ? uuid.trim() : "";
  if (!trimmed || !isValidRefUuid(trimmed)) return;
  try {
    localStorage.setItem(PENDING_REF_UUID_KEY, JSON.stringify({ uuid: trimmed, ts: Date.now() }));
  } catch {
    // ignore
  }
}

export function consumePendingRefUuid(): string {
  try {
    const record = readPendingRefUuidRecord();
    localStorage.removeItem(PENDING_REF_UUID_KEY);
    sessionStorage.removeItem(PENDING_REF_UUID_KEY);
    if (record) return record.uuid;
  } catch {
    // ignore
  }
  return "";
}

export function peekPendingRefUuid(): string {
  return readPendingRefUuidRecord()?.uuid ?? "";
}

function readPendingPromoCodeRecord(): PendingPromoCodeRecord | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PROMO_CODE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingPromoCodeRecord> | null;
    const code = normalizePromoCode(typeof parsed?.code === "string" ? parsed.code : "");
    const ts = typeof parsed?.ts === "number" ? parsed.ts : 0;
    if (!code || !Number.isFinite(ts)) {
      sessionStorage.removeItem(PENDING_PROMO_CODE_KEY);
      return null;
    }
    if (Date.now() - ts > PENDING_PROMO_CODE_TTL_MS) {
      sessionStorage.removeItem(PENDING_PROMO_CODE_KEY);
      return null;
    }
    return { code, ts };
  } catch {
    try {
      sessionStorage.removeItem(PENDING_PROMO_CODE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

export function setPendingPromoCode(code: string): void {
  const normalized = normalizePromoCode(code);
  if (!normalized) return;
  try {
    sessionStorage.setItem(PENDING_PROMO_CODE_KEY, JSON.stringify({ code: normalized, ts: Date.now() }));
  } catch {
    // ignore
  }
}

export function peekPendingPromoCode(): string {
  return readPendingPromoCodeRecord()?.code ?? "";
}

export function consumePendingPromoCode(): string {
  try {
    const record = readPendingPromoCodeRecord();
    sessionStorage.removeItem(PENDING_PROMO_CODE_KEY);
    return record?.code ?? "";
  } catch {
    return "";
  }
}

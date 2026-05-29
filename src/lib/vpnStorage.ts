/** Ключи localStorage для совместимости с Chat.tsx (email, subscription, Talk-Me snapshot). */

const KEYS = {
  email: "vpn_email",
  subscriptionUrl: "vpn_subscription_url",
  talkmeProfile: "vpn_talkme_profile",
} as const;

/** Ключ sessionStorage для отложенного редиректа после логина из RequireVpnAuth. */
const PENDING_REDIRECT_KEY = "vpn_pending_redirect";
const PENDING_REF_UUID_KEY = "vpn_pending_ref_uuid";
const PENDING_REDIRECT_MAX_LEN = 1024;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidRefUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
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
    sessionStorage.setItem(PENDING_REF_UUID_KEY, trimmed);
  } catch {
    // ignore
  }
}

export function consumePendingRefUuid(): string {
  try {
    const raw = sessionStorage.getItem(PENDING_REF_UUID_KEY);
    sessionStorage.removeItem(PENDING_REF_UUID_KEY);
    if (raw && isValidRefUuid(raw)) return raw.trim();
  } catch {
    // ignore
  }
  return "";
}

export function peekPendingRefUuid(): string {
  try {
    const raw = sessionStorage.getItem(PENDING_REF_UUID_KEY);
    if (raw && isValidRefUuid(raw)) return raw.trim();
  } catch {
    // ignore
  }
  return "";
}

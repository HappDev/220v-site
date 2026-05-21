/** Ключи localStorage для совместимости с Chat.tsx (email, subscription, Talk-Me snapshot). */

const KEYS = {
  email: "vpn_email",
  subscriptionUrl: "vpn_subscription_url",
  talkmeProfile: "vpn_talkme_profile",
} as const;

/** Ключ sessionStorage для отложенного редиректа после логина из RequireVpnAuth. */
const PENDING_REDIRECT_KEY = "vpn_pending_redirect";
const PENDING_REDIRECT_MAX_LEN = 1024;

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

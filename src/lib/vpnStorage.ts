/** Длительность «сессии» входа по email-коду: ~2 месяца (60 суток). */
export const VPN_AUTH_DURATION_MS = 60 * 24 * 60 * 60 * 1000;

const KEYS = {
  email: "vpn_email",
  hash: "vpn_hash",
  code: "vpn_code",
  expiresAt: "vpn_auth_expires_at",
  subscriptionUrl: "vpn_subscription_url",
  talkmeProfile: "vpn_talkme_profile",
} as const;

/** Ключ sessionStorage для отложенного редиректа после логина из RequireVpnAuth. */
const PENDING_REDIRECT_KEY = "vpn_pending_redirect";

/** Максимальная длина пути — защита от случайно огромных значений. */
const PENDING_REDIRECT_MAX_LEN = 1024;

function wipeLocalVpnKeys(): void {
  for (const k of Object.values(KEYS)) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
}

function wipeSessionLegacyAuth(): void {
  try {
    sessionStorage.removeItem(KEYS.email);
    sessionStorage.removeItem(KEYS.hash);
    sessionStorage.removeItem(KEYS.code);
    sessionStorage.removeItem(KEYS.subscriptionUrl);
    sessionStorage.removeItem(KEYS.talkmeProfile);
  } catch {
    // ignore
  }
}

/** Сохранить вход: общий для всех вкладок origin, срок — {@link VPN_AUTH_DURATION_MS}. */
export function persistVpnAuth(email: string, hash: string, code: string): void {
  const exp = Date.now() + VPN_AUTH_DURATION_MS;
  try {
    localStorage.setItem(KEYS.email, email);
    localStorage.setItem(KEYS.hash, hash);
    localStorage.setItem(KEYS.code, code);
    localStorage.setItem(KEYS.expiresAt, String(exp));
  } catch {
    // ignore
  }
  wipeSessionLegacyAuth();
}

/** Удалить авторизацию и кэши профиля (выход). */
export function clearVpnAuthAndCaches(): void {
  wipeLocalVpnKeys();
  wipeSessionLegacyAuth();
}

/**
 * Email текущего входа или пустая строка, если срок истёк / данных нет.
 * Поддерживает одноразовую миграцию со старого sessionStorage.
 */
export function getVpnAuthEmail(): string {
  try {
    const email = (localStorage.getItem(KEYS.email) ?? "").trim();
    const expRaw = localStorage.getItem(KEYS.expiresAt);
    const exp = expRaw ? Number(expRaw) : NaN;
    const validLocal = email && Number.isFinite(exp) && Date.now() <= exp;

    if (validLocal) return email;

    const hasLocalAuth =
      localStorage.getItem(KEYS.email) ||
      localStorage.getItem(KEYS.hash) ||
      localStorage.getItem(KEYS.code) ||
      localStorage.getItem(KEYS.expiresAt);
    if (hasLocalAuth) {
      wipeLocalVpnKeys();
    }

    const sEmail = (sessionStorage.getItem(KEYS.email) ?? "").trim();
    const sHash = sessionStorage.getItem(KEYS.hash) ?? "";
    const sCode = sessionStorage.getItem(KEYS.code) ?? "";
    if (sEmail && sHash && sCode) {
      persistVpnAuth(sEmail, sHash, sCode);
      return sEmail;
    }

    return "";
  } catch {
    return "";
  }
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

/** Ключи localStorage для отладки / события storage между вкладками. */
export const VPN_STORAGE_KEY_PREFIX = "vpn_";

/**
 * Проверяет, что путь — безопасный внутренний (начинается с одного '/', не содержит схемы/хоста).
 * Используется перед сохранением в pending redirect.
 */
function isSafeInternalPath(path: string): boolean {
  if (!path || typeof path !== "string") return false;
  if (path.length > PENDING_REDIRECT_MAX_LEN) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.startsWith("/\\")) return false;
  // Исключаем попытки подсунуть абсолютный URL с схемой.
  if (/^\/*[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false;
  return true;
}

/**
 * Сохраняет желаемый путь (pathname + search + hash) для перехода после логина.
 * Хранится в sessionStorage текущей вкладки, очищается одним вызовом {@link consumeVpnPendingRedirect}.
 */
export function setVpnPendingRedirect(path: string): void {
  if (!isSafeInternalPath(path)) return;
  try {
    sessionStorage.setItem(PENDING_REDIRECT_KEY, path);
  } catch {
    // ignore
  }
}

/** Считывает и удаляет pending redirect. Возвращает пустую строку, если нечего возвращать. */
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

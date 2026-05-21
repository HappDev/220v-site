export const apiBase =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)v220_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

type ApiResult<T> = { data: T | null; error: Error | null; status: number };

async function parseResponse<T>(res: Response): Promise<ApiResult<T>> {
  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { error: text || "Invalid JSON" };
  }

  const data = parsed as T | null;

  if (!res.ok) {
    const msg =
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `Request failed (${res.status})`;
    return { data, error: new Error(msg), status: res.status };
  }

  return { data, error: null, status: res.status };
}

async function apiFetch<T>(
  path: string,
  init: RequestInit & { method?: string } = {},
): Promise<ApiResult<T>> {
  const method = (init.method || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (method !== "GET" && method !== "HEAD") {
    const csrf = getCsrfToken();
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    method,
    headers,
    credentials: "include",
  });

  return parseResponse<T>(res);
}

export function apiGet<T>(path: string) {
  return apiFetch<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body?: Record<string, unknown>) {
  return apiFetch<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete<T>(path: string) {
  return apiFetch<T>(path, { method: "DELETE" });
}

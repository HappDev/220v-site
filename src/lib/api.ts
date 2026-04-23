export const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "/api";

type FunctionName = "send-code" | "remnawave-proxy" | "billing/meta" | "billing/checkout";

export async function invokeFunction<T = Record<string, unknown>>(
  name: FunctionName,
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: Error | null }> {
  const url = `${apiBase}/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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
      typeof parsed === "object" && parsed !== null && "error" in parsed && typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `Request failed (${res.status})`;
    return { data, error: new Error(msg) };
  }

  return { data, error: null };
}

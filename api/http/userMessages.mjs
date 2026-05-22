import { FETCH_TIMEOUT_MS } from "../config.mjs";

export function isTimeoutError(err) {
  if (!err) return false;
  if (err.isTimeout === true) return true;
  if (err.name === "TimeoutError") return true;
  if (err.code === "ETIMEDOUT" || err.code === "ESOCKETTIMEDOUT") return true;

  const message = String(err.message || err).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("aborted due to timeout")
  );
}

export function formatTimeoutMessage(timeoutMs = FETCH_TIMEOUT_MS, context) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const contextPart = context ? ` (${context})` : "";
  return `Превышено время ожидания ответа${contextPart}: ${seconds} сек. Сервер не успел ответить — попробуйте ещё раз через минуту.`;
}

export function publicMessageFromErr(err, fallback, { timeoutMs = FETCH_TIMEOUT_MS, context } = {}) {
  if (isTimeoutError(err)) {
    if (typeof err?.message === "string" && err.message.includes("Превышено время ожидания")) {
      return err.message;
    }
    return formatTimeoutMessage(err?.timeoutMs ?? timeoutMs, context);
  }
  if (typeof err?.publicMessage === "string" && err.publicMessage.trim()) {
    return err.publicMessage;
  }
  return fallback;
}

export function timeoutStatusCode(err) {
  return isTimeoutError(err) ? 504 : 500;
}

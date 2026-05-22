import { FETCH_TIMEOUT_MS } from "../config.mjs";
import { formatTimeoutMessage, isTimeoutError } from "./userMessages.mjs";

function urlContext(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return null;
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      const timeoutErr = new Error(formatTimeoutMessage(timeoutMs, urlContext(url)));
      timeoutErr.isTimeout = true;
      timeoutErr.timeoutMs = timeoutMs;
      throw timeoutErr;
    }
    throw err;
  }
}

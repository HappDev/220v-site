import { createHmac } from "node:crypto";

import { timingSafeEqualStr } from "../auth/crypto.mjs";
import { UUID_RE } from "../config.mjs";

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export class UnsubscribeTokenError extends Error {
  constructor(message = "invalid unsubscribe token") {
    super(message);
    this.name = "UnsubscribeTokenError";
  }
}

export class UnsubscribeTokenConfigError extends Error {
  constructor(message = "unsubscribe secret is not configured") {
    super(message);
    this.name = "UnsubscribeTokenConfigError";
  }
}

function invalidToken() {
  return new UnsubscribeTokenError();
}

function assertBase64UrlPart(value) {
  return typeof value === "string" && value.length > 0 && BASE64URL_RE.test(value);
}

export function verifyUnsubscribeToken(token, secret) {
  const safeSecret = typeof secret === "string" ? secret.trim() : "";
  if (!safeSecret) {
    throw new UnsubscribeTokenConfigError();
  }
  if (typeof token !== "string") {
    throw invalidToken();
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw invalidToken();
  }

  const [, payloadB64, sigB64] = parts;
  if (!assertBase64UrlPart(payloadB64) || !assertBase64UrlPart(sigB64)) {
    throw invalidToken();
  }

  const expectedSig = createHmac("sha256", safeSecret)
    .update(payloadB64)
    .digest("base64url");
  if (!timingSafeEqualStr(sigB64, expectedSig)) {
    throw invalidToken();
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw invalidToken();
  }

  if (!payload || payload.v !== 1 || typeof payload.u !== "string") {
    throw invalidToken();
  }

  const userUuid = payload.u.trim();
  if (!UUID_RE.test(userUuid)) {
    throw invalidToken();
  }

  return userUuid;
}

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export function emailHash(email) {
  return createHash("sha256").update(email, "utf8").digest("hex").slice(0, 16);
}

export function maskEmail(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) return "";
  const [name, domain] = email.split("@");
  const visible = name.slice(0, 2);
  return `${visible}${name.length > 2 ? "***" : "*"}@${domain}`;
}

export function base64url(buf) {
  return buf.toString("base64url");
}

export function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function hashCode(code) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

export function generateOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

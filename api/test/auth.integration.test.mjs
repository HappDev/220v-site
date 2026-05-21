import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.COOKIE_SECURE = "false";
process.env.SES_SMTP_HOST = "email-smtp.test.invalid";
process.env.SES_SMTP_PORT = "465";
process.env.SES_SMTP_USER = "test-user";
process.env.SES_SMTP_PASSWORD = "test-pass";
process.env.MAIL_FROM_NAME = "220v Test";
process.env.MAIL_FROM_EMAIL = "test@example.invalid";
process.env.RMW_API_URL = "https://rmw.test";
process.env.RMW_API_KEY = "test-key";

const { app } = await import("../index.mjs");
const { redis } = await import("../redis.mjs");
const { hashCode } = await import("../auth/crypto.mjs");
const { otpCooldownKey, otpKey } = await import("../auth/keys.mjs");
const { acquireOtpCooldown, clearOtpAndCooldown, putOtp } = await import("../auth/otp.mjs");

describe("auth integration", () => {
  before(async () => {
    await redis.flushall();
  });

  beforeEach(async () => {
    await redis.flushall();
  });

  after(async () => {
    await redis.quit();
  });

  it("GET /api/me without cookie returns 401", async () => {
    const res = await request(app).get("/api/me");
    assert.equal(res.status, 401);
  });

  it("GET /api/health returns ok", async () => {
    const res = await request(app).get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });

  it("verify invalid code increments tries", async () => {
    const email = "user@example.com";
    const code = "123456";
    await redis.set(
      otpKey(email),
      JSON.stringify({ hash: hashCode(code), tries: 0, owner: "test-owner" }),
      "EX",
      600,
    );

    const res = await request(app)
      .post("/api/auth/verify")
      .send({ email, code: "000000" });

    assert.equal(res.status, 400);
  });

  it("allows only one active OTP cooldown per email", async () => {
    const email = "cooldown@example.com";

    const first = await acquireOtpCooldown(email, "owner-a", 60);
    const second = await acquireOtpCooldown(email, "owner-b", 60);

    assert.equal(first, "OK");
    assert.notEqual(second, "OK");
    assert.equal(await redis.get(otpCooldownKey(email)), "owner-a");
  });

  it("does not let old cleanup delete a newer owned OTP", async () => {
    const email = "cleanup@example.com";

    await putOtp(email, hashCode("111111"), "owner-old");
    await redis.set(otpCooldownKey(email), "owner-old", "EX", 60);
    await putOtp(email, hashCode("222222"), "owner-new");
    await redis.set(otpCooldownKey(email), "owner-new", "EX", 60);

    await clearOtpAndCooldown(email, "owner-old");

    const rawOtp = await redis.get(otpKey(email));
    const otp = JSON.parse(rawOtp);
    assert.equal(otp.owner, "owner-new");
    assert.equal(await redis.get(otpCooldownKey(email)), "owner-new");
  });

  it("DELETE /api/me/devices/x without session returns 401", async () => {
    const res = await request(app).delete("/api/me/devices/hwid-1");
    assert.equal(res.status, 401);
  });
});

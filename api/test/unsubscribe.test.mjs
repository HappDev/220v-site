import { createHmac } from "node:crypto";
import { describe, it, beforeEach, after } from "node:test";
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
process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";

const { app } = await import("../index.mjs");
const { redis } = await import("../redis.mjs");
const {
  UnsubscribeTokenError,
  verifyUnsubscribeToken,
} = await import("../email/unsubscribeToken.mjs");
const originalFetch = globalThis.fetch;

const USER_UUID = "b6810e6c-8a69-42b1-b298-8b07d8378987";

function buildToken(userUuid = USER_UUID, secret = process.env.EMAIL_UNSUBSCRIBE_SECRET) {
  const payloadB64 = Buffer.from(JSON.stringify({ v: 1, u: userUuid })).toString("base64url");
  const sigB64 = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `v1.${payloadB64}.${sigB64}`;
}

function buildTokenFromPayload(payloadB64, secret = process.env.EMAIL_UNSUBSCRIBE_SECRET) {
  const sigB64 = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `v1.${payloadB64}.${sigB64}`;
}

describe("unsubscribe token helper", () => {
  it("accepts RMW-compatible signed tokens", () => {
    assert.equal(verifyUnsubscribeToken(buildToken(), process.env.EMAIL_UNSUBSCRIBE_SECRET), USER_UUID);
  });

  it("rejects invalid version, payload, uuid, and signature", () => {
    const invalidJsonPayload = Buffer.from("not-json").toString("base64url");
    assert.throws(() => verifyUnsubscribeToken("v2.payload.sig", process.env.EMAIL_UNSUBSCRIBE_SECRET), UnsubscribeTokenError);
    assert.throws(
      () => verifyUnsubscribeToken(buildTokenFromPayload(invalidJsonPayload), process.env.EMAIL_UNSUBSCRIBE_SECRET),
      UnsubscribeTokenError,
    );
    assert.throws(
      () => verifyUnsubscribeToken(buildToken("not-a-uuid"), process.env.EMAIL_UNSUBSCRIBE_SECRET),
      UnsubscribeTokenError,
    );
    assert.throws(
      () => verifyUnsubscribeToken(`${buildToken()}x`, process.env.EMAIL_UNSUBSCRIBE_SECRET),
      UnsubscribeTokenError,
    );
  });
});

describe("POST /api/email/unsubscribe", () => {
  beforeEach(() => {
    process.env.RMW_API_URL = "https://rmw.test";
    process.env.RMW_API_KEY = "test-key";
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";
    globalThis.fetch = originalFetch;
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await redis.quit();
  });

  it("calls RMW unsubscribe endpoint with X-Api-Key for a valid request", async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return Response.json({ ok: true });
    };

    const res = await request(app)
      .post("/api/email/unsubscribe")
      .send({
        token: buildToken(),
        reason: "not_relevant",
        consent: true,
      });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://rmw.test/v1/email/unsubscribe/${USER_UUID}`);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].options.headers["X-Api-Key"], "test-key");
    assert.equal(calls[0].options.body, undefined);
  });

  it("rejects invalid signatures without calling RMW", async () => {
    globalThis.fetch = async () => {
      throw new Error("RMW should not be called");
    };

    const res = await request(app)
      .post("/api/email/unsubscribe")
      .send({
        token: `${buildToken()}x`,
        reason: "not_relevant",
        consent: true,
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Ссылка недействительна или устарела");
  });

  it("requires unsubscribe reason and consent", async () => {
    const missingReason = await request(app)
      .post("/api/email/unsubscribe")
      .send({
        token: buildToken(),
        consent: true,
      });
    assert.equal(missingReason.status, 400);
    assert.equal(missingReason.body.error, "Укажите причину отписки");

    const missingConsent = await request(app)
      .post("/api/email/unsubscribe")
      .send({
        token: buildToken(),
        reason: "not_relevant",
      });
    assert.equal(missingConsent.status, 400);
    assert.equal(missingConsent.body.error, "Подтвердите отписку");
  });

  it("requires text for the other reason without sending it to RMW", async () => {
    globalThis.fetch = async () => {
      throw new Error("RMW should not be called");
    };

    const res = await request(app)
      .post("/api/email/unsubscribe")
      .send({
        token: buildToken(),
        reason: "other",
        otherReason: " ",
        consent: true,
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Укажите причину отписки");
  });

  it("maps RMW 404 to a safe invalid-link error", async () => {
    let rmwBody;
    globalThis.fetch = async (_url, options = {}) => {
      rmwBody = options.body;
      return Response.json({ error: "user not found" }, { status: 404 });
    };

    const res = await request(app)
      .post("/api/email/unsubscribe")
      .send({
        token: buildToken(),
        reason: "other",
        otherReason: "Просто проверка формы",
        consent: true,
      });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Ссылка недействительна или устарела");
    assert.equal(rmwBody, undefined);
  });

  it("returns a controlled error when unsubscribe secret is missing", async () => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    globalThis.fetch = async () => {
      throw new Error("RMW should not be called");
    };

    const res = await request(app)
      .post("/api/email/unsubscribe")
      .send({
        token: buildToken(USER_UUID, "test-unsubscribe-secret"),
        reason: "not_relevant",
        consent: true,
      });

    assert.equal(res.status, 500);
    assert.equal(res.body.error, "Сервис отписки временно недоступен");
  });
});

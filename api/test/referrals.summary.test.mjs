import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.COOKIE_SECURE = "false";
process.env.ADMIN_REDIS_TOKEN = "admin-test-token";
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
const { refEventsListKey } = await import("../auth/keys.mjs");
const originalFetch = globalThis.fetch;

const REF_A = "11111111-1111-1111-8111-111111111111";
const REF_B = "22222222-2222-2222-8222-222222222222";
const REF_C = "33333333-3333-3333-8333-333333333333";
const REF_D = "44444444-4444-4444-8444-444444444444";

function event(overrides) {
  return {
    id: `evt-${Math.random().toString(16).slice(2)}`,
    type: "ref_click",
    at: new Date().toISOString(),
    referrerUuid: REF_A,
    ipHash: "ip-a",
    uaHash: "ua-a",
    fingerprintHash: "fp-a",
    selfReferral: false,
    path: "/api/test",
    refererUrl: "",
    ...overrides,
  };
}

async function seedEvents(events) {
  if (events.length === 0) return;
  await redis.lpush(refEventsListKey(), ...events.map((item) => JSON.stringify(item)));
}

function getSummary(query = "") {
  return request(app)
    .get(`/api/admin/referrals/summary${query}`)
    .set("X-Admin-Token", "admin-test-token");
}

describe("referral admin summary", () => {
  before(async () => {
    await redis.flushall();
  });

  beforeEach(async () => {
    await redis.flushall();
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  after(async () => {
    await redis.quit();
  });

  it("requires admin token", async () => {
    const res = await request(app).get("/api/admin/referrals/summary");
    assert.equal(res.status, 401);
  });

  it("returns totals, funnel, and sorted risky referrers", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await seedEvents([
      event({ type: "ref_click", referrerUuid: REF_A }),
      event({ type: "ref_send_code", referrerUuid: REF_A, referredEmailHash: "email-a" }),
      event({ type: "ref_verify_ok", referrerUuid: REF_A, referredEmailHash: "email-a", referredUuidPrefix: "user-a" }),
      event({ type: "ref_self_referral", referrerUuid: REF_A, referredEmailHash: "email-a", referredUuidPrefix: "user-a", selfReferral: true }),
      event({ type: "ref_checkout_by_referred", referrerUuid: REF_B, referredUuidPrefix: "user-b", tariffKey: "basic_1m" }),
    ]);

    const res = await getSummary("?days=30&limit=50");

    assert.equal(res.status, 200);
    assert.equal(res.body.totals.events, 5);
    assert.equal(res.body.totals.referrers, 2);
    assert.equal(res.body.funnel.clicks, 1);
    assert.equal(res.body.funnel.codes, 1);
    assert.equal(res.body.funnel.verifies, 1);
    assert.equal(res.body.funnel.checkouts, 1);
    assert.equal(res.body.funnel.selfReferrals, 1);
    const refA = res.body.referrers.find((referrer) => referrer.referrerUuid === REF_A);
    assert.ok(refA);
    // Self-referral is harmless (rejected by reward logic) and must not be flagged as fraud.
    assert.notEqual(refA.riskLevel, "critical");
    assert.ok(!refA.warnings.some((warning) => warning.code === "self_referral"));
    assert.equal(res.body.totals.multiAccountDetections, 0);
    assert.deepEqual(
      res.body.dailyRegistrations.find((item) => item.date === today),
      { date: today, registrations: 1, suspicious: 0 },
    );
  });

  it("flags another account active in the same browser as critical", async () => {
    await seedEvents([
      event({ type: "ref_click", referrerUuid: REF_A, otherUserUuidPrefix: "99999999", selfReferral: false }),
      event({ type: "ref_self_referral", referrerUuid: REF_B, otherUserUuidPrefix: "22222222", selfReferral: true }),
    ]);

    const res = await getSummary("?days=all&limit=50");

    assert.equal(res.status, 200);
    assert.equal(res.body.totals.multiAccountDetections, 1);

    const refA = res.body.referrers.find((referrer) => referrer.referrerUuid === REF_A);
    assert.ok(refA);
    assert.equal(refA.riskLevel, "critical");
    assert.ok(refA.warnings.some((warning) => warning.code === "same_browser_other_account"));

    // A self-referral carries the user's own prefix and must not be treated as multi-account.
    const refB = res.body.referrers.find((referrer) => referrer.referrerUuid === REF_B);
    assert.ok(refB);
    assert.notEqual(refB.riskLevel, "critical");
    assert.ok(!refB.warnings.some((warning) => warning.code === "same_browser_other_account"));
  });

  it("marks repeated fingerprint identities as critical", async () => {
    await seedEvents([
      event({ type: "ref_send_code", referrerUuid: REF_B, fingerprintHash: "fp-shared", referredEmailHash: "email-1" }),
      event({ type: "ref_verify_ok", referrerUuid: REF_B, fingerprintHash: "fp-shared", referredUuidPrefix: "user-1" }),
      event({ type: "ref_send_code", referrerUuid: REF_B, fingerprintHash: "fp-shared", referredEmailHash: "email-2" }),
      event({ type: "ref_verify_ok", referrerUuid: REF_B, fingerprintHash: "fp-shared", referredUuidPrefix: "user-2" }),
    ]);

    const res = await getSummary("?days=all&limit=50");

    assert.equal(res.status, 200);
    assert.equal(res.body.referrers[0].riskLevel, "critical");
    assert.ok(
      res.body.referrers[0].warnings.some(
        (warning) => warning.code === "shared_fingerprint_identities",
      ),
    );
  });

  it("marks many verifies without checkout as high", async () => {
    await seedEvents(
      Array.from({ length: 5 }, (_, index) =>
        event({
          type: "ref_verify_ok",
          referrerUuid: REF_C,
          ipHash: `ip-${index}`,
          fingerprintHash: `fp-${index}`,
          referredUuidPrefix: `user-${index}`,
        }),
      ),
    );

    const res = await getSummary("?days=all&limit=50");

    assert.equal(res.status, 200);
    assert.equal(res.body.referrers[0].riskLevel, "high");
    assert.ok(
      res.body.referrers[0].warnings.some((warning) => warning.code === "verifies_without_checkout"),
    );
  });

  it("keeps normal paid referral activity low risk", async () => {
    await seedEvents([
      event({ type: "ref_click", referrerUuid: REF_D, ipHash: "ip-1", fingerprintHash: "fp-1" }),
      event({ type: "ref_send_code", referrerUuid: REF_D, ipHash: "ip-1", fingerprintHash: "fp-1", referredEmailHash: "email-1" }),
      event({ type: "ref_verify_ok", referrerUuid: REF_D, ipHash: "ip-1", fingerprintHash: "fp-1", referredUuidPrefix: "user-1" }),
      event({ type: "ref_checkout_by_referred", referrerUuid: REF_D, ipHash: "ip-2", fingerprintHash: "fp-2", referredUuidPrefix: "user-1" }),
    ]);

    const res = await getSummary("?days=all&limit=50");

    assert.equal(res.status, 200);
    assert.equal(res.body.referrers[0].riskLevel, "low");
    assert.deepEqual(res.body.referrers[0].warnings, []);
  });

  it("validates period and caps limit without failing", async () => {
    const badPeriod = await getSummary("?days=soon");
    assert.equal(badPeriod.status, 400);

    await seedEvents([
      event({ type: "ref_click", referrerUuid: REF_A }),
      event({ type: "ref_click", referrerUuid: REF_B }),
    ]);

    const limited = await getSummary("?days=all&limit=1");
    assert.equal(limited.status, 200);
    assert.equal(limited.body.totals.events, 1);
  });

  it("returns referrer email from RMW by UUID", async () => {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `${process.env.RMW_API_URL}/v1/users/${REF_A}`);
      assert.equal(options.headers["X-Api-Key"], process.env.RMW_API_KEY);
      return new Response(
        JSON.stringify({ user: { uuid: REF_A, email: "referrer@example.com" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const res = await request(app)
      .get(`/api/admin/referrals/users/${REF_A}`)
      .set("X-Admin-Token", "admin-test-token");

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { uuid: REF_A, email: "referrer@example.com" });
  });

  it("returns referrer points history from RMW by UUID", async () => {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `${process.env.RMW_API_URL}/v1/users/${REF_A}/referral-points?page=2&limit=10`);
      assert.equal(options.headers["X-Api-Key"], process.env.RMW_API_KEY);
      return new Response(
        JSON.stringify({
          balance: 15,
          items: [{ id: 1, amount: 1, reason: "registration", created_at: "2026-01-01T00:00:00.000Z" }],
          page: 2,
          limit: 10,
          total: 11,
          total_pages: 2,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const res = await request(app)
      .get(`/api/admin/referrals/users/${REF_A}/points?page=2&limit=10`)
      .set("X-Admin-Token", "admin-test-token");

    assert.equal(res.status, 200);
    assert.equal(res.body.balance, 15);
    assert.equal(res.body.page, 2);
    assert.equal(res.body.items[0].reason, "registration");
  });
});

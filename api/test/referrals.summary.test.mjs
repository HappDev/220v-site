import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
const { saveSession } = await import("../auth/session.mjs");
const { base64url } = await import("../auth/crypto.mjs");
const { SESSION_COOKIE, CSRF_COOKIE } = await import("../config.mjs");
const { refEventsListKey, refExchangeRequestKey } = await import("../auth/keys.mjs");
const { recordReferralEvent } = await import("../referrals/events.mjs");
const originalFetch = globalThis.fetch;

const REF_A = "11111111-1111-1111-8111-111111111111";
const REF_B = "22222222-2222-2222-8222-222222222222";
const REF_C = "33333333-3333-3333-8333-333333333333";
const REF_D = "44444444-4444-4444-8444-444444444444";

async function createSessionAgent(userUuid = REF_A) {
  const sid = base64url(randomBytes(32));
  const csrf = base64url(randomBytes(32));
  await saveSession(sid, {
    userUuid,
    email: "referrer@example.com",
    csrf,
    expAt: Date.now() + 3600_000,
  });

  const agent = request.agent(app);
  agent.set("Cookie", [`${SESSION_COOKIE}=${sid}`, `${CSRF_COOKIE}=${csrf}`]);
  agent.set("X-CSRF-Token", csrf);
  return agent;
}

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

function fakeReferralReq(ip) {
  return {
    ip,
    path: "/api/test",
    socket: { remoteAddress: ip },
    get(name) {
      if (name === "User-Agent") return `test-agent-${ip}`;
      return "";
    },
    log: { warn() {} },
  };
}

function getSummary(query = "") {
  return request(app)
    .get(`/api/admin/referrals/summary${query}`)
    .set("X-Admin-Token", "admin-test-token");
}

function mockReferralPointsFetch({ balance = 100, items = [] } = {}) {
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/v1\/users\/.+\/referral-points\?page=1&limit=1$/);
    assert.equal(options.headers["X-Api-Key"], process.env.RMW_API_KEY);
    return new Response(
      JSON.stringify({
        balance,
        items,
        page: 1,
        limit: 1,
        total: items.length,
        total_pages: items.length > 0 ? 1 : 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
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

  it("does not flag a link open from another account without registration as critical", async () => {
    await seedEvents([
      event({ type: "ref_click", referrerUuid: REF_A, otherUserUuidPrefix: "99999999", selfReferral: false }),
      event({ type: "ref_self_referral", referrerUuid: REF_B, otherUserUuidPrefix: "22222222", selfReferral: true }),
    ]);

    const res = await getSummary("?days=all&limit=50");

    assert.equal(res.status, 200);
    assert.equal(res.body.totals.multiAccountDetections, 0);

    const refA = res.body.referrers.find((referrer) => referrer.referrerUuid === REF_A);
    assert.ok(refA);
    assert.notEqual(refA.riskLevel, "critical");
    assert.ok(!refA.warnings.some((warning) => warning.code === "same_browser_other_account"));

    // A self-referral carries the user's own prefix and must not be treated as multi-account.
    const refB = res.body.referrers.find((referrer) => referrer.referrerUuid === REF_B);
    assert.ok(refB);
    assert.notEqual(refB.riskLevel, "critical");
    assert.ok(!refB.warnings.some((warning) => warning.code === "same_browser_other_account"));
  });

  it("flags registration after opening a referral link from another account in the same browser as critical", async () => {
    await seedEvents([
      event({
        type: "ref_click",
        at: "2026-01-01T00:00:00.000Z",
        referrerUuid: REF_A,
        otherUserUuidPrefix: "99999999",
        fingerprintHash: "fp-same-pc",
        ipHash: "ip-same-pc",
        uaHash: "ua-same-pc",
        selfReferral: false,
      }),
      event({
        type: "ref_verify_ok",
        at: "2026-01-01T00:01:00.000Z",
        referrerUuid: REF_A,
        referredEmailHash: "email-new",
        referredUuidPrefix: "new-user",
        fingerprintHash: "fp-same-pc",
        ipHash: "ip-same-pc",
        uaHash: "ua-same-pc",
      }),
    ]);

    const res = await getSummary("?days=all&limit=50");

    assert.equal(res.status, 200);
    assert.equal(res.body.totals.multiAccountDetections, 1);

    const refA = res.body.referrers.find((referrer) => referrer.referrerUuid === REF_A);
    assert.ok(refA);
    assert.equal(refA.riskLevel, "critical");
    const warning = refA.warnings.find((item) => item.code === "same_browser_other_account");
    assert.ok(warning);
    assert.equal(warning.evidence.accounts, 1);
    assert.equal(warning.evidence.registrations, 1);
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

  it("explains repeated User-Agent activity without checkout", async () => {
    await seedEvents(
      Array.from({ length: 5 }, (_, index) =>
        event({
          type: "ref_click",
          referrerUuid: REF_A,
          ipHash: `ip-ua-${index}`,
          uaHash: "ua-repeat",
          fingerprintHash: `fp-ua-${index}`,
        }),
      ),
    );

    const res = await getSummary("?days=all&limit=50");
    assert.equal(res.status, 200);

    const warning = res.body.referrers[0].warnings.find(
      (item) => item.code === "repeated_user_agent_no_checkout",
    );

    assert.equal(res.body.referrers[0].riskLevel, "medium");
    assert.equal(res.body.referrers[0].riskScore, 30);
    assert.ok(warning);
    assert.equal(warning.label, "Много действий с одного браузера без оплат");
    assert.match(warning.description, /User-Agent hash/);
    assert.equal(warning.evidence.events, 5);
    assert.equal(warning.evidence.checkouts, 0);
  });

  it("explains repeated fingerprint activity without checkout", async () => {
    await seedEvents(
      Array.from({ length: 5 }, (_, index) =>
        event({
          type: "ref_click",
          referrerUuid: REF_A,
          ipHash: `ip-fp-${index}`,
          uaHash: `ua-fp-${index}`,
          fingerprintHash: "fp-repeat",
        }),
      ),
    );

    const res = await getSummary("?days=all&limit=50");
    assert.equal(res.status, 200);

    const warning = res.body.referrers[0].warnings.find(
      (item) => item.code === "repeated_fingerprint_no_checkout",
    );

    assert.equal(res.body.referrers[0].riskLevel, "medium");
    assert.equal(res.body.referrers[0].riskScore, 30);
    assert.ok(warning);
    assert.equal(warning.label, "Много действий с одного устройства без оплат");
    assert.match(warning.description, /fingerprint hash/);
    assert.equal(warning.evidence.events, 5);
    assert.equal(warning.evidence.checkouts, 0);
  });

  it("does not flag low click or code conversion as risk", async () => {
    await seedEvents([
      ...Array.from({ length: 20 }, (_, index) =>
        event({
          type: "ref_click",
          referrerUuid: REF_A,
          ipHash: `click-ip-${index}`,
          uaHash: `click-ua-${index}`,
          fingerprintHash: `click-fp-${index}`,
        }),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        event({
          type: "ref_send_code",
          referrerUuid: REF_B,
          ipHash: `code-ip-${index}`,
          uaHash: `code-ua-${index}`,
          fingerprintHash: `code-fp-${index}`,
          referredEmailHash: `email-${index}`,
        }),
      ),
    ]);

    const res = await getSummary("?days=all&limit=50");

    assert.equal(res.status, 200);
    const refA = res.body.referrers.find((referrer) => referrer.referrerUuid === REF_A);
    const refB = res.body.referrers.find((referrer) => referrer.referrerUuid === REF_B);
    assert.equal(refA.riskLevel, "low");
    assert.equal(refB.riskLevel, "low");
    assert.ok(!refA.warnings.some((warning) => warning.code === "low_code_rate"));
    assert.ok(!refB.warnings.some((warning) => warning.code === "low_verify_rate"));
  });

  it("flags repeated auth IP only from four events", async () => {
    await seedEvents(
      Array.from({ length: 3 }, (_, index) =>
        event({
          type: "ref_send_code",
          referrerUuid: REF_A,
          ipHash: "ip-auth-repeat",
          uaHash: `ua-auth-${index}`,
          fingerprintHash: `fp-auth-${index}`,
          referredEmailHash: `email-${index}`,
        }),
      ),
    );

    const belowThreshold = await getSummary("?days=all&limit=50");

    assert.equal(belowThreshold.status, 200);
    assert.equal(belowThreshold.body.referrers[0].riskLevel, "low");
    assert.ok(
      !belowThreshold.body.referrers[0].warnings.some((warning) => warning.code === "repeated_auth_ip"),
    );

    await seedEvents([
      event({
        type: "ref_send_code",
        referrerUuid: REF_A,
        ipHash: "ip-auth-repeat",
        uaHash: "ua-auth-4",
        fingerprintHash: "fp-auth-4",
        referredEmailHash: "email-4",
      }),
    ]);

    const atThreshold = await getSummary("?days=all&limit=50");

    assert.equal(atThreshold.status, 200);
    assert.equal(atThreshold.body.referrers[0].riskLevel, "high");
    assert.ok(
      atThreshold.body.referrers[0].warnings.some((warning) => warning.code === "repeated_auth_ip"),
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
    assert.equal(res.body.uuid, REF_A);
    assert.equal(res.body.email, "referrer@example.com");
    assert.equal(res.body.status.penalized, false);
    assert.equal(res.body.status.pointsBlocked, false);
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

  it("debits referrer points through RMW by UUID and marks referral status", async () => {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `${process.env.RMW_API_URL}/v1/users/${REF_A}/referral-points/debit`);
      assert.equal(options.method, "POST");
      assert.equal(options.headers["X-Api-Key"], process.env.RMW_API_KEY);
      assert.deepEqual(JSON.parse(options.body), { amount: 7, comment: "fraud adjustment", force: true });
      return new Response(
        JSON.stringify({
          balance: 8,
          transaction: {
            id: 2,
            amount: -7,
            reason: "manual_debit",
            meta: { comment: "fraud adjustment" },
            created_at: "2026-01-02T00:00:00Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const res = await request(app)
      .post(`/api/admin/referrals/users/${REF_A}/points/debit`)
      .set("X-Admin-Token", "admin-test-token")
      .send({ amount: 7, comment: "fraud adjustment", force: true, pointsBlocked: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.balance, 8);
    assert.equal(res.body.transaction.reason, "manual_debit");
    assert.equal(res.body.status.penalized, true);
    assert.equal(res.body.status.pointsBlocked, true);

    await seedEvents([event({ type: "ref_click", referrerUuid: REF_A })]);
    const summary = await getSummary("?days=all&limit=50");
    const refA = summary.body.referrers.find((referrer) => referrer.referrerUuid === REF_A);
    assert.equal(refA.status.penalized, true);
    assert.equal(refA.status.pointsBlocked, true);
  });

  it("blocks referral points without calling RMW when debit fields are empty", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("RMW should not be called");
    };

    const res = await request(app)
      .post(`/api/admin/referrals/users/${REF_A}/points/debit`)
      .set("X-Admin-Token", "admin-test-token")
      .send({ pointsBlocked: true });

    assert.equal(res.status, 200);
    assert.equal(fetchCalled, false);
    assert.equal(res.body.balance, undefined);
    assert.equal(res.body.transaction, undefined);
    assert.equal(res.body.status.penalized, false);
    assert.equal(res.body.status.pointsBlocked, true);

    await seedEvents([event({ type: "ref_click", referrerUuid: REF_A })]);
    const summary = await getSummary("?days=all&limit=50");
    const refA = summary.body.referrers.find((referrer) => referrer.referrerUuid === REF_A);
    assert.equal(refA.status.penalized, false);
    assert.equal(refA.status.pointsBlocked, true);
  });

  it("unblocks referral points without calling RMW when debit fields are empty", async () => {
    globalThis.fetch = async () => {
      throw new Error("RMW should not be called");
    };

    const blockRes = await request(app)
      .post(`/api/admin/referrals/users/${REF_A}/points/debit`)
      .set("X-Admin-Token", "admin-test-token")
      .send({ pointsBlocked: true });

    assert.equal(blockRes.status, 200);
    assert.equal(blockRes.body.status.pointsBlocked, true);

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("RMW should not be called");
    };

    const res = await request(app)
      .post(`/api/admin/referrals/users/${REF_A}/points/debit`)
      .set("X-Admin-Token", "admin-test-token")
      .send({});

    assert.equal(res.status, 200);
    assert.equal(fetchCalled, false);
    assert.equal(res.body.balance, undefined);
    assert.equal(res.body.transaction, undefined);
    assert.equal(res.body.status.penalized, false);
    assert.equal(res.body.status.pointsBlocked, false);
    assert.equal(res.body.status.pointsBlockedAt, null);
  });

  it("blocks current user's referral exchange status for high risk", async () => {
    const agent = await createSessionAgent(REF_A);
    for (let idx = 0; idx < 5; idx += 1) {
      await recordReferralEvent("ref_verify_ok", fakeReferralReq(`127.0.0.${idx + 1}`), {
        referrerUuid: REF_A,
        referredEmailHash: `email-${idx}`,
        referredUuidPrefix: `user-${idx}`,
      });
    }

    const res = await agent.get("/api/me/referrals/status");

    assert.equal(res.status, 200);
    assert.equal(res.body.riskLevel, "high");
    assert.equal(res.body.blocked, true);
  });

  it("creates referral exchange requests for days and prizes", async () => {
    mockReferralPointsFetch({ balance: 2000 });
    const agent = await createSessionAgent(REF_A);

    const daysRes = await agent
      .post("/api/me/referrals/exchange-requests")
      .send({ type: "days", days: 3, points: 30 });

    assert.equal(daysRes.status, 201);
    assert.equal(daysRes.body.request.type, "days");
    assert.equal(daysRes.body.request.points, 30);
    assert.equal(daysRes.body.request.payload.days, 3);

    const prizeRes = await agent
      .post("/api/me/referrals/exchange-requests")
      .send({
        type: "prize",
        prizeId: "phone-card-500",
        prizeTitle: "500 руб на баланс телефона или карту",
        details: "+79990000000",
        points: 500,
      });

    assert.equal(prizeRes.status, 201);
    assert.equal(prizeRes.body.request.type, "prize");
    assert.equal(prizeRes.body.request.payload.details, "+79990000000");

    const myRequests = await agent.get("/api/me/referrals/exchange-requests");
    assert.equal(myRequests.status, 200);
    assert.equal(myRequests.body.items.length, 2);
  });

  it("rejects exchange request creation when pending requests exceed current balance", async () => {
    mockReferralPointsFetch({ balance: 40 });
    const agent = await createSessionAgent(REF_A);

    const firstRes = await agent
      .post("/api/me/referrals/exchange-requests")
      .send({ type: "days", days: 3, points: 30 });
    assert.equal(firstRes.status, 201);

    const secondRes = await agent
      .post("/api/me/referrals/exchange-requests")
      .send({ type: "days", days: 2, points: 20 });
    assert.equal(secondRes.status, 400);
    assert.match(secondRes.body.error, /Недостаточно баллов/);
  });

  it("rejects prize exchange requests with tampered cost", async () => {
    mockReferralPointsFetch({ balance: 2000 });
    const agent = await createSessionAgent(REF_A);

    const res = await agent
      .post("/api/me/referrals/exchange-requests")
      .send({
        type: "prize",
        prizeId: "phone-card-1000",
        prizeTitle: "1000 руб на баланс телефона или карту",
        details: "+79990000000",
        points: 1,
      });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Некорректный приз/);
  });

  it("blocks exchange request creation for points-blocked users", async () => {
    globalThis.fetch = async () => {
      throw new Error("RMW should not be called");
    };
    await request(app)
      .post(`/api/admin/referrals/users/${REF_A}/points/debit`)
      .set("X-Admin-Token", "admin-test-token")
      .send({ pointsBlocked: true });

    const agent = await createSessionAgent(REF_A);
    const res = await agent
      .post("/api/me/referrals/exchange-requests")
      .send({ type: "days", days: 1, points: 10 });

    assert.equal(res.status, 403);
    assert.match(res.body.error, /Списание\/обмен баллов недоступны/);
  });

  it("shows pending exchange requests to admin", async () => {
    mockReferralPointsFetch({ balance: 100 });
    const agent = await createSessionAgent(REF_A);
    await agent
      .post("/api/me/referrals/exchange-requests")
      .send({ type: "days", days: 2, points: 20 });

    const res = await request(app)
      .get("/api/admin/referrals/exchange-requests?status=pending")
      .set("X-Admin-Token", "admin-test-token");

    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].referrerUuid, REF_A);
    assert.equal(res.body.items[0].status, "pending");
  });

  it("approves day exchange requests through RMW exchange-days and prevents repeated approval", async () => {
    mockReferralPointsFetch({ balance: 100 });
    const agent = await createSessionAgent(REF_A);
    const createRes = await agent
      .post("/api/me/referrals/exchange-requests")
      .send({ type: "days", days: 2, points: 20 });
    const requestId = createRes.body.request.id;

    let exchangeCalls = 0;
    globalThis.fetch = async (url, options) => {
      exchangeCalls += 1;
      assert.equal(url, `${process.env.RMW_API_URL}/v1/users/${REF_A}/referral-points/exchange-days`);
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), {
        points: 20,
        days: 2,
        force: false,
      });
      return new Response(
        JSON.stringify({
          balance: 80,
          transaction: { id: 55, amount: -20, reason: "referral_exchange_days", created_at: "2026-01-03T00:00:00Z" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const approveRes = await request(app)
      .post(`/api/admin/referrals/exchange-requests/${requestId}/approve`)
      .set("X-Admin-Token", "admin-test-token")
      .send({ comment: "added manually" });

    assert.equal(approveRes.status, 200);
    assert.equal(approveRes.body.request.status, "approved");
    assert.equal(approveRes.body.request.operatorComment, "added manually");
    assert.equal(approveRes.body.exchange.balance, 80);
    assert.equal(exchangeCalls, 1);

    const visibleRes = await agent.get("/api/me/referrals/exchange-requests");
    assert.equal(visibleRes.status, 200);
    assert.equal(visibleRes.body.items.length, 0);

    const repeatRes = await request(app)
      .post(`/api/admin/referrals/exchange-requests/${requestId}/approve`)
      .set("X-Admin-Token", "admin-test-token")
      .send({});

    assert.equal(repeatRes.status, 409);
    assert.equal(exchangeCalls, 1);

    const pendingRes = await request(app)
      .get("/api/admin/referrals/exchange-requests?status=pending")
      .set("X-Admin-Token", "admin-test-token");
    assert.equal(pendingRes.body.items.length, 0);
  });

  it("keeps day exchange request pending when RMW exchange-days fails", async () => {
    mockReferralPointsFetch({ balance: 100 });
    const agent = await createSessionAgent(REF_A);
    const createRes = await agent
      .post("/api/me/referrals/exchange-requests")
      .send({ type: "days", days: 2, points: 20 });
    const requestId = createRes.body.request.id;

    globalThis.fetch = async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), {
        points: 20,
        days: 2,
        force: false,
      });
      return new Response(JSON.stringify({ error: "not enough points" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    };

    const approveRes = await request(app)
      .post(`/api/admin/referrals/exchange-requests/${requestId}/approve`)
      .set("X-Admin-Token", "admin-test-token")
      .send({});

    assert.equal(approveRes.status, 400);

    const pendingRes = await request(app)
      .get("/api/admin/referrals/exchange-requests?status=pending")
      .set("X-Admin-Token", "admin-test-token");
    assert.equal(pendingRes.body.items.length, 1);
    assert.equal(pendingRes.body.items[0].id, requestId);
  });

  it("rejects exchange requests without calling RMW", async () => {
    mockReferralPointsFetch({ balance: 100 });
    const agent = await createSessionAgent(REF_A);
    const createRes = await agent
      .post("/api/me/referrals/exchange-requests")
      .send({ type: "days", days: 2, points: 20 });
    const requestId = createRes.body.request.id;

    globalThis.fetch = async () => {
      throw new Error("RMW should not be called");
    };

    const rejectRes = await request(app)
      .post(`/api/admin/referrals/exchange-requests/${requestId}/reject`)
      .set("X-Admin-Token", "admin-test-token")
      .send({});

    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.request.status, "rejected");
    assert.equal(rejectRes.body.request.operatorComment, "Отклонено оператором");

    const visibleRes = await agent.get("/api/me/referrals/exchange-requests");
    assert.equal(visibleRes.status, 200);
    assert.equal(visibleRes.body.items.length, 1);
    assert.equal(visibleRes.body.items[0].status, "rejected");
    assert.equal(visibleRes.body.items[0].operatorComment, "Отклонено оператором");

    const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await redis.hset(refExchangeRequestKey(requestId), { closedAt: expiredAt });
    const expiredVisibleRes = await agent.get("/api/me/referrals/exchange-requests");
    assert.equal(expiredVisibleRes.status, 200);
    assert.equal(expiredVisibleRes.body.items.length, 0);

    const repeatRes = await request(app)
      .post(`/api/admin/referrals/exchange-requests/${requestId}/reject`)
      .set("X-Admin-Token", "admin-test-token")
      .send({});
    assert.equal(repeatRes.status, 409);
  });
});

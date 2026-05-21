import { describe, it, before, beforeEach, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.COOKIE_SECURE = "false";
process.env.TALKME_API_TOKEN = "test-talkme-token";
process.env.RMW_API_URL = "https://rmw.test";
process.env.RMW_API_KEY = "test-key";

const { app } = await import("../index.mjs");
const { redis } = await import("../redis.mjs");
const { saveSession } = await import("../auth/session.mjs");
const { base64url } = await import("../auth/crypto.mjs");
const { SESSION_COOKIE, CSRF_COOKIE } = await import("../config.mjs");

const TEST_EMAIL = "chat-user@example.com";
const TEST_UUID = "b6810e6c-8a69-42b1-b298-8b07d8378987";

const originalFetch = globalThis.fetch;

function syntheticClientIdFromEmail(email) {
  const normalized = `220v:${String(email || "").trim().toLowerCase()}`;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

async function createSessionAgent() {
  const sid = base64url(randomBytes(32));
  const csrf = base64url(randomBytes(32));
  await saveSession(sid, {
    userUuid: TEST_UUID,
    email: TEST_EMAIL,
    csrf,
    expAt: Date.now() + 3600_000,
  });

  const agent = request.agent(app);
  agent.set("Cookie", [`${SESSION_COOKIE}=${sid}`, `${CSRF_COOKIE}=${csrf}`]);
  agent.set("X-CSRF-Token", csrf);

  return {
    agent,
    clientId: syntheticClientIdFromEmail(TEST_EMAIL),
  };
}

function installTalkMeFetchMock() {
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    const body = options.body ? JSON.parse(options.body) : {};

    if (path.includes("/chat/client/search")) {
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            clients: [{ clientId: syntheticClientIdFromEmail(body.email), searchId: 42 }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (path.includes("/chat/message/getClientMessageList")) {
      return new Response(
        JSON.stringify({ success: true, result: { items: [], count: 0 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (path.includes("/chat/operator/getList")) {
      return new Response(
        JSON.stringify({ success: true, result: { operators: [] } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ success: false, error: { descr: "unexpected path" } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("talkme security", () => {
  before(async () => {
    await redis.flushall();
  });

  beforeEach(async () => {
    await redis.flushall();
    installTalkMeFetchMock();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    await redis.quit();
  });

  it("POST /api/talkme/client-id without cookie returns 401", async () => {
    const res = await request(app).post("/api/talkme/client-id").send({});
    assert.equal(res.status, 401);
  });

  it("POST /api/talkme/client-id with cookie but without CSRF returns 403", async () => {
    const sid = base64url(randomBytes(32));
    const csrf = base64url(randomBytes(32));
    await saveSession(sid, {
      userUuid: TEST_UUID,
      email: TEST_EMAIL,
      csrf,
      expAt: Date.now() + 3600_000,
    });

    const res = await request(app)
      .post("/api/talkme/client-id")
      .set("Cookie", [`${SESSION_COOKIE}=${sid}`, `${CSRF_COOKIE}=${csrf}`])
      .send({});

    assert.equal(res.status, 403);
  });

  it("POST /api/talkme/client-id with valid session returns clientId", async () => {
    const { agent, clientId } = await createSessionAgent();
    const res = await agent.post("/api/talkme/client-id").send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.clientId, clientId);
  });

  it("POST /api/talkme/messages with foreign clientId returns 403", async () => {
    const { agent, clientId } = await createSessionAgent();
    const foreignClientId = clientId.replace(/^./, "f");

    const res = await agent.post("/api/talkme/messages").send({
      clientId: foreignClientId,
      limit: 10,
    });

    assert.equal(res.status, 403);
  });

  it("POST /api/support/chat-attachment rejects svg", async () => {
    const { agent } = await createSessionAgent();

    const res = await agent
      .post("/api/support/chat-attachment")
      .attach("file", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"), {
        filename: "evil.svg",
        contentType: "image/svg+xml",
      });

    assert.equal(res.status, 400);
  });
});

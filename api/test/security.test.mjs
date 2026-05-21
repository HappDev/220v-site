import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
const { hashCode, timingSafeEqualStr } = await import("../auth/crypto.mjs");
const { UUID_RE, OTP_MAX_TRIES } = await import("../config.mjs");
const { redis } = await import("../redis.mjs");

after(async () => {
  await redis.quit();
});

describe("security helpers", () => {
  it("hashCode is deterministic", () => {
    assert.equal(hashCode("123456"), hashCode("123456"));
    assert.notEqual(hashCode("123456"), hashCode("654321"));
  });

  it("timingSafeEqualStr rejects length mismatch", () => {
    assert.equal(timingSafeEqualStr("abc", "abcd"), false);
    assert.equal(timingSafeEqualStr("same", "same"), true);
  });

  it("UUID_RE accepts v4", () => {
    assert.match("b6810e6c-8a69-42b1-b298-8b07d8378987", UUID_RE);
    assert.doesNotMatch("not-a-uuid", UUID_RE);
  });

  it("OTP_MAX_TRIES is 5", () => {
    assert.equal(OTP_MAX_TRIES, 5);
  });
});

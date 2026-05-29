import { randomBytes, createHash } from "node:crypto";
import {
  REF_EVENT_LIMIT,
  REF_EVENT_TTL_SEC,
  IP_HASH_SECRET
} from "../config.mjs";
import { redis } from "../redis.mjs";
import { base64url } from "../auth/crypto.mjs";
import {
  refEventsListKey,
  refEventsReferrerIndexKey,
  refEventsIpIndexKey,
  refEventsUaIndexKey,
  refEventsFingerprintIndexKey,
  refStatsReferrerKey,
  refClickSeenKey
} from "../auth/keys.mjs";

const REF_CLICK_DEDUP_TTL_SEC = 60 * 60;

export function ipUaHash(value) {
  if (!value) return "";
  return createHash("sha256").update(String(value) + IP_HASH_SECRET, "utf8").digest("hex");
}

function parseJsonObject(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function recordReferralEvent(type, req, fields = {}) {
  try {
    const at = new Date().toISOString();
    const id = base64url(randomBytes(12));
    const ip = req.ip || req.socket?.remoteAddress || "";
    const ipHash = ip ? ipUaHash(ip) : "";
    const userAgent = req.get("User-Agent") || "";
    const uaHash = userAgent ? ipUaHash(userAgent) : "";
    const fingerprint = fields.fingerprint || "";
    const fingerprintHash = fingerprint ? ipUaHash(fingerprint) : "";
    
    const event = {
      id,
      type,
      at,
      referrerUuid: fields.referrerUuid || "",
      referredEmailHash: fields.referredEmailHash || undefined,
      referredUuidPrefix: fields.referredUuidPrefix || undefined,
      ipHash,
      uaHash,
      fingerprintHash,
      otherUserUuidPrefix: fields.otherUserUuidPrefix || undefined,
      selfReferral: Boolean(fields.selfReferral),
      path: req.path,
      refererUrl: req.get("Referer") || "",
      reason: fields.reason || undefined,
      tariffKey: fields.tariffKey || undefined,
    };

    const eventJson = JSON.stringify(event);
    const listKey = refEventsListKey();
    const multi = redis.multi();
    let shouldIncrementClick = true;
    if (type === "ref_click" && event.referrerUuid && ipHash) {
      const seenResult = await redis.set(
        refClickSeenKey(event.referrerUuid, ipHash),
        "1",
        "EX",
        REF_CLICK_DEDUP_TTL_SEC,
        "NX",
      );
      shouldIncrementClick = seenResult === "OK";
    }

    // 1. LPUSH into general list
    multi.lpush(listKey, eventJson);
    multi.ltrim(listKey, 0, REF_EVENT_LIMIT - 1);
    multi.expire(listKey, REF_EVENT_TTL_SEC);

    // 2. Index by referrer (Set)
    if (event.referrerUuid) {
      const refIdxKey = refEventsReferrerIndexKey(event.referrerUuid);
      multi.sadd(refIdxKey, id);
      multi.expire(refIdxKey, REF_EVENT_TTL_SEC);
      
      // Increment aggregate stats
      const statsKey = refStatsReferrerKey(event.referrerUuid);
      if (type === "ref_click" && shouldIncrementClick) multi.hincrby(statsKey, "clicks", 1);
      else if (type === "ref_send_code") multi.hincrby(statsKey, "codes", 1);
      else if (type === "ref_verify_ok") multi.hincrby(statsKey, "verifies", 1);
      else if (type === "ref_checkout_by_referred") multi.hincrby(statsKey, "checkouts", 1);
      else if (type === "ref_self_referral") multi.hincrby(statsKey, "selfReferrals", 1);
      multi.expire(statsKey, 30 * 24 * 60 * 60); // 30 days TTL for aggregates
    }

    // 3. Index by IP (Set)
    if (ipHash) {
      const ipIdxKey = refEventsIpIndexKey(ipHash);
      multi.sadd(ipIdxKey, id);
      multi.expire(ipIdxKey, REF_EVENT_TTL_SEC);
    }

    // 4. Index by User-Agent (Set)
    if (uaHash) {
      const uaIdxKey = refEventsUaIndexKey(uaHash);
      multi.sadd(uaIdxKey, id);
      multi.expire(uaIdxKey, REF_EVENT_TTL_SEC);
    }

    // 5. Index by Fingerprint (Set)
    if (fingerprintHash) {
      const fpIdxKey = refEventsFingerprintIndexKey(fingerprintHash);
      multi.sadd(fpIdxKey, id);
      multi.expire(fpIdxKey, REF_EVENT_TTL_SEC);
    }

    // Also store the event by ID for easy retrieval
    const eventIdKey = `${listKey}:by_id:${id}`;
    multi.set(eventIdKey, eventJson, "EX", REF_EVENT_TTL_SEC);

    await multi.exec();
  } catch (err) {
    req.log?.warn({ err }, "referral event tracking failed");
  }
}

export async function queryReferralEvents(filters = {}) {
  const listKey = refEventsListKey();
  
  let targetEventIds = null;

  if (filters.referrerUuid) {
    const ids = await redis.smembers(refEventsReferrerIndexKey(filters.referrerUuid));
    targetEventIds = targetEventIds ? targetEventIds.filter(id => ids.includes(id)) : ids;
  }
  if (filters.ip) {
    const ipHash = ipUaHash(filters.ip);
    const ids = await redis.smembers(refEventsIpIndexKey(ipHash));
    targetEventIds = targetEventIds ? targetEventIds.filter(id => ids.includes(id)) : ids;
  }
  if (filters.fingerprint) {
    const fpHash = ipUaHash(filters.fingerprint);
    const ids = await redis.smembers(refEventsFingerprintIndexKey(fpHash));
    targetEventIds = targetEventIds ? targetEventIds.filter(id => ids.includes(id)) : ids;
  }

  let events = [];
  if (targetEventIds === null) {
    const rawEvents = await redis.lrange(listKey, 0, filters.limit ? filters.limit - 1 : 500);
    events = rawEvents.map(parseJsonObject).filter(Boolean);
  } else {
    if (targetEventIds.length > 0) {
      const idsToFetch = targetEventIds.slice(0, filters.limit || 500);
      const keys = idsToFetch.map(id => `${listKey}:by_id:${id}`);
      const rawEvents = await redis.mget(keys);
      events = rawEvents.map(parseJsonObject).filter(Boolean);
      events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    }
  }

  if (filters.type) {
    events = events.filter(e => e.type === filters.type);
  }
  if (filters.since) {
    const sinceTime = new Date(filters.since).getTime();
    events = events.filter(e => new Date(e.at).getTime() >= sinceTime);
  }
  if (filters.until) {
    const untilTime = new Date(filters.until).getTime();
    events = events.filter(e => new Date(e.at).getTime() <= untilTime);
  }

  return events;
}

import { randomUUID } from "node:crypto";

import { redis } from "../redis.mjs";
import {
  refExchangeRequestKey,
  refExchangeRequestsPendingKey,
  refExchangeRequestsUserKey,
} from "../auth/keys.mjs";

const VALID_TYPES = new Set(["days", "prize"]);
const VALID_STATUSES = new Set(["pending", "approved", "rejected"]);
const LIST_STATUSES = new Set(["pending", "user_visible"]);
const USER_VISIBLE_CLOSED_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeRequest(raw = {}) {
  const points = Number(raw.points);
  return {
    id: raw.id || "",
    referrerUuid: raw.referrerUuid || "",
    email: raw.email || null,
    type: VALID_TYPES.has(raw.type) ? raw.type : "days",
    points: Number.isInteger(points) && points > 0 ? points : 0,
    status: VALID_STATUSES.has(raw.status) ? raw.status : "pending",
    payload: normalizeJson(raw.payload, {}),
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
    closedAt: raw.closedAt || null,
    operatorComment: raw.operatorComment || null,
    rmwTransactionId: raw.rmwTransactionId || null,
  };
}

async function getRequestsByIds(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const id of uniqueIds) {
    pipeline.hgetall(refExchangeRequestKey(id));
  }
  const results = await pipeline.exec();

  return results
    .map(([, raw]) => (raw && Object.keys(raw).length > 0 ? normalizeRequest(raw) : null))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function createReferralExchangeRequest({ referrerUuid, email, type, points, payload }) {
  if (!VALID_TYPES.has(type)) {
    const err = new Error("Invalid exchange request type");
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(points) || points <= 0) {
    const err = new Error("Invalid exchange request points");
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const request = {
    id,
    referrerUuid,
    email: email || "",
    type,
    points: String(points),
    status: "pending",
    payload: JSON.stringify(payload || {}),
    createdAt: now,
    updatedAt: now,
    closedAt: "",
    operatorComment: "",
    rmwTransactionId: "",
  };

  await redis
    .multi()
    .hset(refExchangeRequestKey(id), request)
    .zadd(refExchangeRequestsPendingKey(), Date.now(), id)
    .zadd(refExchangeRequestsUserKey(referrerUuid), Date.now(), id)
    .exec();

  return normalizeRequest(request);
}

export async function listReferralExchangeRequests({ status = "pending", referrerUuid = null } = {}) {
  if (!LIST_STATUSES.has(status) || (status === "user_visible" && !referrerUuid)) {
    const err = new Error("Unsupported exchange request status filter");
    err.status = 400;
    throw err;
  }

  const ids = referrerUuid
    ? await redis.zrevrange(refExchangeRequestsUserKey(referrerUuid), 0, 199)
    : await redis.zrevrange(refExchangeRequestsPendingKey(), 0, 499);
  const requests = await getRequestsByIds(ids);
  if (status === "pending") {
    return requests.filter((request) => request.status === "pending");
  }

  const closedCutoffMs = Date.now() - USER_VISIBLE_CLOSED_MS;
  return requests.filter((request) => {
    if (request.status === "pending") return true;
    const closedAtMs = new Date(request.closedAt || "").getTime();
    return Number.isFinite(closedAtMs) && closedAtMs >= closedCutoffMs;
  });
}

export async function getPendingReferralExchangePoints(referrerUuid) {
  const requests = await listReferralExchangeRequests({ status: "pending", referrerUuid });
  return requests.reduce((sum, request) => sum + request.points, 0);
}

export async function getReferralExchangeRequest(id) {
  const raw = await redis.hgetall(refExchangeRequestKey(id));
  if (!raw || Object.keys(raw).length === 0) return null;
  return normalizeRequest(raw);
}

export async function withReferralExchangeRequestLock(id, fn) {
  const lockKey = `${refExchangeRequestKey(id)}:lock`;
  const lockValue = randomUUID();
  const acquired = await redis.set(lockKey, lockValue, "EX", 30, "NX");
  if (acquired !== "OK") {
    const err = new Error("Exchange request is being processed");
    err.status = 409;
    throw err;
  }

  try {
    return await fn();
  } finally {
    const current = await redis.get(lockKey);
    if (current === lockValue) {
      await redis.del(lockKey);
    }
  }
}

export async function withReferralExchangeUserLock(referrerUuid, fn) {
  const lockKey = `${refExchangeRequestsUserKey(referrerUuid)}:lock`;
  const lockValue = randomUUID();
  const acquired = await redis.set(lockKey, lockValue, "EX", 30, "NX");
  if (acquired !== "OK") {
    const err = new Error("Exchange request is being created");
    err.status = 409;
    throw err;
  }

  try {
    return await fn();
  } finally {
    const current = await redis.get(lockKey);
    if (current === lockValue) {
      await redis.del(lockKey);
    }
  }
}

export async function closeReferralExchangeRequest(id, { status, operatorComment = "", rmwTransactionId = "" }) {
  if (status !== "approved" && status !== "rejected") {
    const err = new Error("Invalid exchange request close status");
    err.status = 400;
    throw err;
  }

  const key = refExchangeRequestKey(id);
  const now = new Date().toISOString();

  const existingRaw = await redis.hgetall(key);
  if (!existingRaw || Object.keys(existingRaw).length === 0) {
    return null;
  }

  const existing = normalizeRequest(existingRaw);
  if (existing.status !== "pending") {
    const err = new Error("Exchange request already closed");
    err.status = 409;
    throw err;
  }

  await redis
    .multi()
    .hset(key, {
      status,
      updatedAt: now,
      closedAt: now,
      operatorComment: operatorComment || "",
      rmwTransactionId: rmwTransactionId || "",
    })
    .zrem(refExchangeRequestsPendingKey(), id)
    .exec();

  return getReferralExchangeRequest(id);
}

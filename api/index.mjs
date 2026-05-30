import "./env.mjs";
import { randomBytes } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { z } from "zod";

import { isProd, UUID_RE, REF_UUID_RE, HWID_RE } from "./config.mjs";
import { logger } from "./logger.mjs";
import { redis } from "./redis.mjs";
import { clientError, serverError } from "./http/errors.mjs";
import { fetchWithTimeout } from "./http/fetchWithTimeout.mjs";
import { isTimeoutError, publicMessageFromErr, timeoutStatusCode } from "./http/userMessages.mjs";
import { checkoutSessionLimiter, refClickIpLimiter } from "./http/rateLimit.mjs";
import { recordReferralEvent, queryReferralEvents } from "./referrals/events.mjs";
import { buildReferralSummary } from "./referrals/summary.mjs";
import { SESSION_COOKIE } from "./config.mjs";
import { base64url } from "./auth/crypto.mjs";
import { createAuthRouter } from "./auth/routes.mjs";
import { requireSession, getSession, requireAdminToken } from "./auth/session.mjs";
import { getMailerConfigSummary, sendOtpEmail, verifyMailerConfig } from "./mailer.mjs";
import { registerTalkMeRoutes } from "./talkme-routes.mjs";

const app = express();
app.set("trust proxy", 1);
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === "/api/health" },
  }),
);
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());

function getBillingAllowedHosts() {
  const raw = process.env.BILLING_ALLOWED_HOSTS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

const BILLING_ALLOWED_HOSTS = getBillingAllowedHosts();

function isAllowedPaymentUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (BILLING_ALLOWED_HOSTS.size === 0) {
      return isProd ? false : true;
    }
    return BILLING_ALLOWED_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

const checkoutSchema = z.object({
  product_key: z.enum(["sub_1m", "sub_6m", "sub_12m", "traffic_20gb", "traffic_50gb"]),
  payment_method: z.union([z.number().int(), z.string()]),
});

// --- Business constants (unchanged) ---

const MAX_DEVICES_ENV = Number(process.env.MAX_DEVICES);
const MAX_DEVICES = Number.isFinite(MAX_DEVICES_ENV) && MAX_DEVICES_ENV > 0 ? MAX_DEVICES_ENV : 0;
const BYTES_IN_GB = 1024 * 1024 * 1024;

function getTrafficLimitSubtractBytes() {
  const raw =
    process.env.TRAFFIC_LIMIT_SUBTRACT_GB ??
    process.env.VITE_TRAFFIC_LIMIT_SUBTRACT_GB ??
    "0";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed * BYTES_IN_GB;
}

const TRAFFIC_LIMIT_SUBTRACT_BYTES = getTrafficLimitSubtractBytes();

function adjustTrafficLimitBytes(limitBytes) {
  const safeLimit = Number(limitBytes);
  if (!Number.isFinite(safeLimit) || safeLimit <= 0) return 0;
  return Math.max(0, safeLimit - TRAFFIC_LIMIT_SUBTRACT_BYTES);
}

const VALID_CHECKOUT_PRODUCTS = new Set([
  "sub_1m",
  "sub_6m",
  "sub_12m",
  "traffic_20gb",
  "traffic_50gb",
]);
const VALID_PAYMENT_METHOD_INTS = new Set([2, 11, 13]);

const PRODUCT_TO_TARIFF_KEY = {
  sub_1m: "basic_1m",
  sub_6m: "pro_6m",
  sub_12m: "premium_12m",
  traffic_20gb: "traffic_20gb",
  traffic_50gb: "traffic_50gb",
};

function normalizeCheckoutPaymentMethod(raw) {
  if (typeof raw === "number" && Number.isInteger(raw) && VALID_PAYMENT_METHOD_INTS.has(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    const legacy = { sbp: 2, card: 11, crypto: 13 };
    if (legacy[s] !== undefined) return legacy[s];
    const n = Number(s);
    if (Number.isInteger(n) && VALID_PAYMENT_METHOD_INTS.has(n)) return n;
  }
  return null;
}

function rmwBaseUrl() {
  return process.env.RMW_API_URL?.trim().replace(/\/$/, "") || "";
}

function rmwApiKey() {
  return process.env.RMW_API_KEY?.trim() || "";
}

function paymentTypeToLabel(type) {
  const t = typeof type === "string" ? type.trim().toLowerCase() : "";
  if (t === "sbp") return "СБП (QR-код)";
  if (t === "card" || t === "carg") return "Оплата картой";
  if (t === "crypto") return "Криптовалюта";
  return t ? t : "Оплата";
}

const RMW_META_CACHE_TTL_MS = 5 * 60 * 1000;
const PROFILE_ENRICH_TIMEOUT_MS = 3_500;
let rmwMetaCache = { fetchedAtMs: 0, payments: null, products: null };
const rmwUserEmailCache = new Map();

async function fetchRmwJsonList({ rmwUrl, rmwKey, path }) {
  const r = await fetchWithTimeout(`${rmwUrl}${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": rmwKey,
    },
  });

  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON from RMW ${path}`);
  }

  if (!r.ok) {
    throw new Error(`RMW ${path} failed (${r.status})`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`Unexpected response from RMW ${path}`);
  }

  return data;
}

function extractRmwUserEmail(payload) {
  if (!payload || typeof payload !== "object") return "";

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const email = extractRmwUserEmail(item);
      if (email) return email;
    }
    return "";
  }

  for (const key of ["email", "userEmail", "user_email"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  for (const key of ["user", "response", "data"]) {
    const email = extractRmwUserEmail(payload[key]);
    if (email) return email;
  }

  return "";
}

async function fetchRmwUserEmail(userUuid) {
  const uuid = assertValidUuid(userUuid);
  const cached = rmwUserEmailCache.get(uuid);
  const now = Date.now();
  if (cached && now - cached.fetchedAtMs < RMW_META_CACHE_TTL_MS) {
    return cached.email;
  }

  const rmwUrl = rmwBaseUrl();
  const rmwKey = rmwApiKey();
  if (!rmwUrl || !rmwKey) {
    const err = new Error("RMW not configured");
    err.status = 500;
    throw err;
  }

  const r = await fetchWithTimeout(
    `${rmwUrl}/v1/users/${encodeURIComponent(uuid)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": rmwKey,
      },
    },
    PROFILE_ENRICH_TIMEOUT_MS,
  );

  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const err = new Error("Invalid JSON from RMW");
    err.status = 502;
    throw err;
  }

  if (!r.ok) {
    const err = new Error("RMW user lookup failed");
    err.status = r.status >= 400 && r.status < 600 ? r.status : 502;
    throw err;
  }

  const email = extractRmwUserEmail(data);
  rmwUserEmailCache.set(uuid, { fetchedAtMs: now, email });
  return email;
}

async function fetchRmwReferralPoints(userUuid, { page, limit }) {
  const uuid = assertValidUuid(userUuid);
  const rmwUrl = rmwBaseUrl();
  const rmwKey = rmwApiKey();
  if (!rmwUrl || !rmwKey) {
    const err = new Error("RMW not configured");
    err.status = 500;
    throw err;
  }

  const qs = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  const r = await fetchWithTimeout(
    `${rmwUrl}/v1/users/${encodeURIComponent(uuid)}/referral-points?${qs}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": rmwKey,
      },
    },
  );

  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const err = new Error("Invalid JSON from RMW referral-points");
    err.status = 502;
    throw err;
  }

  if (!r.ok) {
    const err = new Error("RMW referral-points failed");
    err.status = r.status >= 400 && r.status < 600 ? r.status : 502;
    throw err;
  }

  return data;
}

async function getRmwBillingMeta({ allowCache = true } = {}) {
  const rmwUrl = rmwBaseUrl();
  const rmwKey = rmwApiKey();
  if (!rmwUrl || !rmwKey) {
    throw new Error("RMW_API_URL and RMW_API_KEY are required");
  }

  const now = Date.now();
  if (
    allowCache &&
    rmwMetaCache.payments &&
    rmwMetaCache.products &&
    now - rmwMetaCache.fetchedAtMs < RMW_META_CACHE_TTL_MS
  ) {
    return rmwMetaCache;
  }

  const [paymentsRaw, productsRaw] = await Promise.all([
    fetchRmwJsonList({ rmwUrl, rmwKey, path: "/v1/payments/list" }),
    fetchRmwJsonList({ rmwUrl, rmwKey, path: "/v1/products/list" }),
  ]);

  const payments = paymentsRaw
    .map((p) => ({
      id: typeof p?.id === "number" ? p.id : Number(p?.id),
      type: typeof p?.type === "string" ? p.type : "",
    }))
    .filter((p) => Number.isInteger(p.id) && p.id > 0 && p.type);

  const products = productsRaw
    .map((p) => ({
      name: typeof p?.name === "string" ? p.name : "",
      price: typeof p?.price === "number" ? p.price : Number(p?.price),
      duration: typeof p?.duration === "string" ? p.duration : "",
      traffic_limit_bytes:
        typeof p?.traffic_limit_bytes === "number"
          ? p.traffic_limit_bytes
          : Number(p?.traffic_limit_bytes ?? 0),
      type: typeof p?.type === "string" ? p.type : "",
    }))
    .filter((p) => p.name && Number.isFinite(p.price));

  rmwMetaCache = { fetchedAtMs: now, payments, products };
  return rmwMetaCache;
}

function getBillingRedirectUrls() {
  const success = process.env.BILLING_SUCCESS_URL?.trim();
  const cancel = process.env.BILLING_CANCEL_URL?.trim();
  if (success && cancel) return { successUrl: success, cancelUrl: cancel };
  const base = (process.env.PUBLIC_SITE_URL?.trim() || "https://220v.shop").replace(/\/$/, "");
  return {
    successUrl: `${base}/pay/success`,
    cancelUrl: `${base}/pay/fail`,
  };
}

function isValidHttpsUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function assertValidUuid(uuid) {
  if (!uuid || typeof uuid !== "string" || !UUID_RE.test(uuid.trim())) {
    throw new Error("Invalid user UUID");
  }
  return uuid.trim();
}

async function fetchRmwHwidDevices(rmwUrl, rmwKey, userUuid, timeoutMs) {
  const uuid = assertValidUuid(userUuid);
  if (!rmwUrl || !rmwKey) return null;
  try {
    const r = await fetchWithTimeout(
      `${rmwUrl}/v1/hwid/devices/${encodeURIComponent(uuid)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": rmwKey,
        },
      },
      timeoutMs,
    );
    if (!r.ok) return null;
    const data = await r.json();
    const deviceList = Array.isArray(data.devices) ? data.devices : [];
    const total = typeof data.total === "number" ? data.total : deviceList.length;
    return { devices: deviceList, total };
  } catch {
    return null;
  }
}

async function applyRmwDeviceCount(rmwUrl, rmwKey, userUuid, userResponse, timeoutMs) {
  const hw = await fetchRmwHwidDevices(rmwUrl, rmwKey, userUuid, timeoutMs);
  if (hw && userResponse?.user) {
    userResponse.user.currentDevices = hw.total;
  }
}

async function enrichSubscriptionUrlFromPanel(baseUrl, headers, existingUser, userResponse, timeoutMs) {
  const short = existingUser.shortUuid || existingUser.short_uuid;
  if (!short) return;
  try {
    const subRes = await fetchWithTimeout(
      `${baseUrl}/api/subscriptions/by-uuid/${short}`,
      {
        method: "GET",
        headers,
      },
      timeoutMs,
    );
    if (subRes.ok) {
      const subData = await subRes.json();
      const sub = subData.response || subData;
      const subscriptionUrl = extractSubscriptionUrl(sub);
      if (subscriptionUrl) userResponse.user.subscriptionUrl = subscriptionUrl;
    }
  } catch {
    // ignore
  }
}

function safeDateParse(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function extractSubscriptionUrl(payload) {
  if (!payload) return "";

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nestedUrl = extractSubscriptionUrl(item);
      if (nestedUrl) return nestedUrl;
    }
    return "";
  }

  if (typeof payload !== "object") return "";

  const directUrl = pickFirstString(
    payload.subscriptionUrl,
    payload.subscription_url,
    payload.subscriptionLink,
    payload.subscription_link,
    payload.link,
    payload.url,
    payload.uri,
  );

  if (directUrl) return directUrl;

  for (const value of Object.values(payload)) {
    const nestedUrl = extractSubscriptionUrl(value);
    if (nestedUrl) return nestedUrl;
  }

  return "";
}

/** Подпись тарифа в ЛК (поле tariff из RMW) */
function displayPlanFromTariff(tariff) {
  if (!tariff || typeof tariff !== "string") return null;
  const t = tariff.trim().toLowerCase();
  const map = {
    trial: "Тестовый",
    "1month": "1 Месяц",
    "6month": "6 Месяцев",
    "12month": "12 Месяцев",
  };
  return map[t] ?? null;
}

function buildUserResponse(user, exists) {
  const expireAt =
    safeDateParse(user.expireAt) ||
    safeDateParse(user.expire_at) ||
    safeDateParse(user.expiresAt) ||
    safeDateParse(user.expires_at);
  const createdAt = safeDateParse(user.createdAt) || safeDateParse(user.created_at) || new Date();
  const now = new Date();
  const daysLeft = expireAt
    ? Math.ceil((expireAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const usedDays = Math.ceil((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const rawTariff = typeof user.tariff === "string" ? user.tariff.trim() : "";
  const fromTariff = displayPlanFromTariff(rawTariff);
  const plan = fromTariff ?? (daysLeft <= 1 ? "Test" : "Premium");

  const apiDeviceLimit = Number(user.hwidDeviceLimit ?? 0);
  const devicesLimit = MAX_DEVICES > 0 ? MAX_DEVICES : apiDeviceLimit;

  return {
    exists,
    user: {
      plan,
      ...(rawTariff ? { tariff: rawTariff } : {}),
      status: user.status || "ACTIVE",
      devicesLimit,
      currentDevices: 0,
      usedDays,
      expireAt: expireAt ? expireAt.toISOString() : new Date().toISOString(),
      daysLeft,
      username: user.username,
      userUuid: user.uuid || user.userUuid,
      shortUuid: user.shortUuid || user.short_uuid,
      inviter_uuid: user.inviterUuid || user.inviter_uuid || null,
      subscriptionUrl: extractSubscriptionUrl(user),
      usedTrafficBytes:
        user.usedTrafficBytes ??
        user.used_traffic_bytes ??
        (typeof user.userTraffic === "object" ? user.userTraffic.usedTrafficBytes : undefined) ??
        0,
      trafficLimitBytes: adjustTrafficLimitBytes(
        user.trafficLimitBytes ?? user.traffic_limit_bytes ?? 0,
      ),
    },
  };
}

function isDashboardUserPayload(data) {
  if (!data || typeof data !== "object" || typeof data.exists !== "boolean") return false;
  const u = data.user;
  if (!u || typeof u !== "object") return false;
  const hasUuid = typeof u.userUuid === "string" && u.userUuid.length > 0;
  const hasPlan = typeof u.plan === "string" && u.plan.length > 0;
  const hasTariff = typeof u.tariff === "string" && u.tariff.length > 0;
  return hasUuid && (hasPlan || hasTariff);
}

function applyTariffLabelToDashboardUser(user) {
  if (!user || typeof user !== "object") return;
  const label = displayPlanFromTariff(user.tariff);
  if (label) user.plan = label;
}

function extractPanelUserFromRmwSession(data) {
  if (!data || typeof data !== "object") return null;

  let exists = typeof data.exists === "boolean" ? data.exists : true;
  let user = null;

  if (data.user && typeof data.user === "object") {
    if (data.user.uuid) {
      user = data.user;
    } else if (data.user.userUuid) {
      user = { ...data.user, uuid: data.user.userUuid };
    }
  }

  if (!user && data.response !== undefined) {
    const r = data.response;
    if (Array.isArray(r)) {
      user = r.find((u) => u?.status === "ACTIVE") || r[r.length - 1] || null;
      exists = Boolean(user);
    } else if (r && typeof r === "object" && r.uuid) {
      user = r;
    }
  }

  if (!user && data.uuid) {
    user = data;
    exists = true;
  }

  return user?.uuid || user?.userUuid ? { panelUser: user, exists } : null;
}

async function fetchRmwAnnouncementText() {
  const rmwUrl = rmwBaseUrl();
  const rmwKey = rmwApiKey();
  if (!rmwUrl || !rmwKey) return null;

  const r = await fetchWithTimeout(`${rmwUrl}/announcement`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": rmwKey,
    },
  });

  const raw = await r.text();
  if (!r.ok || !raw?.trim()) return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (data && typeof data === "object" && typeof data.text === "string") {
    const t = data.text.trim();
    return t || null;
  }
  return null;
}

async function loadUserProfileForEmail(normalizedEmail, req, refUuid) {
  const rmwUrl = rmwBaseUrl();
  const rmwKey = rmwApiKey();
  if (!rmwUrl || !rmwKey) {
    throw new Error("RMW not configured");
  }

  const baseUrl = process.env.REMNAWAVE_URL || "https://remna.2oo.uk";
  const token = process.env.REMNAWAVE_TOKEN;
  const panelHeaders = token
    ? {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }
    : null;

  const sessionBody = { email: normalizedEmail };
  if (refUuid && typeof refUuid === "string" && REF_UUID_RE.test(refUuid.trim())) {
    sessionBody.ref_uuid = refUuid.trim();
  }

  const sessionRes = await fetchWithTimeout(`${rmwUrl}/v1/auth/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": rmwKey,
    },
    body: JSON.stringify(sessionBody),
  });

  const sessionText = await sessionRes.text();
  let sessionData;
  try {
    sessionData = sessionText ? JSON.parse(sessionText) : {};
  } catch {
    const err = new Error("Invalid JSON from RMW");
    err.status = 502;
    throw err;
  }

  if (!sessionRes.ok) {
    const err = new Error("RMW auth/session failed");
    err.status =
      sessionRes.status >= 400 && sessionRes.status < 600 ? sessionRes.status : 502;
    throw err;
  }

  if (isDashboardUserPayload(sessionData)) {
    await applyRmwDeviceCount(
      rmwUrl,
      rmwKey,
      sessionData.user.userUuid,
      sessionData,
      PROFILE_ENRICH_TIMEOUT_MS,
    );
    applyTariffLabelToDashboardUser(sessionData.user);
    return sessionData;
  }

  const extracted = extractPanelUserFromRmwSession(sessionData);
  if (!extracted?.panelUser) {
    const err = new Error("RMW returned no user");
    err.status = 502;
    throw err;
  }

  const { panelUser, exists } = extracted;
  const userResponse = buildUserResponse(panelUser, exists);
  const uuid = userResponse.user.userUuid;
  const enrichTasks = [
    applyRmwDeviceCount(rmwUrl, rmwKey, uuid, userResponse, PROFILE_ENRICH_TIMEOUT_MS),
  ];
  if (token && panelHeaders) {
    enrichTasks.push(
      enrichSubscriptionUrlFromPanel(
        baseUrl,
        panelHeaders,
        panelUser,
        userResponse,
        PROFILE_ENRICH_TIMEOUT_MS,
      ),
    );
  }
  await Promise.all(enrichTasks);
  return userResponse;
}

function extractUserUuidFromProfile(profile) {
  const u = profile?.user;
  const uuid = u?.userUuid || u?.uuid;
  if (!uuid || !UUID_RE.test(String(uuid).trim())) return null;
  return String(uuid).trim();
}

app.use(
  createAuthRouter({
    mailer: { sendOtpEmail },
    loadUserProfile: loadUserProfileForEmail,
    extractUserUuid: extractUserUuidFromProfile,
  }),
);

// --- Routes ---

app.post("/api/ref/click", refClickIpLimiter, async (req, res) => {
  try {
    const { ref_uuid, fingerprint } = req.body || {};
    if (!ref_uuid || typeof ref_uuid !== "string" || !REF_UUID_RE.test(ref_uuid.trim())) {
      return clientError(res, 400, "Некорректный реферальный код");
    }

    const referrerUuid = ref_uuid.trim();
    let otherUserUuidPrefix;
    let selfReferral = false;

    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid) {
      const session = await getSession(sid);
      if (session && typeof session.userUuid === "string" && session.userUuid) {
        const currentUserUuid = session.userUuid.trim();
        otherUserUuidPrefix = currentUserUuid.slice(0, 8);
        selfReferral = currentUserUuid === referrerUuid;
      }
    }

    await recordReferralEvent("ref_click", req, {
      referrerUuid,
      fingerprint,
      otherUserUuidPrefix,
      selfReferral,
    });

    return res.sendStatus(204);
  } catch (err) {
    return serverError(res, req, err);
  }
});

app.get("/api/admin/referrals/events", requireAdminToken, async (req, res) => {
  try {
    const limit = Math.min(500, Number(req.query.limit) || 100);
    const filters = {
      referrerUuid: req.query.referrer_uuid || undefined,
      ip: req.query.ip || undefined,
      fingerprint: req.query.fingerprint || undefined,
      type: req.query.type || undefined,
      since: req.query.since || undefined,
      until: req.query.until || undefined,
      limit,
    };

    const events = await queryReferralEvents(filters);

    // Compute aggregations / stats for anti-fraud detection
    const ipCounts = {};
    const uaCounts = {};
    const fingerprintCounts = {};
    const referrerCounts = {};
    let multiAccountDetections = 0;
    let selfReferralDetections = 0;

    for (const event of events) {
      if (event.ipHash) {
        ipCounts[event.ipHash] = (ipCounts[event.ipHash] || 0) + 1;
      }
      if (event.uaHash) {
        uaCounts[event.uaHash] = (uaCounts[event.uaHash] || 0) + 1;
      }
      if (event.fingerprintHash) {
        fingerprintCounts[event.fingerprintHash] = (fingerprintCounts[event.fingerprintHash] || 0) + 1;
      }
      if (event.referrerUuid) {
        referrerCounts[event.referrerUuid] = (referrerCounts[event.referrerUuid] || 0) + 1;
      }
      if (event.otherUserUuidPrefix) {
        multiAccountDetections++;
      }
      if (event.selfReferral || event.type === "ref_self_referral") {
        selfReferralDetections++;
      }
    }

    const sortDesc = (obj) => Object.entries(obj)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const redactedEvents = events.map((event) => {
      const redacted = { ...event };
      delete redacted.ip;
      delete redacted.userAgent;
      delete redacted.fingerprint;
      return redacted;
    });

    return res.json({
      events: redactedEvents,
      stats: {
        total: events.length,
        multiAccountDetections,
        selfReferralDetections,
        topIps: sortDesc(ipCounts),
        topUserAgents: sortDesc(uaCounts),
        topFingerprints: sortDesc(fingerprintCounts),
        topReferrers: sortDesc(referrerCounts),
      }
    });
  } catch (err) {
    return serverError(res, req, err);
  }
});

app.get("/api/admin/referrals/summary", requireAdminToken, async (req, res) => {
  try {
    const rawDays = String(req.query.days || "30").trim().toLowerCase();
    const days = rawDays === "all" ? null : Number(rawDays);
    if (days !== null && (!Number.isInteger(days) || days <= 0)) {
      return clientError(res, 400, "Некорректный период");
    }

    const rawLimit = Number(req.query.limit);
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(20000, rawLimit) : 5000;

    const filters = { limit };
    if (days !== null) {
      filters.since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    }

    const events = await queryReferralEvents(filters);
    return res.json(buildReferralSummary(events, { days, recentEventLimit: Math.min(200, limit) }));
  } catch (err) {
    return serverError(res, req, err);
  }
});

app.get("/api/admin/referrals/users/:uuid", requireAdminToken, async (req, res) => {
  try {
    const uuid = assertValidUuid(req.params.uuid);
    const email = await fetchRmwUserEmail(uuid);
    return res.json({ uuid, email: email || null });
  } catch (err) {
    if (err?.message === "Invalid user UUID") {
      return clientError(res, 400, "Некорректный UUID пользователя");
    }
    const status = err.status || 502;
    return clientError(res, status, "Не удалось загрузить email пользователя из RMW");
  }
});

app.get("/api/admin/referrals/users/:uuid/points", requireAdminToken, async (req, res) => {
  try {
    const uuid = assertValidUuid(req.params.uuid);
    const pageRaw = Number(req.query.page);
    const limitRaw = Number(req.query.limit);
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(100, limitRaw) : 20;
    const data = await fetchRmwReferralPoints(uuid, { page, limit });
    return res.json(data);
  } catch (err) {
    if (err?.message === "Invalid user UUID") {
      return clientError(res, 400, "Некорректный UUID пользователя");
    }
    const status = err.status || 502;
    return clientError(res, status, "Не удалось загрузить историю рефералов из RMW");
  }
});

app.get("/api/health", async (req, res) => {
  const redisStatus = redis.status;
  if (redisStatus !== "ready") {
    req.log.warn({ redisStatus }, "healthcheck redis not ready");
    return res.status(503).json({ ok: false, redisStatus });
  }

  try {
    await redis.ping();
    return res.json({ ok: true, redisStatus });
  } catch (err) {
    req.log.warn({ err, redisStatus: redis.status }, "healthcheck redis ping failed");
    return res.status(503).json({ ok: false, redisStatus: redis.status });
  }
});

app.get("/api/announcement", async (_req, res) => {
  try {
    const envNotice = process.env.NOTICE?.trim();
    if (envNotice) {
      return res.json({ text: envNotice });
    }
    const text = await fetchRmwAnnouncementText();
    return res.json({ text: text ?? null });
  } catch {
    return res.json({ text: null });
  }
});

app.get("/api/me", requireSession, async (req, res) => {
  try {
    const profile = await loadUserProfileForEmail(req.session.email, req);
    return res.json({ ...profile, email: req.session.email });
  } catch (err) {
    const status = isTimeoutError(err) ? timeoutStatusCode(err) : err.status || 502;
    return clientError(
      res,
      status,
      publicMessageFromErr(err, "Не удалось загрузить профиль", { context: "профиль" }),
    );
  }
});

app.get("/api/me/referrals/points", requireSession, async (req, res) => {
  try {
    const userUuid = assertValidUuid(req.session.userUuid);

    const pageRaw = Number(req.query.page);
    const limitRaw = Number(req.query.limit);
    const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit =
      Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(100, limitRaw) : 20;

    const rmwUrl = rmwBaseUrl();
    const rmwKey = rmwApiKey();
    if (!rmwUrl || !rmwKey) {
      return clientError(res, 500, "Сервис рефералов временно недоступен");
    }

    const data = await fetchRmwReferralPoints(userUuid, { page, limit });
    return res.json(data);
  } catch (err) {
    const status = err.status || 502;
    if (err?.message === "Invalid user UUID") {
      return clientError(res, 400, "Некорректный UUID пользователя");
    }
    req.log.warn({ err, status }, "RMW referral-points failed");
    return clientError(res, status, "Не удалось загрузить историю рефералов");
  }
});

app.get("/api/me/devices", requireSession, async (req, res) => {
  try {
    const userUuid = req.session.userUuid;
    assertValidUuid(userUuid);

    const rmwUrl = rmwBaseUrl();
    const rmwKey = rmwApiKey();
    if (rmwUrl && rmwKey) {
      const hw = await fetchRmwHwidDevices(rmwUrl, rmwKey, userUuid);
      if (hw) {
        return res.json({ devices: hw.devices, total: hw.total });
      }
      return clientError(res, 502, "Не удалось загрузить устройства");
    }

    const baseUrl = process.env.REMNAWAVE_URL || "https://remna.2oo.uk";
    const token = process.env.REMNAWAVE_TOKEN;
    if (!token) {
      return clientError(res, 500, "Сервис устройств временно недоступен");
    }

    const r = await fetchWithTimeout(`${baseUrl}/api/hwid/devices/${encodeURIComponent(userUuid)}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const data = await r.json();
    const responseData = data.response || data;
    const deviceList = responseData.devices || (Array.isArray(responseData) ? responseData : []);
    return res.json({ devices: deviceList, total: responseData.total ?? deviceList.length });
  } catch (err) {
    return serverError(res, req, err);
  }
});

app.delete("/api/me/devices/:hwid", requireSession, async (req, res) => {
  try {
    const userUuid = req.session.userUuid;
    assertValidUuid(userUuid);

    const hwidValue = typeof req.params.hwid === "string" ? req.params.hwid.trim() : "";
    if (!HWID_RE.test(hwidValue)) {
      return clientError(res, 400, "Некорректный идентификатор устройства");
    }

    const rmwUrl = rmwBaseUrl();
    const rmwKey = rmwApiKey();
    if (rmwUrl && rmwKey) {
      const r = await fetchWithTimeout(`${rmwUrl}/v1/hwid/devices/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": rmwKey,
        },
        body: JSON.stringify({ userUuid, hwid: hwidValue }),
      });
      let data;
      try {
        data = await r.json();
      } catch {
        data = {};
      }
      return res.json({ success: r.ok, data: data.response ?? data });
    }

    const baseUrl = process.env.REMNAWAVE_URL || "https://remna.2oo.uk";
    const token = process.env.REMNAWAVE_TOKEN;
    if (!token) {
      return clientError(res, 500, "Сервис устройств временно недоступен");
    }

    const r = await fetchWithTimeout(`${baseUrl}/api/hwid/devices/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ uuid: hwidValue }),
    });
    const data = await r.json();
    return res.json({ success: r.ok, data: data.response || data });
  } catch (err) {
    return serverError(res, req, err);
  }
});

app.get("/api/billing/meta", async (req, res) => {
  try {
    const meta = await getRmwBillingMeta({ allowCache: true });
    const productKeys = Object.keys(PRODUCT_TO_TARIFF_KEY);
    const productsByName = new Map(meta.products.map((p) => [p.name, p]));

    const products = productKeys.map((product_key) => {
      const tariff_key = PRODUCT_TO_TARIFF_KEY[product_key];
      const rmwProduct = productsByName.get(tariff_key) || null;
      return {
        product_key,
        tariff_key,
        price: rmwProduct ? rmwProduct.price : null,
        duration: rmwProduct ? rmwProduct.duration : null,
        traffic_limit_bytes: rmwProduct ? rmwProduct.traffic_limit_bytes : null,
        type: rmwProduct ? rmwProduct.type : null,
      };
    });

    const payments = meta.payments.map((p) => ({
      id: p.id,
      type: p.type,
      label: paymentTypeToLabel(p.type),
    }));

    return res.json({
      fetchedAtMs: meta.fetchedAtMs,
      payments,
      products,
    });
  } catch (err) {
    req.log.error({ err }, "billing meta failed");
    return clientError(res, 502, "Сервис оплаты временно недоступен");
  }
});

app.post("/api/checkout", requireSession, checkoutSessionLimiter, async (req, res) => {
  try {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return clientError(res, 400, "Некорректный запрос на оплату");
    }

    const { product_key, payment_method } = parsed.data;
    if (!VALID_CHECKOUT_PRODUCTS.has(product_key)) {
      return clientError(res, 400, "Некорректный тариф");
    }

    const tariff_key = PRODUCT_TO_TARIFF_KEY[product_key];
    const pm = normalizeCheckoutPaymentMethod(payment_method);
    if (pm === null) {
      return clientError(res, 400, "Некорректный способ оплаты");
    }

    const ref = assertValidUuid(req.session.userUuid);

    const { successUrl: returnUrl, cancelUrl: failedUrl } = getBillingRedirectUrls();
    if (!isValidHttpsUrl(returnUrl) || !isValidHttpsUrl(failedUrl)) {
      return clientError(res, 500, "Оплата временно недоступна");
    }

    const rmwUrl = rmwBaseUrl();
    const rmwKey = rmwApiKey();
    if (!rmwUrl || !rmwKey) {
      return clientError(res, 500, "Оплата временно недоступна");
    }

    try {
      const meta = await getRmwBillingMeta({ allowCache: true });
      if (!meta.payments.some((p) => p.id === pm)) {
        return clientError(res, 400, "Этот способ оплаты не поддерживается");
      }
      if (!meta.products.some((p) => p.name === tariff_key)) {
        return clientError(res, 400, "Этот тариф не поддерживается");
      }
    } catch (err) {
      req.log.error({ err }, "billing meta validation failed");
      return clientError(res, 502, "Сервис оплаты временно недоступен");
    }

    const idempotencyKey = base64url(randomBytes(16));
    const payload = {
      user_ref: ref,
      tariff_key,
      payment_method: pm,
      return_url: returnUrl,
      failed_url: failedUrl,
    };

    const r = await fetchWithTimeout(`${rmwUrl}/v1/billing/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": rmwKey,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return clientError(res, 502, "Сервис оплаты временно недоступен");
    }

    if (!r.ok) {
      req.log.warn({ status: r.status }, "RMW checkout failed");
      return clientError(res, r.status >= 400 && r.status < 600 ? r.status : 502, "Не удалось создать платёж");
    }

    const paymentUrl =
      data && typeof data === "object" && typeof data.payment_url === "string"
        ? data.payment_url
        : "";

    if (paymentUrl && !isAllowedPaymentUrl(paymentUrl)) {
      req.log.error({ paymentUrlHost: new URL(paymentUrl).hostname }, "payment_url host not allowed");
      return clientError(res, 502, "Получена некорректная ссылка на оплату");
    }

    try {
      const profile = await loadUserProfileForEmail(req.session.email, req);
      const inviterUuid = profile?.user?.inviter_uuid || profile?.user?.inviterUuid;
      if (inviterUuid) {
        await recordReferralEvent("ref_checkout_by_referred", req, {
          referrerUuid: inviterUuid,
          referredUuidPrefix: req.session.userUuid.slice(0, 8),
          tariffKey: tariff_key,
        });
      }
    } catch (err) {
      req.log.warn({ err }, "Failed to resolve inviter during checkout log");
    }

    return res.json(data);
  } catch (err) {
    return serverError(res, req, err);
  }
});

registerTalkMeRoutes(app);

export { app };

const port = Number(process.env.PORT) || 3001;

async function logMailerStartupStatus() {
  const summary = getMailerConfigSummary();
  if (!summary.ok) {
    logger.error({ mailer: summary }, "mailer config invalid at startup");
    return;
  }
  logger.info({ mailer: summary }, "mailer config loaded");
  try {
    await verifyMailerConfig();
    logger.info({ mailer: summary }, "mailer smtp connection verified");
  } catch (err) {
    logger.error({ err, mailer: summary }, "mailer smtp verify failed at startup");
  }
}

if (process.env.NODE_ENV !== "test") {
  void logMailerStartupStatus();

  app.listen(port, "0.0.0.0", () => {
    logger.info({ port, redisStatus: redis.status }, "API listening");
  });
}

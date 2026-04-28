import dotenv from "dotenv";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve } from "node:path";
import express from "express";
import cors from "cors";
import { createHash, randomUUID } from "node:crypto";
import multer from "multer";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const p of [
  resolve(__dirname, "../.env"),
  resolve(process.cwd(), ".env"),
  resolve(__dirname, ".env"),
]) {
  dotenv.config({ path: p });
}

const SUPPORT_CHAT_UPLOADS_DIR = resolve(
  process.env.SUPPORT_CHAT_UPLOADS_DIR?.trim() || resolve(__dirname, "uploads", "support-chat"),
);
const SUPPORT_CHAT_MAX_FILE_SIZE_MB = Number(process.env.SUPPORT_CHAT_MAX_FILE_SIZE_MB || "50");
const SUPPORT_CHAT_MAX_FILE_SIZE =
  Number.isFinite(SUPPORT_CHAT_MAX_FILE_SIZE_MB) && SUPPORT_CHAT_MAX_FILE_SIZE_MB > 0
    ? SUPPORT_CHAT_MAX_FILE_SIZE_MB * 1024 * 1024
    : 50 * 1024 * 1024;
const CHAT_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const CHAT_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"]);
const CHAT_ZIP_EXTENSIONS = new Set([".zip"]);
const CHAT_ALLOWED_EXTENSIONS = new Set([
  ...CHAT_IMAGE_EXTENSIONS,
  ...CHAT_VIDEO_EXTENSIONS,
  ...CHAT_ZIP_EXTENSIONS,
]);
const CHAT_ALLOWED_MIME_PREFIXES = ["image/", "video/"];
const CHAT_ALLOWED_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
  "application/octet-stream",
]);
mkdirSync(SUPPORT_CHAT_UPLOADS_DIR, { recursive: true });

function getChatFileExtension(file) {
  return extname(file?.originalname || "").toLowerCase();
}

function sanitizeChatFileBaseName(name) {
  return (name || "file")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "file";
}

function getChatAttachmentKind({ ext, mimeType }) {
  if (CHAT_IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith("image/")) return "image";
  if (CHAT_VIDEO_EXTENSIONS.has(ext) || mimeType.startsWith("video/")) return "video";
  return "zip";
}

function isAllowedChatFile(file) {
  const ext = getChatFileExtension(file);
  if (!CHAT_ALLOWED_EXTENSIONS.has(ext)) return false;
  const mimeType = String(file?.mimetype || "").toLowerCase();
  if (!mimeType) return true;
  if (CHAT_ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return true;
  if (CHAT_ZIP_EXTENSIONS.has(ext) && CHAT_ALLOWED_MIME_TYPES.has(mimeType)) return true;
  return false;
}

function buildPublicUrl(req, path) {
  const protoHeader = String(req.headers["x-forwarded-proto"] || req.protocol || "http");
  const proto = protoHeader.split(",")[0].trim() || "http";
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "").trim();
  if (!host) return path;
  return `${proto}://${host}${path}`;
}

const supportChatUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SUPPORT_CHAT_UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = getChatFileExtension(file);
      const base = sanitizeChatFileBaseName(file.originalname.replace(/\.[^.]+$/, ""));
      cb(null, `${Date.now()}-${randomUUID()}-${base}${ext}`);
    },
  }),
  limits: { fileSize: SUPPORT_CHAT_MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedChatFile(file)) {
      cb(new Error("Поддерживаются только изображения, видео и ZIP-файлы."));
      return;
    }
    cb(null, true);
  },
});

function hydrateSendCodeTokenFromEnvFile() {
  if (process.env.SEND_CODE_API_TOKEN?.trim()) return;
  const paths = [resolve(__dirname, "../.env"), resolve(process.cwd(), ".env"), resolve(__dirname, ".env")];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    let raw = readFileSync(p, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      if (!t.startsWith("SEND_CODE_API_TOKEN=")) continue;
      let val = t.slice("SEND_CODE_API_TOKEN=".length).trim();
      const hashIdx = val.indexOf(" #");
      if (hashIdx !== -1) val = val.slice(0, hashIdx).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val) {
        process.env.SEND_CODE_API_TOKEN = val;
        return;
      }
    }
  }
}

hydrateSendCodeTokenFromEnvFile();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use("/api/support/chat-attachment", express.static(SUPPORT_CHAT_UPLOADS_DIR));

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

const VALID_CHECKOUT_PRODUCTS = new Set(["sub_1m", "sub_6m", "sub_12m", "traffic_20gb", "traffic_50gb"]);
const VALID_PAYMENT_METHOD_INTS = new Set([2, 11, 13]);

/** Внутренний product_key (фронт) → tariff_key для RMW */
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
let rmwMetaCache = {
  fetchedAtMs: 0,
  payments: null,
  products: null,
};

async function fetchRmwJsonList({ rmwUrl, rmwKey, path }) {
  const r = await fetch(`${rmwUrl}${path}`, {
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
    const msg =
      data && typeof data === "object" && typeof data.error === "string"
        ? data.error
        : text || `RMW ${path} failed (${r.status})`;
    throw new Error(msg);
  }

  if (!Array.isArray(data)) {
    throw new Error(`Unexpected response from RMW ${path} (expected array)`);
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
  const base = (process.env.PUBLIC_SITE_URL?.trim() || "https://www.220v.org").replace(/\/$/, "");
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

/** RMW: GET /v1/hwid/devices/{userUuid} */
async function fetchRmwHwidDevices(rmwUrl, rmwKey, userUuid) {
  if (!rmwUrl || !rmwKey || !userUuid) return null;
  try {
    const r = await fetch(
      `${rmwUrl}/v1/hwid/devices/${encodeURIComponent(String(userUuid).trim())}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": rmwKey,
        },
      },
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

async function applyRmwDeviceCount(rmwUrl, rmwKey, userUuid, userResponse) {
  const hw = await fetchRmwHwidDevices(rmwUrl, rmwKey, userUuid);
  if (hw && userResponse?.user) {
    userResponse.user.currentDevices = hw.total;
  }
}

async function enrichSubscriptionUrlFromPanel(baseUrl, headers, existingUser, userResponse) {
  const short = existingUser.shortUuid || existingUser.short_uuid;
  if (short) {
    try {
      const subRes = await fetch(`${baseUrl}/api/subscriptions/by-uuid/${short}`, {
        method: "GET",
        headers,
      });
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
}

function hashCode(code) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

async function forwardSendCodeRequest({ email, sender_name, sender_email }) {
  const url =
    process.env.SEND_CODE_API_URL?.trim() || "https://vpnm.ru/api/send-code.php";
  hydrateSendCodeTokenFromEnvFile();
  const token = process.env.SEND_CODE_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "SEND_CODE_API_TOKEN не задан. Укажите в корневом .env строку SEND_CODE_API_TOKEN=... (без пробелов вокруг =). " +
        "Docker: .env лежит рядом с docker-compose.yml, после правок выполните docker compose up -d --force-recreate api.",
    );
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email,
      sender_name,
      sender_email,
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    return { status: 502, body: { error: "Некорректный ответ сервиса отправки кода" } };
  }

  return { status: response.status, body: data };
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
  const daysLeft = expireAt ? Math.ceil((expireAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;
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
      userUuid: user.uuid,
      shortUuid: user.shortUuid || user.short_uuid,
      subscriptionUrl: extractSubscriptionUrl(user),
      usedTrafficBytes:
        user.usedTrafficBytes ??
        user.used_traffic_bytes ??
        (typeof user.userTraffic === "object" ? user.userTraffic.usedTrafficBytes : undefined) ??
        0,
      trafficLimitBytes: adjustTrafficLimitBytes(user.trafficLimitBytes ?? user.traffic_limit_bytes ?? 0),
    },
  };
}

/** RMW уже отдал финальный JSON для дашборда */
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

/**
 * Достаёт объект пользователя панели (с полем uuid) из ответа RMW /v1/auth/session
 * или обёртки в стиле Remnawave API { response: [...] }.
 */
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

  return user?.uuid ? { panelUser: user, exists } : null;
}

/** GET {RMW_API_URL}/announcement — ожидается JSON { text: string } */
async function fetchRmwAnnouncementText() {
  const rmwUrl = rmwBaseUrl();
  const rmwKey = rmwApiKey();
  if (!rmwUrl || !rmwKey) return null;

  const r = await fetch(`${rmwUrl}/announcement`, {
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

app.post("/api/send-code", async (req, res) => {
  try {
    const { email, sender_name, sender_email, action, hash, code } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail) {
      return res.status(400).json({ error: "Email is required" });
    }

    if (action === "verify") {
      if (!hash || !code) {
        return res.status(400).json({ error: "Hash and code are required", verified: false });
      }
      const expectedHash = hashCode(code);
      const verified = expectedHash === hash;
      return res.json({ verified, error: verified ? null : "Неверный код" });
    }

    const name = sender_name || process.env.SEND_CODE_SENDER_NAME?.trim() || "220v";
    const fromAddr =
      sender_email || process.env.SEND_CODE_SENDER_EMAIL?.trim() || "support@220v.shop";

    const { status, body } = await forwardSendCodeRequest({
      email: normalizedEmail,
      sender_name: name,
      sender_email: fromAddr,
    });
    return res.status(status).json(body);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/remnawave-proxy", async (req, res) => {
  try {
    const { action, email, userUuid, deviceUuid, hwid } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const baseUrl = process.env.REMNAWAVE_URL || "https://remna.2oo.uk";
    const token = process.env.REMNAWAVE_TOKEN;

    const panelHeaders = token
      ? {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        }
      : null;

    if (action === "get-devices") {
      if (!userUuid) {
        return res.status(400).json({ error: "userUuid is required" });
      }
      const rmwUrl = rmwBaseUrl();
      const rmwKey = rmwApiKey();
      if (rmwUrl && rmwKey) {
        const hw = await fetchRmwHwidDevices(rmwUrl, rmwKey, userUuid);
        if (hw) {
          return res.json({ devices: hw.devices, total: hw.total });
        }
        return res.status(502).json({ error: "Failed to load devices from RMW" });
      }
      if (!token) {
        return res.status(500).json({ error: "REMNAWAVE_TOKEN or RMW_API_URL+RMW_API_KEY is required for devices" });
      }
      const r = await fetch(`${baseUrl}/api/hwid/devices/${userUuid}`, { method: "GET", headers: panelHeaders });
      const data = await r.json();
      const responseData = data.response || data;
      const deviceList = responseData.devices || (Array.isArray(responseData) ? responseData : []);
      return res.json({ devices: deviceList, total: responseData.total ?? deviceList.length });
    }

    if (action === "delete-device") {
      const hwidValue = typeof hwid === "string" && hwid.trim() ? hwid.trim() : typeof deviceUuid === "string" ? deviceUuid.trim() : "";
      if (!userUuid || typeof userUuid !== "string" || !userUuid.trim()) {
        return res.status(400).json({ error: "userUuid is required" });
      }
      if (!hwidValue) {
        return res.status(400).json({ error: "hwid is required" });
      }

      const rmwUrl = rmwBaseUrl();
      const rmwKey = rmwApiKey();
      if (rmwUrl && rmwKey) {
        const r = await fetch(`${rmwUrl}/v1/hwid/devices/delete`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": rmwKey,
          },
          body: JSON.stringify({
            userUuid: userUuid.trim(),
            hwid: hwidValue,
          }),
        });
        let data;
        try {
          data = await r.json();
        } catch {
          data = {};
        }
        return res.json({
          success: r.ok,
          data: data.response ?? data,
        });
      }

      if (!token) {
        return res.status(500).json({ error: "RMW_API_URL+RMW_API_KEY or REMNAWAVE_TOKEN is required for delete-device" });
      }
      const r = await fetch(`${baseUrl}/api/hwid/devices/delete`, {
        method: "POST",
        headers: panelHeaders,
        body: JSON.stringify({ uuid: hwidValue }),
      });
      const data = await r.json();
      return res.json({ success: r.ok, data: data.response || data });
    }

    if (action === "check-or-create") {
      if (!normalizedEmail) {
        return res.status(400).json({ error: "email is required" });
      }

      const rmwUrl = rmwBaseUrl();
      const rmwKey = rmwApiKey();
      if (!rmwUrl || !rmwKey) {
        return res.status(500).json({ error: "RMW_API_URL and RMW_API_KEY are required" });
      }

      const sessionRes = await fetch(`${rmwUrl}/v1/auth/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": rmwKey,
        },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const sessionText = await sessionRes.text();
      let sessionData;
      try {
        sessionData = sessionText ? JSON.parse(sessionText) : {};
      } catch {
        return res.status(502).json({ error: "Invalid JSON from RMW auth/session" });
      }

      if (!sessionRes.ok) {
        const msg =
          typeof sessionData.error === "string"
            ? sessionData.error
            : typeof sessionData.message === "string"
              ? sessionData.message
              : sessionText || "RMW auth/session failed";
        const status =
          sessionRes.status >= 400 && sessionRes.status < 600 ? sessionRes.status : 502;
        return res.status(status).json({ error: msg, ...sessionData });
      }

      if (isDashboardUserPayload(sessionData)) {
        await applyRmwDeviceCount(rmwUrl, rmwKey, sessionData.user.userUuid, sessionData);
        applyTariffLabelToDashboardUser(sessionData.user);
        return res.json(sessionData);
      }

      const extracted = extractPanelUserFromRmwSession(sessionData);
      if (!extracted?.panelUser?.uuid) {
        return res.status(502).json({ error: "RMW auth/session returned no user" });
      }

      const { panelUser, exists } = extracted;
      const userResponse = buildUserResponse(panelUser, exists);
      await applyRmwDeviceCount(rmwUrl, rmwKey, panelUser.uuid, userResponse);
      if (token) {
        await enrichSubscriptionUrlFromPanel(baseUrl, panelHeaders, panelUser, userResponse);
      }
      return res.json(userResponse);
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("remnawave-proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/billing/meta", async (req, res) => {
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
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/billing/checkout", async (req, res) => {
  try {
    const { userUuid, user_ref, product_key, payment_method } = req.body;
    const ref =
      typeof userUuid === "string" && userUuid.trim()
        ? userUuid.trim()
        : typeof user_ref === "string" && user_ref.trim()
          ? user_ref.trim()
          : "";

    if (!ref) {
      return res.status(400).json({ error: "userUuid or user_ref is required" });
    }
    if (!product_key || !VALID_CHECKOUT_PRODUCTS.has(product_key)) {
      return res.status(400).json({ error: "Invalid or unknown product_key" });
    }
    const tariff_key = PRODUCT_TO_TARIFF_KEY[product_key];
    if (!tariff_key) {
      return res.status(400).json({ error: "Unknown tariff mapping for product_key" });
    }
    const pm = normalizeCheckoutPaymentMethod(payment_method);
    if (pm === null) {
      return res.status(400).json({
        error: "Invalid payment_method (use 2 СБП, 11 карта, 13 крипто, или sbp/card/crypto)",
      });
    }

    const { successUrl: returnUrl, cancelUrl: failedUrl } = getBillingRedirectUrls();
    if (!isValidHttpsUrl(returnUrl) || !isValidHttpsUrl(failedUrl)) {
      return res.status(500).json({
        error:
          "Billing redirect URLs must be absolute https. Set BILLING_SUCCESS_URL and BILLING_CANCEL_URL, or PUBLIC_SITE_URL.",
      });
    }

    const rmwUrl = rmwBaseUrl();
    const rmwKey = rmwApiKey();
    if (!rmwUrl || !rmwKey) {
      return res.status(500).json({ error: "RMW_API_URL and RMW_API_KEY are required" });
    }

    // Validate by live RMW lists (payments/products)
    try {
      const meta = await getRmwBillingMeta({ allowCache: true });
      const paymentOk = meta.payments.some((p) => p.id === pm);
      if (!paymentOk) {
        return res.status(400).json({ error: "Unsupported payment_method" });
      }
      const productOk = meta.products.some((p) => p.name === tariff_key);
      if (!productOk) {
        return res.status(400).json({ error: "Unsupported product_key (missing in RMW products list)" });
      }
    } catch (err) {
      return res.status(502).json({ error: `Failed to validate billing meta: ${err.message}` });
    }

    const idempotencyKey = randomUUID();
    const payload = {
      user_ref: ref,
      tariff_key,
      payment_method: pm,
      return_url: returnUrl,
      failed_url: failedUrl,
    };

    const r = await fetch(`${rmwUrl}/v1/billing/checkout`, {
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
      return res.status(502).json({ error: text || "Invalid JSON from RMW" });
    }

    if (!r.ok) {
      const msg =
        typeof data.error === "string"
          ? data.error
          : typeof data.message === "string"
            ? data.message
            : text || `RMW checkout failed (${r.status})`;
      const status = r.status >= 400 && r.status < 600 ? r.status : 502;
      return res.status(status).json({ error: msg, ...data });
    }

    return res.json(data);
  } catch (err) {
    console.error("billing/checkout error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ── Talk-Me REST API proxy (for /chat) ──

const TALKME_API_BASE = "https://lcab.talk-me.ru/json/v1.0";

/**
 * Детерминированный 32-hex clientId от email.
 *
 * Вычисляется на бэкенде, потому что `crypto.subtle` во фронте недоступен в
 * non-secure контекстах (HTTP-развёртывания), и прямой вызов валит отправку.
 *
 * Talk-Me REST `/chat/message/sendToOperator` принимает произвольный
 * 32-символьный `client.id` и создаёт по нему запись клиента на лету — это
 * единственный надёжный способ, когда widget-путь `setClientInfo` сломан
 * (адблок, сбой загрузки `support.js` и т.п.). Email, переданный в payload
 * рядом с id, сохраняется на стороне Talk-Me и становится искомым ключом для
 * последующих `client-search`.
 */
function syntheticClientIdFromEmail(email) {
  const normalized = `220v:${String(email || "").trim().toLowerCase()}`;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

function talkmeToken() {
  return process.env.TALKME_API_TOKEN?.trim() || process.env.VITE_SUPPORT_CHAT_API_KEY?.trim() || "";
}

async function talkmeRequest(path, body, { retries = 1 } = {}) {
  const token = talkmeToken();
  if (!token) throw new Error("TALKME_API_TOKEN is not configured");

  let lastNetworkErr = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let r;
    try {
      r = await fetch(`${TALKME_API_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Token": token,
        },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      // Talk-Me иногда «дропает» соединение (TLS reset / connection refused) —
      // 1 ретрай через короткую паузу обычно достаточно.
      lastNetworkErr = netErr;
      if (attempt < retries) {
        await new Promise((rs) => setTimeout(rs, 250));
        continue;
      }
      const err = new Error(
        `Talk-Me network error: ${netErr?.message || netErr}`,
      );
      err.statusCode = 502;
      throw err;
    }

    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      const err = new Error("Invalid JSON from Talk-Me API");
      err.statusCode = 502;
      throw err;
    }

    if (!r.ok || data.success === false) {
      const errMsg = data?.error?.descr || `Talk-Me error (${r.status})`;
      const err = new Error(errMsg);
      err.statusCode = r.status >= 400 && r.status < 600 ? r.status : 502;
      err.talkmeErrorDescr = data?.error?.descr || null;
      throw err;
    }

    return data.result;
  }

  // Сюда формально попасть нельзя (return/throw в каждой ветке), но на всякий случай.
  const err = new Error(
    `Talk-Me network error: ${lastNetworkErr?.message || "unknown"}`,
  );
  err.statusCode = 502;
  throw err;
}

/** Best-effort label from Talk-Me /chat/message/getDialogStatusList result shape. */
function deriveDialogStatusLabel(result) {
  if (result == null) return null;
  if (typeof result === "string") return result;
  if (typeof result !== "object") return null;
  const r = result;

  const list = r.dialogStatusList || r.statuses || r.items;
  const curId =
    r.currentDialogStatusId ?? r.dialogStatusId ?? r.statusId ?? r.currentStatusId;

  if (Array.isArray(list) && curId != null) {
    const found = list.find(
      (x) =>
        x &&
        (x.id === curId ||
          String(x.id) === String(curId) ||
          x.dialogStatusId === curId),
    );
    if (found) {
      if (typeof found.name === "string") return found.name;
      if (typeof found.title === "string") return found.title;
      if (typeof found.descr === "string") return found.descr;
    }
  }

  if (typeof r.dialogStatusName === "string") return r.dialogStatusName;
  if (typeof r.dialogStatus === "string") return r.dialogStatus;
  if (typeof r.statusName === "string") return r.statusName;
  if (typeof r.name === "string") return r.name;

  if (Array.isArray(list) && list.length > 0) {
    const first = list[0];
    if (first && typeof first === "object") {
      if (typeof first.name === "string") return first.name;
      if (typeof first.title === "string") return first.title;
    }
  }

  return null;
}

/** Сколько операторов онлайн из ответа `/chat/operator/getList` (разные формы `result`). */
function countOnlineOperatorsFromGetListResult(result) {
  if (result == null) return 0;

  const collect = [];
  if (Array.isArray(result)) {
    collect.push(...result);
  } else if (typeof result === "object") {
    const r = result;
    for (const key of ["operators", "items", "operatorList", "list", "data"]) {
      const list = r[key];
      if (Array.isArray(list) && list.length > 0) {
        collect.push(...list);
        break;
      }
    }
    if (collect.length === 0 && Array.isArray(r.groups)) {
      for (const g of r.groups) {
        const ops = g?.operators || g?.items;
        if (Array.isArray(ops)) collect.push(...ops);
      }
    }
  }

  if (collect.length === 0) return 0;

  const rowOnline = (op) => {
    if (!op || typeof op !== "object") return false;
    if (op.isOnline === true || op.online === true) return true;
    if (op.inNetwork === true || op.isInNetwork === true) return true;
    if (op.connected === true) return true;
    if (op.statusId === 1 || op.statusId === "1") return true;
    if (op.statusId === 0 || op.statusId === "0" || op.statusId === -1 || op.statusId === "-1") {
      return false;
    }
    if (op.isWorkingNow === true) return true;
    const st = op.status;
    if (typeof st === "string") {
      const s = st.trim().toLowerCase();
      if (s === "online" || s === "busy" || s === "available" || s === "в сети") {
        return true;
      }
    }
    if (st === 1) return true;
    return false;
  };

  const withFlags = collect.filter((op) => {
    if (!op || typeof op !== "object") return false;
    return (
      "isOnline" in op ||
      "online" in op ||
      "inNetwork" in op ||
      "isInNetwork" in op ||
      "connected" in op ||
      "statusId" in op ||
      "isWorkingNow" in op ||
      "status" in op
    );
  });

  if (withFlags.length > 0) {
    return withFlags.filter(rowOnline).length;
  }

  // Если в объектах нет явных полей статуса — часто API отдаёт только онлайн-операторов.
  return collect.length;
}

app.post("/api/talkme/client-search", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "email is required" });
    }

    const result = await talkmeRequest("/chat/client/search", {
      email: email.trim().toLowerCase(),
    });

    const clients = (result?.clients || []).map((c) => ({
      clientId: c.clientId || "",
      searchId: c.searchId ?? null,
      name: c.name || "",
      email: c.email || "",
    }));

    return res.json({ clients });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post("/api/talkme/client-id", (req, res) => {
  const { email } = req.body || {};
  const trimmedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!trimmedEmail) {
    return res.status(400).json({ error: "email is required" });
  }

  return res.json({ clientId: syntheticClientIdFromEmail(trimmedEmail) });
});

app.post("/api/talkme/messages", async (req, res) => {
  try {
    const { clientId, searchId, afterId, limit: rawLimit } = req.body;
    const hasSearchId = typeof searchId === "number" && Number.isFinite(searchId) && searchId > 0;
    const hasClientId = typeof clientId === "string" && clientId.trim().length > 0;
    if (!hasSearchId && !hasClientId) {
      return res.status(400).json({ error: "searchId or clientId is required" });
    }

    const body = {
      client: hasSearchId ? { searchId } : { id: clientId.trim() },
      orderDirection: "asc",
      limit: Math.min(Math.max(Number(rawLimit) || 100, 1), 500),
    };

    if (typeof afterId === "number" && afterId > 0) {
      body.firstMessageId = afterId;
    }

    const result = await talkmeRequest("/chat/message/getClientMessageList", body);
    const items = result?.items || [];

    const messages = items
      .filter((m) => m.isVisibleForClient !== false && m.messageType !== "comment")
      .map((m) => ({
        id: m.id,
        text: m.text || m.content?.text || "",
        sender: m.whoSend === "operator" ? "operator" : "client",
        operatorName: m.operatorName || null,
        dateTime: m.dateTimeUTC || m.dateTime || "",
        status: m.status || "",
      }));

    return res.json({ messages, count: result?.count || 0 });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post("/api/support/chat-attachment", (req, res) => {
  supportChatUpload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: `Размер файла превышает ${Math.floor(SUPPORT_CHAT_MAX_FILE_SIZE / (1024 * 1024))} МБ`,
        });
      }
      return res.status(400).json({ error: err.message || "Не удалось загрузить файл" });
    }
    if (err) {
      return res.status(400).json({ error: err.message || "Не удалось загрузить файл" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "Файл обязателен" });
    }

    const ext = getChatFileExtension(file);
    const mimeType = String(file.mimetype || "").toLowerCase();
    const kind = getChatAttachmentKind({ ext, mimeType });
    const path = `/api/support/chat-attachment/${encodeURIComponent(file.filename)}`;
    const url = buildPublicUrl(req, path);

    return res.json({
      url,
      path,
      fileName: file.originalname,
      mimeType,
      size: file.size,
      kind,
    });
  });
});

/**
 * Принимаем `custom` как `Record<string, string>` (например, `Traffic`, `Devices`,
 * `Tariff`, `Expiration_date`) и передаём его в Talk-Me как `client.customData`
 * (имя ключа в REST согласно официальному Swift SDK Talk-Me: см.
 * `ChatController.setInfoCustomDataValue` → `chat/client/setInfo`).
 * Не-строковые/пустые значения отбрасываем, имена ключей ограничиваем
 * безопасным набором символов.
 */
function sanitizeTalkmeCustom(value) {
  if (!value || typeof value !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(k)) continue;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    out[k] = trimmed.slice(0, 256);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Обновляет карточку клиента в Talk-Me через REST `chat/client/setInfo`.
 *
 * Это правильный эндпоинт для записи произвольных полей в карточку клиента
 * (в отличие от `chat/message/sendToOperator`, который игнорирует `client.custom`,
 * см. https://github.com/bekannax/OnlineChatSdk-Swift `ChatController.setInfoCustomDataValue`).
 *
 * Шлём поля и под ключом `customData` (как в Swift SDK), и под ключом `custom`
 * (как в JS-виджете Talk-Me) — чтобы максимизировать совместимость
 * между разными версиями серверного API.
 *
 * Best-effort: ошибки логируем, но не пробрасываем — чтобы не валить отправку
 * сообщения пользователя из-за вспомогательного апдейта профиля.
 */
async function setTalkmeClientInfo({ clientId, name, email, customData }) {
  if (!clientId || (!name && !email && (!customData || Object.keys(customData).length === 0))) {
    return;
  }

  const client = { id: clientId };
  if (name) client.name = name;
  if (email) client.email = email;
  if (customData && Object.keys(customData).length > 0) {
    client.customData = customData;
    client.custom = customData;
  }

  const payload = { client };
  console.info(
    "[talkme/setInfo] → chat/client/setInfo payload:",
    JSON.stringify(payload),
  );

  try {
    const result = await talkmeRequest("/chat/client/setInfo", payload);
    console.info(
      "[talkme/setInfo] ← chat/client/setInfo result:",
      JSON.stringify(result ?? null),
    );
  } catch (err) {
    console.error(
      "[talkme/setInfo] ✕ chat/client/setInfo failed:",
      err?.message || err,
    );
  }
}

app.post("/api/talkme/send", async (req, res) => {
  try {
    const { text, attachmentUrl, attachmentName, email, name, custom } = req.body;
    const rawClientId = req.body?.clientId;
    const trimmedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const trimmedName = typeof name === "string" ? name.trim() : "";
    const sanitizedCustom = sanitizeTalkmeCustom(custom);

    let clientId =
      typeof rawClientId === "string" && rawClientId.trim().length > 0
        ? rawClientId.trim()
        : "";

    // Fallback: если clientId не передан, но есть email — синтезируем
    // детерминированный 32-hex id от email. Talk-Me создаст клиента на лету,
    // и последующие `client-search` по email вернут этот же id.
    if (!clientId) {
      if (!trimmedEmail) {
        return res.status(400).json({ error: "clientId or email is required" });
      }
      clientId = syntheticClientIdFromEmail(trimmedEmail);
    }

    const trimmedText = typeof text === "string" ? text.trim() : "";
    const trimmedAttachmentUrl =
      typeof attachmentUrl === "string" ? attachmentUrl.trim() : "";
    const trimmedAttachmentName =
      typeof attachmentName === "string" ? attachmentName.trim() : "";

    if (!trimmedText && !trimmedAttachmentUrl) {
      return res.status(400).json({ error: "text or attachmentUrl is required" });
    }

    if (trimmedAttachmentUrl) {
      let parsed;
      try {
        parsed = new URL(trimmedAttachmentUrl);
      } catch {
        return res.status(400).json({ error: "attachmentUrl must be a valid URL" });
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ error: "attachmentUrl must use http or https" });
      }
    }

    const messageParts = [];
    if (trimmedText) messageParts.push(trimmedText);
    if (trimmedAttachmentUrl) {
      messageParts.push(`Файл: ${trimmedAttachmentName || "вложение"}`);
      messageParts.push(trimmedAttachmentUrl);
    }

    // Сначала обновляем карточку клиента отдельным запросом chat/client/setInfo —
    // это правильный REST-эндпоинт для записи custom-полей (sendToOperator
    // их не сохраняет, см. Swift SDK Talk-Me). Делаем это ДО отправки сообщения,
    // чтобы оператор сразу видел актуальные RMW-данные при появлении нового
    // сообщения. setInfo сам ловит ошибки и не валит запрос.
    await setTalkmeClientInfo({
      clientId,
      name: trimmedName,
      email: trimmedEmail,
      customData: sanitizedCustom,
    });

    // Talk-Me REST принимает произвольный 32-символьный clientId (в т.ч. синтетический
    // от email). При первом POST с таким id Talk-Me создаёт запись клиента
    // и сохраняет email/name из payload; при повторных — обновляет их.
    // ВАЖНО: custom-поля шлём ТОЛЬКО через `chat/client/setInfo` (см. вызов
    // setTalkmeClientInfo выше). В `sendToOperator` их добавлять нельзя —
    // у части бэкендов Talk-Me наблюдается дроп соединения при «лишних»
    // полях в этом эндпоинте (`fetch failed`).
    const client = { id: clientId };
    if (trimmedEmail) client.email = trimmedEmail;
    if (trimmedName) client.name = trimmedName;

    const sendPayload = {
      client,
      message: { text: messageParts.join("\n") },
    };

    // Диагностика: печатаем то, что уходит в Talk-Me, и то, что вернул Talk-Me.
    // Если в кабинете оператора поля не появились — проблема, скорее всего,
    // в системных именах доп. полей (их нужно завести в админке Talk-Me с такими
    // же ключами: Traffic, Expiration_date, Devices, Tariff).
    console.info(
      "[talkme/send] → sendToOperator payload:",
      JSON.stringify(sendPayload),
    );

    let result;
    try {
      result = await talkmeRequest("/chat/message/sendToOperator", sendPayload);
    } catch (talkmeErr) {
      console.error(
        "[talkme/send] ✕ sendToOperator failed:",
        talkmeErr?.message || talkmeErr,
      );
      throw talkmeErr;
    }

    console.info(
      "[talkme/send] ← sendToOperator result:",
      JSON.stringify(result),
    );

    return res.json({ messageId: result?.id ?? null, clientId });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post("/api/talkme/message-status", async (req, res) => {
  try {
    const { messageId, status, operatorLogin } = req.body || {};
    const mid = Number(messageId);
    if (!Number.isInteger(mid) || mid <= 0) {
      return res.status(400).json({ error: "messageId must be a positive integer" });
    }
    const allowedStatuses = new Set(["delivered", "readed"]);
    if (typeof status !== "string" || !allowedStatuses.has(status)) {
      return res.status(400).json({ error: "status must be 'delivered' or 'readed'" });
    }

    const body = { messageId: mid, status };
    // operatorLogin уместен только когда оператор читает сообщение клиента.
    // Для «клиент прочитал сообщение оператора» — не передаём (это поведение Talk-Me API).
    if (typeof operatorLogin === "string" && operatorLogin.trim()) {
      body.operatorLogin = operatorLogin.trim();
    }

    try {
      await talkmeRequest("/chat/message/setStatus", body);
    } catch (err) {
      // Talk-Me возвращает `success: false, error.descr: "Ничего не изменилось"`,
      // если статус уже был выставлен (или эскалирован выше). Это не ошибка —
      // считаем no-op и отвечаем 200, чтобы клиент не ретраил и не сыпал 502 в консоль.
      const descr = (err?.talkmeErrorDescr || err?.message || "").toLowerCase();
      if (descr.includes("ничего не изменилось")) {
        return res.json({ success: true, noop: true });
      }
      throw err;
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post("/api/talkme/dialog-status", async (req, res) => {
  try {
    const { clientId, searchId } = req.body;
    const hasSearchId =
      typeof searchId === "number" && Number.isFinite(searchId) && searchId > 0;
    const hasClientId = typeof clientId === "string" && clientId.trim().length > 0;
    if (!hasSearchId && !hasClientId) {
      return res.status(400).json({ error: "searchId or clientId is required" });
    }

    const body = {
      client: hasSearchId ? { searchId } : { id: clientId.trim() },
    };

    const result = await talkmeRequest("/chat/message/getDialogStatusList", body);
    const statusLabel = deriveDialogStatusLabel(result);

    return res.json({ statusLabel, raw: result });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * In-memory регистр «оператор печатает для клиента X».
 *
 * Поскольку Talk-Me REST не предоставляет ни `getTypingStatus`, ни webhook-события
 * на typing, а наш UI `Chat.tsx` не использует виджет Talk-Me — индикатор
 * «оператор печатает…» приходится моделировать на нашей стороне:
 *   - каждый вызов `POST /api/talkme/send-typing` обновляет запись
 *     `{clientId → expiresAt}` (помимо проксирования в Talk-Me),
 *   - фронт поллит `POST /api/talkme/operator-typing-status` и рисует
 *     анимированный «typing» pill при `expiresAt > now`.
 *
 * Это согласуется с семантикой: запись «печатает оператор X для клиента Y» живёт
 * ровно `ttl` секунд (default 30), точно как имитация в виджете Talk-Me.
 */
const operatorTypingState = new Map();

function setOperatorTyping(clientId, ttlSeconds, operatorLogin) {
  if (!clientId) return;
  const expiresAt = Date.now() + Math.max(1, ttlSeconds) * 1000;
  operatorTypingState.set(clientId, {
    expiresAt,
    operatorLogin: operatorLogin || null,
  });
}

function getOperatorTyping(clientId) {
  if (!clientId) return null;
  const entry = operatorTypingState.get(clientId);
  if (!entry) return null;
  const now = Date.now();
  if (entry.expiresAt <= now) {
    operatorTypingState.delete(clientId);
    return null;
  }
  return {
    operatorLogin: entry.operatorLogin,
    secondsLeft: Math.max(0, Math.ceil((entry.expiresAt - now) / 1000)),
  };
}

/**
 * Прокси к Talk-Me `POST /chat/message/sendTypingToClient` — имитация набора
 * сообщения оператором (направление: оператор → клиент).
 *
 * Документация: https://lcab.talk-me.ru/cabinet/json-doc/online#tag/Chatmessage/paths/~1chat~1message~1sendTypingToClient/post
 *
 * Тело запроса:
 *   - `clientId` (string) или `searchId` (int) — идентификация клиента (хотя бы одно).
 *   - `operatorLogin` (string, обяз.) — логин оператора, от чьего имени идёт «набор».
 *   - `virtual` (bool, default true) — если true, Talk-Me не проверяет существование логина.
 *   - `ttl` (int, default 30) — длительность имитации в секундах.
 *
 * Помимо проксирования в Talk-Me, обновляет внутренний регистр
 * `operatorTypingState` — его читает наш `Chat.tsx`, чтобы показать
 * пользователю анимированный индикатор «Оператор печатает…».
 */
app.post("/api/talkme/send-typing", async (req, res) => {
  try {
    const { clientId, searchId, operatorLogin, virtual, ttl } = req.body || {};

    const hasSearchId =
      typeof searchId === "number" && Number.isFinite(searchId) && searchId > 0;
    const hasClientId = typeof clientId === "string" && clientId.trim().length > 0;
    if (!hasSearchId && !hasClientId) {
      return res.status(400).json({ error: "searchId or clientId is required" });
    }

    const login = typeof operatorLogin === "string" ? operatorLogin.trim() : "";
    if (!login) {
      return res.status(400).json({ error: "operatorLogin is required" });
    }

    const trimmedClientId = hasClientId ? clientId.trim() : null;
    const client = hasSearchId ? { searchId } : { clientId: trimmedClientId };
    const operator = { login, virtual: virtual === false ? false : true };

    const body = { client, operator };

    let ttlSeconds = 30;
    if (ttl !== undefined && ttl !== null) {
      const ttlNum = Number(ttl);
      if (!Number.isInteger(ttlNum) || ttlNum <= 0 || ttlNum > 300) {
        return res
          .status(400)
          .json({ error: "ttl must be an integer between 1 and 300 seconds" });
      }
      body.ttl = ttlNum;
      ttlSeconds = ttlNum;
    }

    let noop = false;
    try {
      await talkmeRequest("/chat/message/sendTypingToClient", body);
    } catch (err) {
      // Talk-Me часто отвечает «Ничего не изменилось», если такая же
      // имитация уже активна — это не ошибка, а no-op (типинг продолжается).
      const descr = (err?.talkmeErrorDescr || err?.message || "").toLowerCase();
      if (descr.includes("ничего не изменилось")) {
        noop = true;
      } else {
        throw err;
      }
    }

    // Регистрируем typing-состояние и для случая успеха, и для no-op:
    // в обоих случаях оператор «печатает» для клиента ещё ttl секунд.
    if (trimmedClientId) {
      setOperatorTyping(trimmedClientId, ttlSeconds, login);
    }

    return res.json({ success: true, ...(noop ? { noop: true } : {}) });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * Возвращает локальное состояние «оператор печатает для клиента X», которое
 * обновляется при вызовах `POST /api/talkme/send-typing`. Используется
 * `Chat.tsx` для отрисовки typing-индикатора в кастомном UI чата.
 *
 * Тело запроса: `{ clientId: string }`.
 * Ответ: `{ typing: bool, operatorLogin: string | null, secondsLeft: number }`.
 */
app.post("/api/talkme/operator-typing-status", (req, res) => {
  const { clientId } = req.body || {};
  if (typeof clientId !== "string" || !clientId.trim()) {
    return res.status(400).json({ error: "clientId is required" });
  }
  const state = getOperatorTyping(clientId.trim());
  if (!state) {
    return res.json({ typing: false, operatorLogin: null, secondsLeft: 0 });
  }
  return res.json({
    typing: true,
    operatorLogin: state.operatorLogin,
    secondsLeft: state.secondsLeft,
  });
});

/** Прокси к Talk-Me `POST /chat/operator/getList` — список операторов и признак онлайн. */
app.post("/api/talkme/operator-list", async (req, res) => {
  try {
    const body =
      req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? req.body
        : {};
    const result = await talkmeRequest("/chat/operator/getList", body);
    const onlineCount = countOnlineOperatorsFromGetListResult(result);
    return res.json({ onlineCount });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, "0.0.0.0", () => {
  console.log(`API listening on ${port}`);
});

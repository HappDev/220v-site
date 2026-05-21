import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve } from "node:path";
import express from "express";
import multer from "multer";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

export function registerTalkMeRoutes(app) {
  app.use("/api/support/chat-attachment", express.static(SUPPORT_CHAT_UPLOADS_DIR));

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
}

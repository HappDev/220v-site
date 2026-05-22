import { Router } from "express";
import { randomBytes } from "node:crypto";
import { ALLOWED_EMAIL_DOMAINS, SESSION_TTL_SEC } from "../config.mjs";
import { clientError, serverError } from "../http/errors.mjs";
import { isTimeoutError, publicMessageFromErr, timeoutStatusCode } from "../http/userMessages.mjs";
import { redis } from "../redis.mjs";
import {
  sendCodeIpHourLimiter,
  sendCodeIpMinuteLimiter,
  sendCodeEmailLimiter,
  verifyIpLimiter,
} from "../http/rateLimit.mjs";
import {
  base64url,
  emailHash,
  generateOtpCode,
  hashCode,
  maskEmail,
} from "./crypto.mjs";
import {
  buildRedisAuthSnapshot,
  findLatestSuccessfulSendCodeEvent,
  recordAuthEvent,
} from "./events.mjs";
import {
  acquireOtpCooldown,
  clearOtpAndCooldown,
  consumeOtp,
  getCooldownDebugSnapshot,
  getOtpDebugSnapshot,
  putOtp,
} from "./otp.mjs";
import { sendCodeSchema, verifySchema } from "./schemas.mjs";
import {
  clearSessionCookies,
  deleteSession,
  requireAdminToken,
  requireSession,
  saveSession,
  setSessionCookies,
} from "./session.mjs";

/**
 * @param {{ mailer: { sendOtpEmail: (opts: { email: string, code: string }) => Promise<{ ok: boolean, error?: string, detail?: string, messageId?: string }> }, loadUserProfile: (email: string, req: import('express').Request) => Promise<object>, extractUserUuid: (profile: object) => string | null }} deps
 */
export function createAuthRouter({ mailer, loadUserProfile, extractUserUuid }) {
  const router = Router();

  router.get("/api/admin/redis-auth", requireAdminToken, async (req, res) => {
    try {
      const snapshot = await buildRedisAuthSnapshot();
      return res.json(snapshot);
    } catch (err) {
      return serverError(res, req, err, "Не удалось загрузить данные Redis");
    }
  });

  router.post(
    "/api/auth/send-code",
    sendCodeIpMinuteLimiter,
    sendCodeIpHourLimiter,
    sendCodeEmailLimiter,
    async (req, res) => {
      try {
        const parsed = sendCodeSchema.safeParse(req.body);
        if (!parsed.success) {
          await recordAuthEvent("send_code_invalid_request", req, { status: "rejected" });
          return clientError(res, 400, "Некорректный email");
        }
        const email = parsed.data.email;
        const atIdx = email.indexOf("@");
        const localPart = email.slice(0, atIdx);
        const domain = email.slice(atIdx + 1);

        if (localPart.includes("+")) {
          return clientError(
            res,
            400,
            "Email не должен содержать плюс в имени",
          );
        }

        if (!ALLOWED_EMAIL_DOMAINS.has(domain)) {
          return clientError(
            res,
            400,
            "Этот домен не поддерживается, используйте популярные почтовые сервисы - gmail.com, yandex.ru, mail.ru и тд.",
          );
        }

        const owner = base64url(randomBytes(16));
        const cooldownResult = await acquireOtpCooldown(email, owner, 60);
        if (cooldownResult !== "OK") {
          await recordAuthEvent("send_code_cooldown", req, { email, status: "rejected" });
          return clientError(res, 429, "Подождите перед повторной отправкой кода");
        }

        const code = generateOtpCode();
        const hash = hashCode(code);
        await putOtp(email, hash, owner);
        const [otpDebug, cooldownDebug] = await Promise.all([
          getOtpDebugSnapshot(email),
          getCooldownDebugSnapshot(email),
        ]);
        req.log.info(
          {
            emailHash: emailHash(email),
            redisStatus: redis.status,
            otpTtlSec: otpDebug.ttlSec,
            cooldownTtlSec: cooldownDebug.ttlSec,
          },
          "otp stored",
        );

        const mailResult = await mailer.sendOtpEmail({ email, code });

        if (!mailResult.ok) {
          await clearOtpAndCooldown(email, owner);
          await recordAuthEvent("send_code_mail_failed", req, { email, status: "failed" });
          req.log.warn(
            {
              emailHash: emailHash(email),
              maskedEmail: maskEmail(email),
              recipientDomain: domain,
              mailerError: mailResult.error,
              mailerDetail: mailResult.detail,
            },
            "send-code mailer failed",
          );
          return res.status(502).json({ error: "Не удалось отправить код" });
        }

        req.log.info(
          { emailHash: emailHash(email), messageId: mailResult.messageId },
          "send-code dispatched",
        );
        await recordAuthEvent("send_code_sent", req, { email, status: "ok" });
        return res.json({ ok: true });
      } catch (err) {
        return serverError(res, req, err);
      }
    },
  );

  router.post("/api/auth/verify", verifyIpLimiter, async (req, res) => {
    try {
      const parsed = verifySchema.safeParse(req.body);
      if (!parsed.success) {
        await recordAuthEvent("verify_invalid_request", req, { status: "rejected" });
        return clientError(res, 400, "Некорректный запрос");
      }
      const { email, code } = parsed.data;

      const otpResult = await consumeOtp(email, code);
      if (!otpResult.ok) {
        const eventMap = {
          missing: "verify_code_missing",
          corrupt: "verify_code_corrupt",
          too_many_tries: "verify_too_many_tries",
          bad_code: "verify_bad_code",
        };
        await recordAuthEvent(eventMap[otpResult.reason] || "verify_bad_code", req, {
          email,
          status: "failed",
        });
        if (otpResult.reason === "missing" || otpResult.reason === "corrupt") {
          const [otpDebug, cooldownDebug, latestSuccessfulSendCode] = await Promise.all([
            getOtpDebugSnapshot(email),
            getCooldownDebugSnapshot(email),
            findLatestSuccessfulSendCodeEvent(email),
          ]);
          req.log.warn(
            {
              emailHash: emailHash(email),
              reason: otpResult.reason,
              redisStatus: redis.status,
              otp: otpDebug,
              cooldown: cooldownDebug,
              latestSuccessfulSendCode,
            },
            "otp verify unavailable",
          );
        }
        if (otpResult.reason === "bad_code" && otpResult.tries) {
          req.log.warn({ emailHash: emailHash(email), tries: otpResult.tries }, "otp verify failed");
        }
        const messages = {
          missing: "Код истёк или не найден",
          corrupt: "Код истёк или не найден",
          too_many_tries: "Слишком много попыток. Запросите новый код.",
          bad_code: "Неверный код",
        };
        return clientError(res, otpResult.status, messages[otpResult.reason] || "Неверный код");
      }

      let profile;
      try {
        profile = await loadUserProfile(email, req);
      } catch (err) {
        const status = isTimeoutError(err) ? timeoutStatusCode(err) : err.status || 502;
        await recordAuthEvent("verify_profile_failed", req, { email, status: "failed" });
        return clientError(
          res,
          status,
          publicMessageFromErr(err, "Не удалось завершить вход", { context: "авторизация" }),
        );
      }

      const userUuid = extractUserUuid(profile);
      if (!userUuid) {
        await recordAuthEvent("verify_profile_invalid", req, { email, status: "failed" });
        return clientError(res, 502, "Не удалось завершить вход");
      }

      const sid = base64url(randomBytes(32));
      const csrf = base64url(randomBytes(32));
      const expAt = Date.now() + SESSION_TTL_SEC * 1000;

      await saveSession(sid, { userUuid, email, csrf, expAt });
      setSessionCookies(res, sid, csrf);

      req.log.info(
        { emailHash: emailHash(email), userUuidPrefix: userUuid.slice(0, 8) },
        "login ok",
      );
      await recordAuthEvent("login_ok", req, { email, userUuid, status: "ok" });

      return res.json(profile);
    } catch (err) {
      return serverError(res, req, err);
    }
  });

  router.post("/api/auth/logout", requireSession, async (req, res) => {
    await deleteSession(req.session.sid);
    clearSessionCookies(res);
    return res.json({ ok: true });
  });

  return router;
}

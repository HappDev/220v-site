import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { SESSION_COOKIE } from "../config.mjs";
import { redis } from "../redis.mjs";
import { sendCodeSchema } from "../auth/schemas.mjs";

function makeRateLimit(opts) {
  const base = {
    ...opts,
    standardHeaders: true,
    legacyHeaders: false,
  };
  if (process.env.NODE_ENV === "test") {
    return rateLimit(base);
  }
  return rateLimit({
    ...base,
    store: new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: opts.prefix || "v220:rl:",
    }),
  });
}

export const sendCodeIpMinuteLimiter = makeRateLimit({
  windowMs: 60 * 1000,
  max: 8,
  prefix: "v220:rl:sendcode:ip:1m:",
  message: { error: "Слишком много запросов. Попробуйте позже." },
});

export const sendCodeIpHourLimiter = makeRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  prefix: "v220:rl:sendcode:ip:1h:",
  message: { error: "Слишком много запросов. Попробуйте позже." },
});

export const sendCodeEmailLimiter = makeRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 375,
  prefix: "v220:rl:sendcode:email:",
  keyGenerator: (req) => {
    const parsed = sendCodeSchema.safeParse(req.body);
    return parsed.success ? parsed.data.email : req.ip;
  },
  message: { error: "Слишком много запросов для этого email. Попробуйте позже." },
});

export const verifyIpLimiter = makeRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  prefix: "v220:rl:verify:ip:",
  message: { error: "Слишком много попыток проверки. Попробуйте позже." },
});

export const checkoutSessionLimiter = makeRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1250,
  prefix: "v220:rl:checkout:sid:",
  keyGenerator: (req) => req.cookies?.[SESSION_COOKIE] || req.ip,
  message: { error: "Слишком много попыток оплаты. Попробуйте позже." },
});

export const talkmeIpLimiter = makeRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  prefix: "v220:rl:talkme:ip:",
  message: { error: "Слишком много запросов к чату. Попробуйте позже." },
});

export const talkmeSessionLimiter = makeRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  prefix: "v220:rl:talkme:sid:",
  keyGenerator: (req) => req.cookies?.[SESSION_COOKIE] || req.ip,
  message: { error: "Слишком много запросов к чату. Попробуйте позже." },
});

export const chatUploadLimiter = makeRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  prefix: "v220:rl:chatupload:sid:",
  keyGenerator: (req) => req.cookies?.[SESSION_COOKIE] || req.ip,
  message: { error: "Слишком много загрузок файлов. Попробуйте позже." },
});

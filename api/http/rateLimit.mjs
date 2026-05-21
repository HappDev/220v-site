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
  message: { error: "Too many requests" },
});

export const sendCodeIpHourLimiter = makeRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  prefix: "v220:rl:sendcode:ip:1h:",
  message: { error: "Too many requests" },
});

export const sendCodeEmailLimiter = makeRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 375,
  prefix: "v220:rl:sendcode:email:",
  keyGenerator: (req) => {
    const parsed = sendCodeSchema.safeParse(req.body);
    return parsed.success ? parsed.data.email : req.ip;
  },
  message: { error: "Too many requests for this email" },
});

export const verifyIpLimiter = makeRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  prefix: "v220:rl:verify:ip:",
  message: { error: "Too many verification attempts" },
});

export const checkoutSessionLimiter = makeRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1250,
  prefix: "v220:rl:checkout:sid:",
  keyGenerator: (req) => req.cookies?.[SESSION_COOKIE] || req.ip,
  message: { error: "Too many checkout requests" },
});

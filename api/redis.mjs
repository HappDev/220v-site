import Redis from "ioredis";
import { logger } from "./logger.mjs";

const redisUrl = process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379/0";
export const redis =
  process.env.NODE_ENV === "test"
    ? new (await import("ioredis-mock")).default()
    : new Redis(redisUrl, {
        connectTimeout: 5000,
        enableReadyCheck: true,
        keepAlive: 30000,
        maxRetriesPerRequest: 3,
      });

redis.on("ready", () => {
  logger.info({ redisStatus: redis.status }, "redis ready");
});

redis.on("close", () => {
  logger.warn({ redisStatus: redis.status }, "redis close");
});

redis.on("end", () => {
  logger.warn({ redisStatus: redis.status }, "redis end");
});

redis.on("reconnecting", (delay) => {
  logger.warn({ redisStatus: redis.status, reconnectDelayMs: delay }, "redis reconnecting");
});

redis.on("error", (err) => {
  logger.error({ err, redisStatus: redis.status }, "redis error");
});

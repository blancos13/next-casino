import pino, { type Logger } from "pino";
import type { Env } from "../../config/env";

export const createLogger = (env: Env): Logger => {
  return pino({
    level: env.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
      service: "win2x-backend",
      env: env.NODE_ENV,
    },
  });
};


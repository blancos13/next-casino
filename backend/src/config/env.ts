import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    return false;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  WS_PATH: z.string().min(1).default("/ws"),
  MONGO_URI: z.string().min(1),
  MONGO_DB_NAME: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOCK_TTL_MS: z.coerce.number().int().positive().default(10_000),
  LOCK_WAIT_MS: z.coerce.number().int().positive().default(8_000),
  OUTBOX_DEDUPE_SIZE: z.coerce.number().int().positive().default(10_000),
  OXAPAY_API_BASE: z.string().min(1).default("https://api.oxapay.com"),
  OXAPAY_MERCHANT_API_KEY: z.string().default(""),
  OXAPAY_INVOICE_CURRENCY: z.string().min(1).default("USD"),
  OXAPAY_INVOICE_LIFETIME_MIN: z.coerce.number().int().min(15).max(2880).default(60),
  OXAPAY_STATIC_AUTO_WITHDRAWAL: booleanFromEnv.default(false),
  OXAPAY_CALLBACK_URL: z.string().default(""),
  OXAPAY_RETURN_URL: z.string().default(""),
  OXAPAY_SANDBOX: booleanFromEnv.default(false),
  OXAPAY_DEFAULT_CURRENCIES: z.string().default("USDT"),
  OXAPAY_DEFAULT_CURRENCY_NETWORKS: z
    .string()
    .default(""),
  WALLET_COINS_PER_USD: z.coerce.number().positive().default(1),
  OXAPAY_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  CURRENCY_RATE_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  ADMIN_DOMAIN: z.string().default(""),
  ADMIN_SITENAME: z.string().default(""),
  ADMIN_TITLE: z.string().default(""),
  ADMIN_DESCRIPTION: z.string().default(""),
  ADMIN_KEYWORDS: z.string().default(""),
  ADMIN_VK_URL: z.string().default(""),
  ADMIN_VK_SUPPORT_LINK: z.string().default(""),
  ADMIN_VK_SUPPORT_URL: z.string().default(""),
  ADMIN_VK_SERVICE_KEY: z.string().default(""),
  ADMIN_CHAT_DEP: z.coerce.number().default(0),
  ADMIN_EXCHANGE_MIN: z.coerce.number().default(1000),
  ADMIN_EXCHANGE_CURS: z.coerce.number().default(2),
  ADMIN_REF_PERC: z.coerce.number().default(10),
  ADMIN_REF_SUM: z.coerce.number().default(1),
  ADMIN_MIN_REF_WITHDRAW: z.coerce.number().default(1),
  ADMIN_MIN_DEP: z.coerce.number().default(0),
  ADMIN_MAX_DEP: z.coerce.number().default(0),
  ADMIN_MIN_DEP_WITHDRAW: z.coerce.number().default(0),
  ADMIN_PROFIT_KOEF: z.coerce.number().default(1),
  ADMIN_BONUS_GROUP_TIME: z.coerce.number().default(15),
  ADMIN_MAX_ACTIVE_REF: z.coerce.number().default(8),
  ADMIN_JACKPOT_COMMISSION: z.coerce.number().default(0),
  ADMIN_WHEEL_TIMER: z.coerce.number().default(30),
  ADMIN_WHEEL_MIN_BET: z.coerce.number().default(1),
  ADMIN_WHEEL_MAX_BET: z.coerce.number().default(1000),
  ADMIN_CRASH_TIMER: z.coerce.number().default(15),
  ADMIN_CRASH_MIN_BET: z.coerce.number().default(1),
  ADMIN_CRASH_MAX_BET: z.coerce.number().default(1000),
  ADMIN_BATTLE_TIMER: z.coerce.number().default(20),
  ADMIN_BATTLE_MIN_BET: z.coerce.number().default(1),
  ADMIN_BATTLE_MAX_BET: z.coerce.number().default(1000),
  ADMIN_BATTLE_COMMISSION: z.coerce.number().default(0),
  ADMIN_DICE_MIN_BET: z.coerce.number().default(1),
  ADMIN_DICE_MAX_BET: z.coerce.number().default(1000),
  ADMIN_FLIP_COMMISSION: z.coerce.number().default(0),
  ADMIN_FLIP_MIN_BET: z.coerce.number().default(1),
  ADMIN_FLIP_MAX_BET: z.coerce.number().default(1000),
  ADMIN_ROOM_EASY_TIME: z.coerce.number().default(20),
  ADMIN_ROOM_EASY_MIN: z.coerce.number().default(1),
  ADMIN_ROOM_EASY_MAX: z.coerce.number().default(200),
  ADMIN_ROOM_EASY_BETS: z.coerce.number().default(10),
  ADMIN_ROOM_MEDIUM_TIME: z.coerce.number().default(20),
  ADMIN_ROOM_MEDIUM_MIN: z.coerce.number().default(1),
  ADMIN_ROOM_MEDIUM_MAX: z.coerce.number().default(500),
  ADMIN_ROOM_MEDIUM_BETS: z.coerce.number().default(10),
  ADMIN_ROOM_HARD_TIME: z.coerce.number().default(20),
  ADMIN_ROOM_HARD_MIN: z.coerce.number().default(1),
  ADMIN_ROOM_HARD_MAX: z.coerce.number().default(1000),
  ADMIN_ROOM_HARD_BETS: z.coerce.number().default(10),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

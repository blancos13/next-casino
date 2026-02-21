import type { Logger } from "pino";
import { MongoClient } from "mongodb";
import type { Env } from "../../config/env";

export const connectMongo = async (env: Env, logger: Logger): Promise<MongoClient> => {
  const client = new MongoClient(env.MONGO_URI, {
    retryReads: true,
    retryWrites: true,
    maxPoolSize: 100,
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    await client.connect();
    logger.info({ module: "mongo" }, "MongoDB connected");
    return client;
  } catch (error) {
    const reasonType =
      typeof error === "object" && error && "reason" in error
        ? (error as { reason?: { type?: string } }).reason?.type
        : undefined;
    if (reasonType === "ReplicaSetNoPrimary") {
      logger.error(
        {
          module: "mongo",
          uri: env.MONGO_URI,
          reasonType,
        },
        "Mongo reachable but no replica set primary. Initialize rs0 before starting backend.",
      );
      throw new Error(
        "Mongo replica set has no PRIMARY. Run: npm run mongo:setup-rs (and ensure mongod is running on localhost:27017).",
      );
    }
    throw error;
  }
};

export const ensureIndexes = async (client: MongoClient, env: Env): Promise<void> => {
  const db = client.db(env.MONGO_DB_NAME);

  await Promise.all([
    db.collection("users").createIndex({ username: 1 }, { unique: true }),
    db.collection("users").createIndex({ email: 1 }, { unique: true, sparse: true }),
    db.collection("users").createIndex({ affiliateCode: 1 }, { unique: true, sparse: true }),
    db.collection("users").createIndex({ referredBy: 1 }, { sparse: true }),

    db.collection("sessions").createIndex({ refreshTokenHash: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ userId: 1, revoked: 1 }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),

    db.collection("request_ledger").createIndex({ userId: 1, requestId: 1 }, { unique: true }),
    db.collection("request_ledger").createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 }),

    db.collection("locks").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),

    db.collection("event_outbox").createIndex({ createdAt: 1 }),
    db.collection("event_outbox").createIndex({ aggregateType: 1, aggregateId: 1, version: 1 }),

    db.collection("promo_redemptions").createIndex({ userId: 1, promoCodeId: 1 }, { unique: true }),

    db.collection("wallet_ledger").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("wallet_ledger").createIndex({ requestId: 1 }, { unique: true, sparse: true }),
    db.collection("wallet_deposits").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("wallet_deposits").createIndex({ providerTrackId: 1 }, { unique: true }),
    db.collection("wallet_deposits").createIndex({ requestId: 1 }, { unique: true, sparse: true }),
    db.collection("wallet_static_addresses").createIndex({ userId: 1, provider: 1, toCurrency: 1, network: 1 }, { unique: true }),
    db.collection("wallet_static_addresses").createIndex({ provider: 1, trackId: 1 }, { unique: true }),
    db.collection("wallet_static_addresses").createIndex({ provider: 1, addressLc: 1 }, { unique: true }),
    db.collection("wallet_provider_currency_catalog").createIndex({ provider: 1 }, { unique: true }),
    db.collection("wallet_provider_currency_catalog").createIndex({ updatedAt: -1 }),

    db.collection("dice_games").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("crash_rounds").createIndex({ createdAt: -1 }),
    db.collection("jackpot_rounds").createIndex({ createdAt: -1 }),
    db.collection("wheel_rounds").createIndex({ createdAt: -1 }),
    db.collection("coinflip_games").createIndex({ createdAt: -1 }),
    db.collection("battle_rounds").createIndex({ createdAt: -1 }),

    db.collection("chat_messages").createIndex({ createdAt: -1 }),
    db.collection("bonus_spins").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("affiliate_visits").createIndex({ referrerId: 1, visitorId: 1 }, { unique: true }),
    db.collection("affiliate_visits").createIndex({ createdAt: -1 }),
    db.collection("affiliate_earnings").createIndex({ eventKey: 1 }, { unique: true, sparse: true }),
    db.collection("affiliate_earnings").createIndex({ referrerId: 1, createdAt: -1 }),
    db.collection("currency_rates").createIndex({ base: 1, quote: 1 }, { unique: true }),
  ]);
};

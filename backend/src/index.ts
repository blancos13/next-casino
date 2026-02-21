import { env } from "./config/env";
import { createLogger } from "./infra/logging/logger";
import { connectMongo, ensureIndexes } from "./infra/db/mongo";
import { EventBus } from "./infra/events/event-bus";
import { OutboxService } from "./infra/events/outbox";
import { RequestLedgerService } from "./infra/idempotency/request-ledger";
import { MongoLockManager } from "./infra/locks/mongo-lock";
import { WsRouter } from "./infra/ws/router";
import { WsAppServer } from "./infra/ws/server";
import { JwtService } from "./infra/security/jwt";
import { AuthService } from "./auth/auth.service";
import { registerAuthHandlers } from "./auth/auth.handler";
import { WalletService } from "./wallet/wallet.service";
import { registerWalletHandlers } from "./wallet/wallet.handler";
import { OxaPayClient } from "./wallet/oxapay.client";
import { CurrencyRateSyncService } from "./wallet/currency-rate-sync.service";
import { PromoCodeService } from "./promocode/promocode.service";
import { registerPromoHandlers } from "./promocode/promocode.handler";
import { DiceService, registerDiceHandlers } from "./games/dice";
import { CrashService, registerCrashHandlers } from "./games/crash";
import { JackpotService, registerJackpotHandlers } from "./games/jackpot";
import { WheelService, registerWheelHandlers } from "./games/wheel";
import { CoinflipService, registerCoinflipHandlers } from "./games/coinflip";
import { BattleService, registerBattleHandlers } from "./games/battle";
import { registerFairHandlers } from "./games/fair";
import { ChatService } from "./chat/chat.service";
import { registerChatHandlers } from "./chat/chat.handler";
import { BonusService } from "./bonus/bonus.service";
import { registerBonusHandlers } from "./bonus/bonus.handler";
import { AdminService } from "./admin/admin.service";
import { registerAdminHandlers } from "./admin/admin.handler";
import { AffiliateService } from "./user/affiliate.service";
import { registerAffiliateHandlers } from "./user/affiliate.handler";
import { ProfileService } from "./user/profile.service";
import { registerProfileHandlers } from "./user/profile.handler";
import type { AppContext } from "./common/request-context";

const registerAliases = (router: WsRouter): void => {
  const aliases: Array<[string, string]> = [
    ["dice_bet", "dice.bet"],
    ["promo_activate", "promo.redeem"],
    ["crash_newBet", "crash.bet"],
    ["crash_cashout", "crash.cashout"],
    ["jackpot_newBet", "jackpot.bet"],
    ["wheel_newBet", "wheel.bet"],
    ["coinflip_newBet", "coinflip.create"],
    ["coinflip_joinGame", "coinflip.join"],
    ["battle_newBet", "battle.bet"],
    ["free_getWheel", "bonus.getWheel"],
    ["free_spin", "bonus.spin"],
    ["chat_send", "chat.send"],
    ["chat_history", "chat.history"],
    ["wallet_withdraw", "wallet.withdraw.request"],
    ["wallet_pay", "wallet.deposit.staticAddress"],
    ["wallet_exchange", "wallet.exchange"],
    ["affiliate_get", "affiliate.claim"],
  ];
  for (const [alias, target] of aliases) {
    router.registerAlias(alias, target);
  }
};

const bootstrap = async (): Promise<void> => {
  const logger = createLogger(env);
  const mongoClient = await connectMongo(env, logger);
  await ensureIndexes(mongoClient, env);
  const db = mongoClient.db(env.MONGO_DB_NAME);

  const eventBus = new EventBus(logger, env.OUTBOX_DEDUPE_SIZE);
  const outbox = new OutboxService(db, eventBus, logger);
  const requestLedger = new RequestLedgerService(db);
  const lockManager = new MongoLockManager(db, env.LOCK_TTL_MS, env.LOCK_WAIT_MS);
  const router = new WsRouter();
  const jwtService = new JwtService(env);

  const authService = new AuthService(db, jwtService, env.JWT_ACCESS_TTL_SEC, env.JWT_REFRESH_TTL_SEC);
  const oxapayClient = new OxaPayClient(env);
  const walletService = new WalletService(db, mongoClient, lockManager, outbox, oxapayClient);
  const currencyRateSync = new CurrencyRateSyncService(db, logger, env.CURRENCY_RATE_SYNC_INTERVAL_MS);
  const affiliateService = new AffiliateService(db, walletService);
  const promoService = new PromoCodeService(db, mongoClient, lockManager, walletService, outbox);
  const diceService = new DiceService(db, mongoClient, lockManager, walletService, outbox, affiliateService);
  const crashService = new CrashService(db, mongoClient, lockManager, walletService, outbox, affiliateService);
  const jackpotService = new JackpotService(db, mongoClient, lockManager, walletService, outbox, affiliateService);
  const wheelService = new WheelService(db, mongoClient, lockManager, walletService, outbox, affiliateService);
  const coinflipService = new CoinflipService(db, lockManager, walletService, outbox, affiliateService);
  const battleService = new BattleService(db, lockManager, walletService, outbox, affiliateService);
  const chatService = new ChatService(db, outbox);
  const bonusService = new BonusService(db, walletService, outbox);
  const metrics = {
    activeConnections: 0,
    totalRequests: 0,
    totalErrors: 0,
    lockTimeouts: 0,
    requestInProgress: 0,
    txRollbacks: 0,
  };
  const adminService = new AdminService(db, metrics, walletService, env);
  const profileService = new ProfileService(db);

  const appContext: AppContext = {
    logger,
    mongoClient,
    db,
    eventBus,
    outbox,
    requestLedger,
    lockManager,
    services: {
      authService,
      walletService,
      promoService,
      diceService,
      crashService,
      jackpotService,
      wheelService,
      coinflipService,
      battleService,
      chatService,
      bonusService,
      adminService,
      affiliateService,
      profileService,
    },
    metrics,
  };

  registerAliases(router);
  registerAuthHandlers(router, authService);
  registerWalletHandlers(router, walletService);
  registerPromoHandlers(router, promoService);
  registerDiceHandlers(router, diceService);
  registerCrashHandlers(router, crashService);
  registerJackpotHandlers(router, jackpotService);
  registerWheelHandlers(router, wheelService);
  registerCoinflipHandlers(router, coinflipService);
  registerBattleHandlers(router, battleService);
  registerFairHandlers(router, db);
  registerChatHandlers(router, chatService);
  registerBonusHandlers(router, bonusService);
  registerAdminHandlers(router, adminService);
  registerAffiliateHandlers(router, affiliateService);
  registerProfileHandlers(router, profileService);

  await outbox.start();
  await currencyRateSync.start();

  const server = new WsAppServer(appContext, router, {
    port: env.PORT,
    wsPath: env.WS_PATH,
  });
  await server.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Graceful shutdown started");
    await server.stop();
    currencyRateSync.stop();
    await outbox.stop();
    await mongoClient.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT").catch((error) => {
      logger.error({ err: error }, "Shutdown failure");
      process.exit(1);
    });
  });

  process.on("SIGTERM", () => {
    shutdown("SIGTERM").catch((error) => {
      logger.error({ err: error }, "Shutdown failure");
      process.exit(1);
    });
  });
};

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

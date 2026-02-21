import { randomUUID } from "crypto";
import { z } from "zod";
import type { Db, Document } from "mongodb";
import { AppError } from "../common/errors";
import { moneyToAtomic } from "../common/money";
import type { OutboxService } from "../infra/events/outbox";
import type { MongoLockManager } from "../infra/locks/mongo-lock";
import type { WsRouter } from "../infra/ws/router";
import type { WalletService } from "../wallet/wallet.service";
import { GAME_EVENTS } from "./shared/game-events";
import { GameHistoryService } from "./shared/game-history.service";
import type { AffiliateService } from "../user/affiliate.service";

type CoinSide = "heads" | "tails";

type CoinflipOpenGame = {
  id: string;
  creatorUserId: string;
  creatorUsername: string;
  creatorSide: CoinSide;
  amount: number;
  creatorTicketFrom: number;
  creatorTicketTo: number;
  createdAt: number;
};

const createSchema = z.object({
  amount: z.number().positive().max(100000),
  side: z.enum(["heads", "tails"]),
});

const joinSchema = z.object({
  gameId: z.string().min(1),
});

const SETTINGS_CACHE_TTL_MS = 5_000;
const DEFAULT_COINFLIP_CONFIG = {
  minBet: 0.1,
  maxBet: 100,
  commissionPct: 3,
};

export class CoinflipService {
  private readonly openGames = new Map<string, CoinflipOpenGame>();
  private readonly history: GameHistoryService;
  private config = { ...DEFAULT_COINFLIP_CONFIG };
  private settingsLoadedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly lockManager: MongoLockManager,
    private readonly walletService: WalletService,
    private readonly outbox: OutboxService,
    private readonly affiliateService?: AffiliateService,
  ) {
    this.history = new GameHistoryService(db);
    void this.refreshConfig(true).catch(() => undefined);
  }

  async subscribe(): Promise<{ openGames: CoinflipOpenGame[]; minBet: number; maxBet: number }> {
    await this.refreshConfig();
    return {
      openGames: [...this.openGames.values()],
      minBet: this.config.minBet,
      maxBet: this.config.maxBet,
    };
  }

  async create(
    userId: string,
    username: string,
    requestId: string,
    amount: number,
    side: CoinSide,
  ): Promise<Record<string, unknown>> {
    await this.refreshConfig();
    if (amount < this.config.minBet) {
      throw new AppError("VALIDATION_ERROR", `Minimum bet amount ${this.config.minBet}$!`);
    }
    if (amount > this.config.maxBet) {
      throw new AppError("VALIDATION_ERROR", `Maximum bet amount ${this.config.maxBet}$!`);
    }

    const gameLock = await this.lockManager.acquire("game:coinflip");
    try {
      const balance = await this.walletService.applyMutation({
        userId,
        requestId: `${requestId}:coinflip:create`,
        ledgerType: "game_bet",
        deltaMainAtomic: -moneyToAtomic(amount),
        deltaBonusAtomic: 0n,
        metadata: { game: "coinflip" },
      });

      const game: CoinflipOpenGame = {
        id: randomUUID(),
        creatorUserId: userId,
        creatorUsername: username,
        creatorSide: side,
        amount,
        creatorTicketFrom: 1,
        creatorTicketTo: 1 + Math.max(1, Math.floor(amount * 100)),
        createdAt: Date.now(),
      };
      this.openGames.set(game.id, game);

      await this.outbox.append({
        type: GAME_EVENTS.COINFLIP_CREATED,
        aggregateType: "coinflip",
        aggregateId: game.id,
        version: 1,
        payload: game,
      });

      return {
        game,
        balance,
      };
    } finally {
      await this.lockManager.release(gameLock);
    }
  }

  async join(
    userId: string,
    username: string,
    requestId: string,
    gameId: string,
  ): Promise<Record<string, unknown>> {
    await this.refreshConfig();
    const gameLock = await this.lockManager.acquire(`game:coinflip:${gameId}`);
    try {
      const game = this.openGames.get(gameId);
      if (!game) {
        throw new AppError("NOT_FOUND", "Coinflip game not found");
      }
      if (game.creatorUserId === userId) {
        throw new AppError("FORBIDDEN", "Cannot join your own game");
      }

      const joinBalance = await this.walletService.applyMutation({
        userId,
        requestId: `${requestId}:coinflip:join`,
        ledgerType: "game_bet",
        deltaMainAtomic: -moneyToAtomic(game.amount),
        deltaBonusAtomic: 0n,
        metadata: { game: "coinflip", gameId },
      });

      const tailSide: CoinSide = game.creatorSide === "heads" ? "tails" : "heads";
      const creatorTicketFrom = game.creatorTicketFrom;
      const creatorTicketTo = game.creatorTicketTo;
      const joinerTicketFrom = creatorTicketTo + 1;
      const joinerTicketTo = creatorTicketTo + Math.max(1, Math.floor(game.amount * 100));
      const winnerTicket = Math.floor(Math.random() * joinerTicketTo) + 1;
      const winnerIsCreator = winnerTicket >= creatorTicketFrom && winnerTicket <= creatorTicketTo;
      const winnerUserId = winnerIsCreator ? game.creatorUserId : userId;
      const winnerUsername = winnerUserId === game.creatorUserId ? game.creatorUsername : username;
      const resultSide = winnerIsCreator ? game.creatorSide : tailSide;
      const payout = Number((game.amount * 2 * (1 - this.config.commissionPct / 100)).toFixed(2));
      const winnerProfit = Number((payout - game.amount).toFixed(2));

      const winnerBalance = await this.walletService.applyMutation({
        userId: winnerUserId,
        requestId: `${requestId}:coinflip:payout`,
        ledgerType: "game_payout",
        deltaMainAtomic: moneyToAtomic(payout),
        deltaBonusAtomic: 0n,
        metadata: { game: "coinflip", gameId, resultSide },
      });

      const resolved = {
        gameId,
        creatorUserId: game.creatorUserId,
        creatorUsername: game.creatorUsername,
        joinerUserId: userId,
        joinerUsername: username,
        amount: game.amount,
        creatorSide: game.creatorSide,
        creatorTicketFrom,
        creatorTicketTo,
        joinerTicketFrom,
        joinerTicketTo,
        resultSide,
        winnerTicket,
        winnerUserId,
        winnerUsername,
        payout,
      };

      this.openGames.delete(gameId);

      await this.history.append("coinflip_games", resolved);
      await this.outbox.append({
        type: GAME_EVENTS.COINFLIP_RESOLVED,
        aggregateType: "coinflip",
        aggregateId: gameId,
        version: Date.now(),
        payload: resolved,
      });

      if (winnerProfit > 0 && this.affiliateService) {
        try {
          await this.affiliateService.creditFromReferralWin({
            winnerUserId,
            winAmount: winnerProfit,
            eventKey: `coinflip:${gameId}:${winnerUserId}`,
            context: {
              game: "coinflip",
              gameId,
              resultSide,
            },
          });
        } catch {
          // Referral payout failures should not fail resolved game result.
        }
      }

      return {
        result: resolved,
        joinBalance,
        winnerBalance,
      };
    } finally {
      await this.lockManager.release(gameLock);
    }
  }

  private async refreshConfig(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.settingsLoadedAt < SETTINGS_CACHE_TTL_MS) {
      return;
    }

    const settings = await this.db.collection<Document>("settings").findOne(
      {},
      {
        sort: { id: 1, _id: 1 },
        projection: {
          flip_min_bet: 1,
          flip_max_bet: 1,
          flip_commission: 1,
        },
      },
    );

    const minBet = this.asPositiveNumber(settings?.flip_min_bet, DEFAULT_COINFLIP_CONFIG.minBet);
    const parsedMaxBet = this.asPositiveNumber(settings?.flip_max_bet, DEFAULT_COINFLIP_CONFIG.maxBet);
    const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;
    const commissionPct = this.asPercent(settings?.flip_commission, DEFAULT_COINFLIP_CONFIG.commissionPct);

    this.config = {
      minBet,
      maxBet,
      commissionPct,
    };
    this.settingsLoadedAt = now;
  }

  private asPositiveNumber(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return fallback;
  }

  private asPercent(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.min(100, value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.min(100, parsed);
      }
    }
    return fallback;
  }
}

export const registerCoinflipHandlers = (router: WsRouter, coinflipService: CoinflipService): void => {
  router.register("coinflip.subscribe", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      ctx.client.subscriptions.add("coinflip");
      return { data: await coinflipService.subscribe() };
    },
  });

  router.register("coinflip.create", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = createSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid coinflip create payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      if (!ctx.request.requestId) {
        throw new AppError("VALIDATION_ERROR", "requestId is required");
      }
      const result = await coinflipService.create(
        user.userId,
        user.username,
        ctx.request.requestId,
        parsed.data.amount,
        parsed.data.side,
      );
      return { data: result };
    },
  });

  router.register("coinflip.join", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = joinSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid coinflip join payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      if (!ctx.request.requestId) {
        throw new AppError("VALIDATION_ERROR", "requestId is required");
      }
      const result = await coinflipService.join(
        user.userId,
        user.username,
        ctx.request.requestId,
        parsed.data.gameId,
      );
      return { data: result };
    },
  });
};

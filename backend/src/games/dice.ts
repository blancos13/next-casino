import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { type Db, type Document, type MongoClient } from "mongodb";
import { AppError } from "../common/errors";
import { moneyToAtomic } from "../common/money";
import type { OutboxService } from "../infra/events/outbox";
import type { MongoLockManager } from "../infra/locks/mongo-lock";
import type { WsRouter } from "../infra/ws/router";
import { GAME_EVENTS } from "./shared/game-events";
import { GameHistoryService } from "./shared/game-history.service";
import type { WalletService } from "../wallet/wallet.service";
import type { AffiliateService } from "../user/affiliate.service";

const diceBetSchema = z
  .object({
    amount: z.coerce.number().positive().max(100000).optional(),
    betAmount: z.coerce.number().positive().max(100000).optional(),
    chance: z.coerce.number().min(2).max(98).optional(),
    target: z.coerce.number().min(2).max(98).optional(),
    direction: z.enum(["under", "over"]).optional(),
    condition: z.enum(["under", "over"]).optional(),
    clientSeed: z.string().min(1).max(128).optional(),
  })
  .superRefine((value, ctx) => {
    const amount = value.amount ?? value.betAmount;
    if (amount === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "amount or betAmount is required",
      });
    }

    const direction = value.direction ?? value.condition ?? "under";

    if (value.chance === undefined && value.target === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chance"],
        message: "chance or target is required",
      });
      return;
    }

    if (value.target !== undefined && direction) {
      const derivedChance = direction === "over" ? 100 - value.target : value.target;
      if (derivedChance < 2 || derivedChance > 98) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["target"],
          message: "target produces unsupported win chance; expected 2..98",
        });
      }
    }
  });

const toRollFromHash = (hashHex: string): number => {
  const first = hashHex.slice(0, 13);
  const value = BigInt(`0x${first}`) % 10_000n;
  return Number(value) / 100;
};

type DiceResult = {
  betId: string;
  username: string;
  amount: number;
  chance: number;
  direction: "under" | "over";
  rate: number;
  roll: number;
  win: boolean;
  payout: number;
  profit: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  balance: { main: string; bonus: string; stateVersion: number };
};

type DiceBetInput = {
  amount: number;
  chance: number;
  direction: "under" | "over";
  clientSeed?: string;
};

const normalizeDiceInput = (input: z.infer<typeof diceBetSchema>): DiceBetInput => {
  const direction = (input.direction ?? input.condition ?? "under") as "under" | "over";
  const amount = input.amount ?? input.betAmount ?? 0;
  const chanceRaw = input.chance ?? (direction === "over" ? 100 - (input.target ?? 50) : (input.target ?? 50));
  return {
    amount,
    chance: Number(chanceRaw.toFixed(2)),
    direction,
    clientSeed: input.clientSeed,
  };
};

const SETTINGS_CACHE_TTL_MS = 5_000;
const DEFAULT_DICE_CONFIG = {
  minBet: 0.1,
  maxBet: 100,
};

export class DiceService {
  private readonly history: GameHistoryService;
  private config = { ...DEFAULT_DICE_CONFIG };
  private settingsLoadedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly mongoClient: MongoClient,
    private readonly lockManager: MongoLockManager,
    private readonly walletService: WalletService,
    private readonly outbox: OutboxService,
    private readonly affiliateService?: AffiliateService,
  ) {
    this.history = new GameHistoryService(db);
    void this.refreshConfig(true).catch(() => undefined);
  }

  async bet(
    userId: string,
    username: string,
    requestId: string,
    input: DiceBetInput,
  ): Promise<DiceResult> {
    await this.refreshConfig();
    if (input.amount < this.config.minBet) {
      throw new AppError("VALIDATION_ERROR", `Minimum bet amount ${this.config.minBet}$!`);
    }
    if (input.amount > this.config.maxBet) {
      throw new AppError("VALIDATION_ERROR", `Maximum bet amount ${this.config.maxBet}$!`);
    }

    const lock = await this.lockManager.acquire(`wallet:${userId}`);
    const session = this.mongoClient.startSession();
    try {
      const txResult = await session.withTransaction(async () => {
        const amountAtomic = moneyToAtomic(input.amount);
        const betMutation = await this.walletService.applyMutationInSession(
          {
            userId,
            requestId: `${requestId}:bet`,
            ledgerType: "game_bet",
            deltaMainAtomic: -amountAtomic,
            deltaBonusAtomic: 0n,
            metadata: { game: "dice" },
          },
          session,
        );

        const nonceResult = await this.db.collection<{ userId: string; nonce: number }>("dice_nonces").findOneAndUpdate(
          { userId },
          {
            $inc: { nonce: 1 },
            $setOnInsert: { userId },
          },
          {
            upsert: true,
            returnDocument: "after",
            session,
          },
        );
        const nonce = nonceResult?.nonce ?? 1;

        const clientSeed = input.clientSeed ?? userId;
        const serverSeed = randomBytes(32).toString("hex");
        const hash = createHash("sha256").update(`${serverSeed}:${clientSeed}:${nonce}`).digest("hex");
        const roll = toRollFromHash(hash);
        const rate = Number((96 / input.chance).toFixed(2));
        const win = input.direction === "under" ? roll < input.chance : roll > 100 - input.chance;
        const payout = win ? Number((input.amount * rate).toFixed(2)) : 0;
        const payoutAtomic = win ? moneyToAtomic(payout) : 0n;
        const profit = Number((payout - input.amount).toFixed(2));

        const walletAfter =
          payoutAtomic > 0n
            ? await this.walletService.applyMutationInSession(
                {
                  userId,
                  requestId: `${requestId}:payout`,
                  ledgerType: "game_payout",
                  deltaMainAtomic: payoutAtomic,
                  deltaBonusAtomic: 0n,
                  metadata: { game: "dice" },
                },
                session,
              )
            : betMutation;

        const historyId = await this.history.append(
          "dice_games",
          {
            userId,
            username,
            requestId,
            amount: input.amount,
            chance: input.chance,
            direction: input.direction,
            rate,
            roll,
            win,
            payout,
            profit,
            serverSeedHash: createHash("sha256").update(serverSeed).digest("hex"),
            clientSeed,
            nonce,
          },
          session,
        );

        await this.outbox.append(
          {
            type: GAME_EVENTS.STREAM_BET_CREATED,
            aggregateType: "dice",
            aggregateId: historyId,
            version: walletAfter.stateVersion,
            payload: {
              game: "dice",
              betId: historyId,
              userId,
              username,
              amount: input.amount,
              chance: input.chance,
              rate,
              roll,
              win,
              payout,
              profit,
            },
          },
          session,
        );

        return {
          betId: historyId,
          username,
          amount: input.amount,
          chance: input.chance,
          direction: input.direction,
          rate,
          roll,
          win,
          payout,
          profit,
          serverSeedHash: createHash("sha256").update(serverSeed).digest("hex"),
          clientSeed,
          nonce,
          balance: {
            main: walletAfter.main,
            bonus: walletAfter.bonus,
            stateVersion: walletAfter.stateVersion,
          },
        };
      });

      if (!txResult) {
        throw new AppError("INTERNAL_ERROR", "Dice transaction failed");
      }

      if (txResult.win && txResult.profit > 0 && this.affiliateService) {
        try {
          await this.affiliateService.creditFromReferralWin({
            winnerUserId: userId,
            winAmount: txResult.profit,
            eventKey: `dice:${txResult.betId}:profit`,
            context: {
              game: "dice",
              betId: txResult.betId,
            },
          });
        } catch {
          // Referral payout failures should not fail resolved game result.
        }
      }

      return txResult;
    } finally {
      await session.endSession();
      await this.lockManager.release(lock);
    }
  }

  async subscribe(): Promise<{ subscribed: true; minBet: number; maxBet: number }> {
    await this.refreshConfig();
    return {
      subscribed: true,
      minBet: this.config.minBet,
      maxBet: this.config.maxBet,
    };
  }

  async snapshot(limit = 20): Promise<{ bets: Array<Record<string, unknown>> }> {
    const latest = await this.history.latest("dice_games", limit);
    return { bets: latest };
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
          dice_min_bet: 1,
          dice_max_bet: 1,
        },
      },
    );

    const minBet = this.asPositiveNumber(settings?.dice_min_bet, DEFAULT_DICE_CONFIG.minBet);
    const parsedMaxBet = this.asPositiveNumber(settings?.dice_max_bet, DEFAULT_DICE_CONFIG.maxBet);
    const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;

    this.config = {
      minBet,
      maxBet,
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
}

export const registerDiceHandlers = (router: WsRouter, diceService: DiceService): void => {
  router.register("dice.subscribe", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      ctx.client.subscriptions.add("dice");
      ctx.client.subscriptions.add(GAME_EVENTS.STREAM_BET_CREATED);
      return { data: await diceService.subscribe() };
    },
  });

  router.register("dice.bet", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = diceBetSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid dice bet payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      if (!ctx.request.requestId) {
        throw new AppError("VALIDATION_ERROR", "requestId is required");
      }
      const normalizedInput = normalizeDiceInput(parsed.data);
      const result = await diceService.bet(user.userId, user.username, ctx.request.requestId, normalizedInput);
      return { data: result };
    },
  });

  router.register("dice.snapshot.get", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      const limit = typeof (ctx.request.data as { limit?: unknown })?.limit === "number"
        ? Math.max(1, Math.min(100, (ctx.request.data as { limit: number }).limit))
        : 20;
      const result = await diceService.snapshot(limit);
      return { data: result };
    },
  });
};

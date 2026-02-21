import { randomBytes, randomUUID } from "crypto";
import { z } from "zod";
import type { Db, Document, MongoClient } from "mongodb";
import { AppError } from "../common/errors";
import { moneyToAtomic } from "../common/money";
import type { OutboxService } from "../infra/events/outbox";
import type { LockLease, MongoLockManager } from "../infra/locks/mongo-lock";
import type { WsRouter } from "../infra/ws/router";
import type { WalletService } from "../wallet/wallet.service";
import { GAME_EVENTS } from "./shared/game-events";
import { GameHistoryService } from "./shared/game-history.service";
import type { AffiliateService } from "../user/affiliate.service";

type WheelColor = "red" | "black" | "green" | "yellow";

type WheelBet = {
  userId: string;
  username: string;
  amount: number;
  color: WheelColor;
};

type WheelRound = {
  id: string;
  hash: string;
  countdownSec: number;
  bets: WheelBet[];
  version: number;
};

type WheelHistoryItem = {
  color: WheelColor;
  hash: string;
};

const wheelBetSchema = z.object({
  amount: z.number().positive().max(100000),
  color: z.enum(["red", "black", "green", "yellow"]),
});

const resolveWheelResult = (): WheelColor => {
  const point = Math.random() * 100;
  if (point < 47.9) {
    return "black";
  }
  if (point < 87.9) {
    return "red";
  }
  if (point < 99.9) {
    return "green";
  }
  return "yellow";
};

const colorRate: Record<WheelColor, number> = {
  black: 2,
  red: 3,
  green: 5,
  yellow: 50,
};

const wheelAnglesByColor: Record<WheelColor, number[]> = {
  yellow: [0],
  green: [6.5, 60.3, 73.7, 126.9, 140.2, 219.5, 232.7, 285.9, 299.3, 352.9],
  red: [
    19.7, 32.9, 46.3, 86.5, 99.7, 113.2, 153.1, 166.4, 179.8, 193.1, 206.3, 246.4, 259.7, 273.1,
    313, 326.4, 339.7,
  ],
  black: [
    13.1, 26.4, 39.6, 53.1, 66.3, 79.7, 93.1, 119.7, 133.1, 146.3, 159.7, 172.9, 186.3, 199.7, 212.9,
    226.3, 239.7, 252.9, 266.3, 279.7, 292.9, 306.3, 319.7, 332.9, 346.3,
  ],
};

const pickAngleForColor = (color: WheelColor): number => {
  const list = wheelAnglesByColor[color];
  const index = Math.floor(Math.random() * list.length);
  return list[index] ?? 0;
};

const normalizeRotationDeg = (value: number): number => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const makeWheelHash = (): string => randomBytes(16).toString("hex");

const GAME_LOCK_WAIT_MS = 12_000;
const RESOLVE_LOCK_WAIT_MS = 15_000;
const WHEEL_SPIN_TURNS_DEG = 1080;
const SETTINGS_CACHE_TTL_MS = 5_000;
const DEFAULT_WHEEL_CONFIG = {
  timerSec: 15,
  minBet: 0.1,
  maxBet: 100,
};

const normalizeWheelAngle = (angle: number): number => Number(normalizeRotationDeg(angle).toFixed(1));

export class WheelService {
  private round: WheelRound;
  private timer: NodeJS.Timeout | null = null;
  private readonly historyStore: GameHistoryService;
  private historyItems: WheelHistoryItem[] = [];
  private rotateDeg = 0;
  private resolving = false;
  private config = { ...DEFAULT_WHEEL_CONFIG };
  private settingsLoadedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly mongoClient: MongoClient,
    private readonly lockManager: MongoLockManager,
    private readonly walletService: WalletService,
    private readonly outbox: OutboxService,
    private readonly affiliateService?: AffiliateService,
  ) {
    this.historyStore = new GameHistoryService(db);
    this.round = this.newRound();
    void this.refreshConfig(true).catch(() => undefined);
    this.startLoop();
  }

  async subscribe(): Promise<Record<string, unknown>> {
    return this.snapshot();
  }

  async bet(
    userId: string,
    username: string,
    requestId: string,
    amount: number,
    color: WheelColor,
  ): Promise<Record<string, unknown>> {
    await this.refreshConfig();
    if (this.round.countdownSec <= 0 || this.resolving) {
      throw new AppError("CONFLICT", "Wheel round is resolving", { retryable: true });
    }
    if (amount < this.config.minBet) {
      throw new AppError("VALIDATION_ERROR", `Minimum bet amount ${this.config.minBet}$!`);
    }
    if (amount > this.config.maxBet) {
      throw new AppError("VALIDATION_ERROR", `Maximum bet amount ${this.config.maxBet}$!`);
    }

    let gameLock: LockLease | null = null;
    let walletLock: LockLease | null = null;
    const session = this.mongoClient.startSession();
    try {
      gameLock = await this.acquireLockOrConflict("game:wheel", "Wheel is busy", GAME_LOCK_WAIT_MS);
      walletLock = await this.acquireLockOrConflict(`wallet:${userId}`, "Wallet is busy", GAME_LOCK_WAIT_MS);
      if (this.round.countdownSec <= 0 || this.resolving) {
        throw new AppError("CONFLICT", "Wheel round is resolving", { retryable: true });
      }

      const txResult = await session.withTransaction(async () => {
        const balance = await this.walletService.applyMutationInSession(
          {
            userId,
            requestId: `${requestId}:wheel:bet`,
            ledgerType: "game_bet",
            deltaMainAtomic: -moneyToAtomic(amount),
            deltaBonusAtomic: 0n,
            metadata: { game: "wheel", roundId: this.round.id, color },
          },
          session,
        );

        this.round.bets.push({ userId, username, amount, color });
        this.round.version += 1;

        await this.outbox.append(
          {
            type: GAME_EVENTS.WHEEL_BETS,
            aggregateType: "wheel",
            aggregateId: this.round.id,
            version: this.round.version,
            payload: this.snapshot(),
          },
          session,
        );

        return {
          roundId: this.round.id,
          balance,
        };
      });

      if (!txResult) {
        throw new AppError("INTERNAL_ERROR", "Wheel bet failed");
      }
      return txResult;
    } finally {
      await session.endSession();
      if (walletLock) {
        await this.lockManager.release(walletLock);
      }
      if (gameLock) {
        await this.lockManager.release(gameLock);
      }
    }
  }

  snapshot(): Record<string, unknown> {
    return {
      roundId: this.round.id,
      hash: this.round.hash,
      countdownSec: this.round.countdownSec,
      version: this.round.version,
      bets: this.round.bets,
      minBet: this.config.minBet,
      maxBet: this.config.maxBet,
      history: this.historyItems,
      rotateDeg: this.rotateDeg,
    };
  }

  private newRound(): WheelRound {
    return {
      id: randomUUID(),
      hash: makeWheelHash(),
      countdownSec: this.config.timerSec,
      bets: [],
      version: 1,
    };
  }

  private startLoop(): void {
    this.resolving = false;
    this.publish(GAME_EVENTS.WHEEL_NEW_ROUND, this.snapshot()).catch(() => undefined);
    this.timer = setInterval(() => {
      if (this.resolving) {
        return;
      }
      if (this.round.countdownSec > 0) {
        this.round.countdownSec -= 1;
        this.round.version += 1;
        this.publish(GAME_EVENTS.WHEEL_TIMER, {
          roundId: this.round.id,
          hash: this.round.hash,
          countdownSec: this.round.countdownSec,
        }).catch(() => undefined);
      }
      if (this.round.countdownSec <= 0 && !this.resolving) {
        this.resolving = true;
        this.resolveRound().catch(() => undefined);
      }
    }, 1000);
  }

  private async resolveRound(): Promise<void> {
    let gameLock: LockLease | null = null;
    try {
      gameLock = await this.acquireLockOrConflict("game:wheel", "Wheel is busy", RESOLVE_LOCK_WAIT_MS);
      this.resolving = true;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }

      const resultColor = resolveWheelResult();
      const winningBets = this.round.bets.filter((bet) => bet.color === resultColor);
      const payoutByUser = new Map<string, number>();
      const stakeByUser = new Map<string, number>();
      for (const bet of winningBets) {
        const payout = Number((bet.amount * colorRate[resultColor]).toFixed(2));
        payoutByUser.set(bet.userId, Number(((payoutByUser.get(bet.userId) ?? 0) + payout).toFixed(2)));
        stakeByUser.set(bet.userId, Number(((stakeByUser.get(bet.userId) ?? 0) + bet.amount).toFixed(2)));
      }

      for (const [userId, payout] of payoutByUser.entries()) {
        await this.walletService.applyMutation({
          userId,
          requestId: `wheel:${this.round.id}:${userId}`,
          ledgerType: "game_payout",
          deltaMainAtomic: moneyToAtomic(payout),
          deltaBonusAtomic: 0n,
          metadata: {
            game: "wheel",
            roundId: this.round.id,
            color: resultColor,
          },
        });

        const stake = stakeByUser.get(userId) ?? 0;
        const profit = Number((payout - stake).toFixed(2));
        if (profit > 0 && this.affiliateService) {
          try {
            await this.affiliateService.creditFromReferralWin({
              winnerUserId: userId,
              winAmount: profit,
              eventKey: `wheel:${this.round.id}:${userId}`,
              context: {
                game: "wheel",
                roundId: this.round.id,
                color: resultColor,
              },
            });
          } catch {
            // Referral payout failures should not fail resolved game result.
          }
        }
      }

      const baseTurns = Math.floor(this.rotateDeg / 360) * 360;
      const rawAngle = pickAngleForColor(resultColor);
      const calibratedAngle = normalizeWheelAngle(rawAngle);
      this.rotateDeg = Number((baseTurns + WHEEL_SPIN_TURNS_DEG + calibratedAngle).toFixed(1));
      this.historyItems = [{ color: resultColor, hash: this.round.hash }, ...this.historyItems].slice(0, 24);

      this.round.version += 1;
      await this.publish(GAME_EVENTS.WHEEL_SLIDER, {
        roundId: this.round.id,
        hash: this.round.hash,
        resultColor,
        resultAngle: calibratedAngle,
        payouts: Object.fromEntries(payoutByUser),
        rotateDeg: this.rotateDeg,
        history: this.historyItems,
      });

      try {
        await this.historyStore.append("wheel_rounds", {
          roundId: this.round.id,
          hash: this.round.hash,
          resultColor,
          bets: this.round.bets,
          payouts: Object.fromEntries(payoutByUser),
        });
      } catch {
        // History write failure must not block the next round.
      }

      setTimeout(() => {
        this.rotateDeg = Number(normalizeRotationDeg(this.rotateDeg).toFixed(1));
        void this.refreshConfig().catch(() => undefined).finally(() => {
          this.round = this.newRound();
          this.startLoop();
        });
      }, 9500);
    } catch (error) {
      this.resolving = false;
      if (!this.timer) {
        this.round = this.newRound();
        this.startLoop();
      }
      throw error;
    } finally {
      if (gameLock) {
        await this.lockManager.release(gameLock);
      }
    }
  }

  private async acquireLockOrConflict(key: string, message: string, waitMs: number): Promise<LockLease> {
    try {
      return await this.lockManager.acquire(key, { waitMs });
    } catch (error) {
      if (error instanceof AppError && error.code === "LOCK_TIMEOUT") {
        throw new AppError("CONFLICT", message, { retryable: true, cause: error });
      }
      throw error;
    }
  }

  private async publish(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.outbox.append({
      type,
      aggregateType: "wheel",
      aggregateId: this.round.id,
      version: this.round.version,
      payload,
    });
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
          wheel_timer: 1,
          wheel_min_bet: 1,
          wheel_max_bet: 1,
        },
      },
    );

    const timerSec = this.asPositiveInt(settings?.wheel_timer, DEFAULT_WHEEL_CONFIG.timerSec);
    const minBet = this.asPositiveNumber(settings?.wheel_min_bet, DEFAULT_WHEEL_CONFIG.minBet);
    const parsedMaxBet = this.asPositiveNumber(settings?.wheel_max_bet, DEFAULT_WHEEL_CONFIG.maxBet);
    const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;

    this.config = {
      timerSec,
      minBet,
      maxBet,
    };
    this.settingsLoadedAt = now;

    if (!this.resolving && this.round.bets.length === 0 && this.round.countdownSec !== this.config.timerSec) {
      this.round.countdownSec = this.config.timerSec;
      this.round.version += 1;
    }
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

  private asPositiveInt(value: unknown, fallback: number): number {
    const numeric = this.asPositiveNumber(value, fallback);
    return Math.max(1, Math.floor(numeric));
  }
}

export const registerWheelHandlers = (router: WsRouter, wheelService: WheelService): void => {
  router.register("wheel.subscribe", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      ctx.client.subscriptions.add("wheel");
      return { data: await wheelService.subscribe() };
    },
  });

  router.register("wheel.bet", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = wheelBetSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid wheel bet payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      if (!ctx.request.requestId) {
        throw new AppError("VALIDATION_ERROR", "requestId is required");
      }
      const result = await wheelService.bet(
        user.userId,
        user.username,
        ctx.request.requestId,
        parsed.data.amount,
        parsed.data.color,
      );
      return { data: result };
    },
  });
};

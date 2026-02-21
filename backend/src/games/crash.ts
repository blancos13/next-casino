import { randomBytes, randomUUID } from "crypto";
import { z } from "zod";
import type { Db, Document, MongoClient } from "mongodb";
import { AppError } from "../common/errors";
import { moneyToAtomic } from "../common/money";
import type { OutboxService } from "../infra/events/outbox";
import type { MongoLockManager } from "../infra/locks/mongo-lock";
import type { WsRouter } from "../infra/ws/router";
import type { WalletService } from "../wallet/wallet.service";
import { GAME_EVENTS } from "./shared/game-events";
import { GameHistoryService } from "./shared/game-history.service";
import type { AffiliateService } from "../user/affiliate.service";

type CrashBet = {
  userId: string;
  username: string;
  amount: number;
  cashedOut: boolean;
  cashoutMultiplier?: number;
  payout?: number;
};

type CrashRound = {
  id: string;
  hash: string;
  phase: "betting" | "running" | "ended";
  countdownSec: number;
  multiplier: number;
  crashPoint: number;
  startedAt: number;
  graphPoints: number[];
  bets: Map<string, CrashBet>;
  version: number;
};

type CrashHistoryItem = {
  multiplier: number;
  hash: string;
};

const crashBetSchema = z.object({
  amount: z.number().positive().max(100000),
});

const crashCashoutSchema = z.object({
  atMultiplier: z.number().min(1).max(100).optional(),
});

const CRASH_TICK_MS = 50;
const CRASH_GROWTH_PER_TICK = 0.003;
const CRASH_GROWTH_PER_MS = CRASH_GROWTH_PER_TICK / CRASH_TICK_MS;
const CRASH_ROUND_RESTART_MS = 3000;
const SETTINGS_CACHE_TTL_MS = 5_000;
const DEFAULT_CRASH_CONFIG = {
  timerSec: 10,
  minBet: 0.1,
  maxBet: 100,
};

const buildCrashBasePool = (): number[] => {
  const list: number[] = [];
  for (let i = 0; i < 50; i += 1) list.push(1);
  for (let i = 0; i < 25; i += 1) list.push(2);
  for (let i = 0; i < 10; i += 1) list.push(3);
  for (let i = 0; i < 9; i += 1) list.push(4);
  for (let i = 0; i < 3; i += 1) list.push(5);
  for (let i = 0; i < 2; i += 1) list.push(10);
  list.push(100);
  return list;
};

const crashBasePool = buildCrashBasePool();

const randomIntInclusive = (min: number, max: number): number =>
  min + Math.floor(Math.random() * (max - min + 1));

const sampleCrashPoint = (): number => {
  const poolValue = crashBasePool[Math.floor(Math.random() * crashBasePool.length)] ?? 1;
  let base = poolValue;
  if (base > 1) {
    base = randomIntInclusive(1, base);
  }
  if (base <= 1) {
    return Number((1 + randomIntInclusive(0, 9) / 100).toFixed(2));
  }
  const d1 = randomIntInclusive(0, 9);
  const d2 = randomIntInclusive(1, 9);
  const point = Number(`${base}.${d1}${d2}`);
  return Number(Math.min(100, point).toFixed(2));
};

const exactMultiplierByElapsedMs = (elapsedMs: number): number => Math.exp(CRASH_GROWTH_PER_MS * Math.max(0, elapsedMs));
const makeCrashHash = (): string => randomBytes(16).toString("hex");

export class CrashService {
  private round: CrashRound;
  private bettingInterval: NodeJS.Timeout | null = null;
  private runningInterval: NodeJS.Timeout | null = null;
  private runningTick = 0;
  private readonly history: GameHistoryService;
  private historyMultipliers: CrashHistoryItem[] = [];
  private config = { ...DEFAULT_CRASH_CONFIG };
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
    this.round = this.createRound();
    void this.refreshConfig(true).catch(() => undefined);
    this.startBettingLoop();
  }

  async subscribe(): Promise<Record<string, unknown>> {
    return this.snapshot();
  }

  async bet(
    userId: string,
    username: string,
    requestId: string,
    amount: number,
  ): Promise<Record<string, unknown>> {
    await this.refreshConfig();
    if (amount < this.config.minBet) {
      throw new AppError("VALIDATION_ERROR", `Minimum bet amount ${this.config.minBet}$!`);
    }
    if (amount > this.config.maxBet) {
      throw new AppError("VALIDATION_ERROR", `Maximum bet amount ${this.config.maxBet}$!`);
    }

    const gameLock = await this.lockManager.acquire("game:crash");
    const walletLock = await this.lockManager.acquire(`wallet:${userId}`);
    const session = this.mongoClient.startSession();
    try {
      if (this.round.phase !== "betting") {
        throw new AppError("CONFLICT", "Crash round is not accepting bets");
      }
      if (this.round.bets.has(userId)) {
        throw new AppError("CONFLICT", "User already placed crash bet");
      }

      const result = await session.withTransaction(async () => {
        const mutation = await this.walletService.applyMutationInSession(
          {
            userId,
            requestId: `${requestId}:crash:bet`,
            ledgerType: "game_bet",
            deltaMainAtomic: -moneyToAtomic(amount),
            deltaBonusAtomic: 0n,
            metadata: {
              game: "crash",
              roundId: this.round.id,
            },
          },
          session,
        );

        this.round.bets.set(userId, {
          userId,
          username,
          amount,
          cashedOut: false,
        });
        this.bumpVersion();

        await this.outbox.append(
          {
            type: GAME_EVENTS.CRASH_BETS_SNAPSHOT,
            aggregateType: "crash",
            aggregateId: this.round.id,
            version: this.round.version,
            payload: {
              roundId: this.round.id,
              phase: this.round.phase,
              bets: this.serializeBets(),
            },
          },
          session,
        );

        return {
          roundId: this.round.id,
          balance: mutation,
          bets: this.serializeBets(),
        };
      });

      if (!result) {
        throw new AppError("INTERNAL_ERROR", "Crash bet transaction failed");
      }
      return result;
    } finally {
      await session.endSession();
      await this.lockManager.release(walletLock);
      await this.lockManager.release(gameLock);
    }
  }

  async cashout(userId: string, requestId: string, requestedMultiplier?: number): Promise<Record<string, unknown>> {
    const gameLock = await this.lockManager.acquire("game:crash");
    const walletLock = await this.lockManager.acquire(`wallet:${userId}`);
    const session = this.mongoClient.startSession();
    try {
      if (this.round.phase !== "running") {
        throw new AppError("CONFLICT", "Crash is not running");
      }
      const bet = this.round.bets.get(userId);
      if (!bet) {
        throw new AppError("NOT_FOUND", "Bet not found");
      }
      if (bet.cashedOut) {
        throw new AppError("CONFLICT", "Bet already cashed out");
      }

      const multiplier = requestedMultiplier
        ? Math.min(Math.max(requestedMultiplier, 1), this.round.multiplier)
        : this.round.multiplier;
      const payout = Number((bet.amount * multiplier).toFixed(2));
      const profit = Number((payout - bet.amount).toFixed(2));

      const result = await session.withTransaction(async () => {
        const mutation = await this.walletService.applyMutationInSession(
          {
            userId,
            requestId: `${requestId}:crash:cashout`,
            ledgerType: "game_payout",
            deltaMainAtomic: moneyToAtomic(payout),
            deltaBonusAtomic: 0n,
            metadata: {
              game: "crash",
              roundId: this.round.id,
              multiplier,
            },
          },
          session,
        );

        bet.cashedOut = true;
        bet.cashoutMultiplier = multiplier;
        bet.payout = payout;
        this.bumpVersion();

        await this.outbox.append(
          {
            type: GAME_EVENTS.CRASH_BETS_SNAPSHOT,
            aggregateType: "crash",
            aggregateId: this.round.id,
            version: this.round.version,
            payload: {
              roundId: this.round.id,
              phase: this.round.phase,
              bets: this.serializeBets(),
            },
          },
          session,
        );

        return {
          roundId: this.round.id,
          payout,
          multiplier,
          balance: mutation,
        };
      });

      if (!result) {
        throw new AppError("INTERNAL_ERROR", "Crash cashout transaction failed");
      }

      if (profit > 0 && this.affiliateService) {
        try {
          await this.affiliateService.creditFromReferralWin({
            winnerUserId: userId,
            winAmount: profit,
            eventKey: `crash:${this.round.id}:${userId}`,
            context: {
              game: "crash",
              roundId: this.round.id,
              multiplier,
            },
          });
        } catch {
          // Referral payout failures should not fail resolved game result.
        }
      }

      return result;
    } finally {
      await session.endSession();
      await this.lockManager.release(walletLock);
      await this.lockManager.release(gameLock);
    }
  }

  snapshot(): Record<string, unknown> {
    const elapsedMs =
      this.round.phase === "running" || this.round.phase === "ended"
        ? Math.max(0, Date.now() - this.round.startedAt)
        : 0;
    return {
      roundId: this.round.id,
      hash: this.round.hash,
      phase: this.round.phase,
      countdownSec: this.round.countdownSec,
      multiplier: this.round.multiplier,
      crashPoint: this.round.phase === "ended" ? this.round.crashPoint : undefined,
      startedAt: this.round.startedAt,
      elapsedMs,
      version: this.round.version,
      bets: this.serializeBets(),
      history: this.historyMultipliers,
      graphPoints: this.round.graphPoints,
      minBet: this.config.minBet,
      maxBet: this.config.maxBet,
    };
  }

  private createRound(): CrashRound {
    return {
      id: randomUUID(),
      hash: makeCrashHash(),
      phase: "betting",
      countdownSec: this.config.timerSec,
      multiplier: 1,
      crashPoint: sampleCrashPoint(),
      startedAt: Date.now(),
      graphPoints: [1],
      bets: new Map(),
      version: 1,
    };
  }

  private startBettingLoop(): void {
    this.publish({
      type: GAME_EVENTS.CRASH_RESET,
      payload: this.snapshot(),
    }).catch(() => undefined);

    this.bettingInterval = setInterval(() => {
      this.round.countdownSec -= 1;
      this.bumpVersion();

      this.publish({
        type: GAME_EVENTS.CRASH_TIMER,
        payload: {
          roundId: this.round.id,
          hash: this.round.hash,
          countdownSec: this.round.countdownSec,
          phase: this.round.phase,
        },
      }).catch(() => undefined);

      if (this.round.countdownSec <= 0) {
        this.beginRunning();
      }
    }, 1000);
  }

  private beginRunning(): void {
    if (this.bettingInterval) {
      clearInterval(this.bettingInterval);
      this.bettingInterval = null;
    }
    this.round.phase = "running";
    this.round.startedAt = Date.now();
    this.round.graphPoints = [1];
    this.runningTick = 0;
    this.bumpVersion();

    this.runningInterval = setInterval(() => {
      this.runningTick += 1;
      const elapsedMs = Math.max(0, Date.now() - this.round.startedAt);
      const exactMultiplier = exactMultiplierByElapsedMs(elapsedMs);
      this.round.multiplier = Number(exactMultiplier.toFixed(2));
      this.pushGraphPoint(exactMultiplier);
      this.bumpVersion();

      this.publish({
        type: GAME_EVENTS.CRASH_TICK,
        payload: {
          roundId: this.round.id,
          hash: this.round.hash,
          multiplier: this.round.multiplier,
          phase: this.round.phase,
          startedAt: this.round.startedAt,
          elapsedMs,
          graphPoints: this.round.graphPoints,
        },
      }).catch(() => undefined);

      if (this.round.multiplier >= this.round.crashPoint) {
        this.finishRound().catch(() => undefined);
      }
    }, CRASH_TICK_MS);
  }

  private async finishRound(): Promise<void> {
    if (this.runningInterval) {
      clearInterval(this.runningInterval);
      this.runningInterval = null;
    }
    this.round.phase = "ended";
    this.round.multiplier = this.round.crashPoint;
    this.pushGraphPoint(this.round.crashPoint);
    this.bumpVersion();

    await this.history.append("crash_rounds", {
      roundId: this.round.id,
      hash: this.round.hash,
      crashPoint: this.round.crashPoint,
      bets: this.serializeBets(),
    });
    this.historyMultipliers = [
      {
        multiplier: this.round.crashPoint,
        hash: this.round.hash,
      },
      ...this.historyMultipliers,
    ].slice(0, 24);

    await this.publish({
      type: GAME_EVENTS.CRASH_TICK,
      payload: {
        roundId: this.round.id,
        hash: this.round.hash,
        multiplier: this.round.crashPoint,
        phase: this.round.phase,
        startedAt: this.round.startedAt,
        elapsedMs: Math.max(0, Date.now() - this.round.startedAt),
        graphPoints: this.round.graphPoints,
      },
    });

    setTimeout(() => {
      void this.refreshConfig().catch(() => undefined).finally(() => {
        this.round = this.createRound();
        this.startBettingLoop();
      });
    }, CRASH_ROUND_RESTART_MS);
  }

  private serializeBets(): CrashBet[] {
    return [...this.round.bets.values()].map((item) => ({ ...item }));
  }

  private pushGraphPoint(value: number): void {
    if (!Number.isFinite(value) || value <= 0) {
      return;
    }
    this.round.graphPoints = [...this.round.graphPoints, Number(value.toFixed(4))].slice(-2500);
  }

  private bumpVersion(): void {
    this.round.version += 1;
  }

  private async publish(input: { type: string; payload: Record<string, unknown> }): Promise<void> {
    await this.outbox.append({
      type: input.type,
      aggregateType: "crash",
      aggregateId: this.round.id,
      version: this.round.version,
      payload: input.payload,
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
          crash_timer: 1,
          crash_min_bet: 1,
          crash_max_bet: 1,
        },
      },
    );

    const timerSec = this.asPositiveInt(settings?.crash_timer, DEFAULT_CRASH_CONFIG.timerSec);
    const minBet = this.asPositiveNumber(settings?.crash_min_bet, DEFAULT_CRASH_CONFIG.minBet);
    const parsedMaxBet = this.asPositiveNumber(settings?.crash_max_bet, DEFAULT_CRASH_CONFIG.maxBet);
    const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;

    this.config = {
      timerSec,
      minBet,
      maxBet,
    };
    this.settingsLoadedAt = now;

    if (this.round.phase === "betting" && this.round.bets.size === 0 && this.round.countdownSec !== this.config.timerSec) {
      this.round.countdownSec = this.config.timerSec;
      this.bumpVersion();
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

export const registerCrashHandlers = (router: WsRouter, crashService: CrashService): void => {
  router.register("crash.subscribe", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      ctx.client.subscriptions.add("crash");
      return { data: await crashService.subscribe() };
    },
  });

  router.register("crash.bet", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = crashBetSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid crash bet payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      if (!ctx.request.requestId) {
        throw new AppError("VALIDATION_ERROR", "requestId is required");
      }
      const result = await crashService.bet(user.userId, user.username, ctx.request.requestId, parsed.data.amount);
      return { data: result };
    },
  });

  router.register("crash.cashout", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = crashCashoutSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid crash cashout payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      if (!ctx.request.requestId) {
        throw new AppError("VALIDATION_ERROR", "requestId is required");
      }
      const result = await crashService.cashout(user.userId, ctx.request.requestId, parsed.data.atMultiplier);
      return { data: result };
    },
  });
};

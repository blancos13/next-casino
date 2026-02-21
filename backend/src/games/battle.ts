import { randomBytes, randomUUID } from "crypto";
import { ObjectId, type Db, type Document } from "mongodb";
import { z } from "zod";
import { AppError, isAppError } from "../common/errors";
import { moneyToAtomic } from "../common/money";
import type { OutboxService } from "../infra/events/outbox";
import type { LockLease, MongoLockManager } from "../infra/locks/mongo-lock";
import type { WsRouter } from "../infra/ws/router";
import { usersCollection } from "../user/user.model";
import type { WalletService } from "../wallet/wallet.service";
import { GAME_EVENTS } from "./shared/game-events";
import { GameHistoryService } from "./shared/game-history.service";
import type { AffiliateService } from "../user/affiliate.service";

type BattleTeam = "red" | "blue";
type BattleBalance = "balance" | "bonus";
type BattleStatus = "waiting" | "countdown" | "spinning";

type BattleBet = {
  userId: string;
  username: string;
  avatar: string;
  amount: number;
  team: BattleTeam;
  balance: BattleBalance;
};

type BattleHistoryItem = {
  color: BattleTeam;
  hash: string;
};

type BattleRound = {
  roundId: string;
  gameId: number;
  hash: string;
  status: BattleStatus;
  countdownSec: number;
  bets: BattleBet[];
  winnerTeam: BattleTeam | null;
  winnerTicket: number | null;
  version: number;
};

type BattleStats = {
  bank: [number, number];
  chances: [number, number];
  factor: [number, number];
  tickets: [number, number];
  count: [number, number];
};

const DEFAULT_AVATAR = "/img/no_avatar.jpg";
const BATTLE_MAX_BETS_PER_USER = 3;
const BATTLE_HISTORY_LIMIT = 15;
const BATTLE_NEXT_ROUND_DELAY_MS = 5_200;
const GAME_LOCK_WAIT_MS = 12_000;
const RESOLVE_LOCK_WAIT_MS = 15_000;
const BATTLE_SPIN_MS = 4_000;
const SETTINGS_CACHE_TTL_MS = 5_000;
const DEFAULT_BATTLE_CONFIG = {
  minBet: 0.1,
  maxBet: 100,
  timerSec: 20,
  commissionPct: 3,
};

const battleBetSchema = z.object({
  amount: z.number().positive().max(100000),
  team: z.enum(["red", "blue"]),
  balance: z.enum(["balance", "bonus"]).optional(),
});

const asTwoDecimals = (value: number): number => Number(value.toFixed(2));

const makeHash = (): string => randomBytes(16).toString("hex");

const randomTicket = (): number => Math.floor(Math.random() * 1000) + 1;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class BattleService {
  private round: BattleRound;
  private countdownTimer: NodeJS.Timeout | null = null;
  private nextRoundTimer: NodeJS.Timeout | null = null;
  private readonly historyStore: GameHistoryService;
  private history: BattleHistoryItem[] = [];
  private rotateDeg = 0;
  private resolving = false;
  private config = { ...DEFAULT_BATTLE_CONFIG };
  private settingsLoadedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly lockManager: MongoLockManager,
    private readonly walletService: WalletService,
    private readonly outbox: OutboxService,
    private readonly affiliateService?: AffiliateService,
  ) {
    this.historyStore = new GameHistoryService(db);
    this.round = this.createRound(1);
    void this.refreshConfig(true).catch(() => undefined);
  }

  async subscribe(): Promise<Record<string, unknown>> {
    return this.snapshot();
  }

  async bet(
    userId: string,
    username: string,
    requestId: string,
    amount: number,
    team: BattleTeam,
    balance: BattleBalance,
  ): Promise<Record<string, unknown>> {
    await this.refreshConfig();
    if (this.resolving || this.round.status === "spinning") {
      throw new AppError("CONFLICT", "The game has already started or ended!");
    }
    if (amount < this.config.minBet) {
      throw new AppError("VALIDATION_ERROR", `Minimum bet amount ${this.config.minBet}$!`);
    }
    if (amount > this.config.maxBet) {
      throw new AppError("VALIDATION_ERROR", `Maximum bet amount ${this.config.maxBet}$!`);
    }

    const gameLock = await this.acquireLockOrConflict("game:battle", "Battle is busy", GAME_LOCK_WAIT_MS);
    try {
      if (this.resolving || this.round.status === "spinning") {
        throw new AppError("CONFLICT", "The game has already started or ended!");
      }

      const userBets = this.round.bets.filter((bet) => bet.userId === userId);
      if (userBets.length >= BATTLE_MAX_BETS_PER_USER) {
        throw new AppError("CONFLICT", "Only 3 bets allowed!");
      }

      const firstUserBet = userBets[0];
      if (firstUserBet && firstUserBet.balance !== balance) {
        throw new AppError(
          "CONFLICT",
          `You have already placed a bet with ${balance === "balance" ? "bonus" : "money"} score!`,
        );
      }
      if (firstUserBet && firstUserBet.team !== team) {
        throw new AppError("CONFLICT", "You have already bet on a different color!");
      }

      let walletMutation: Awaited<ReturnType<WalletService["applyMutation"]>>;
      try {
        walletMutation = await this.walletService.applyMutation({
          userId,
          requestId: `${requestId}:battle:bet`,
          ledgerType: "game_bet",
          deltaMainAtomic: balance === "balance" ? -moneyToAtomic(amount) : 0n,
          deltaBonusAtomic: balance === "bonus" ? -moneyToAtomic(amount) : 0n,
          metadata: {
            game: "battle",
            roundId: this.round.roundId,
            team,
            balance,
          },
        });
      } catch (error) {
        if (isAppError(error) && error.code === "INSUFFICIENT_BALANCE") {
          throw new AppError("CONFLICT", "Not enough balance!");
        }
        throw error;
      }

      const avatar = await this.resolveAvatar(userId);
      this.round.bets.push({
        userId,
        username,
        avatar,
        amount: asTwoDecimals(amount),
        team,
        balance,
      });

      if (this.round.status === "waiting" && this.hasBothTeams()) {
        this.round.status = "countdown";
        this.round.countdownSec = this.config.timerSec;
      }

      this.bumpVersion();
      await this.publish(GAME_EVENTS.BATTLE_NEW_BET, this.snapshot());

      if (this.round.status === "countdown") {
        this.ensureCountdownLoop();
      }

      return {
        roundId: this.round.roundId,
        balance: walletMutation,
      };
    } finally {
      await this.lockManager.release(gameLock);
    }
  }

  snapshot(): Record<string, unknown> {
    const stats = this.computeStats();
    return {
      roundId: this.round.roundId,
      gameId: this.round.gameId,
      hash: this.round.hash,
      status: this.round.status,
      countdownSec: this.round.countdownSec,
      minBet: this.config.minBet,
      maxBet: this.config.maxBet,
      bets: this.serializeBetRows(),
      bank: stats.bank,
      chances: stats.chances,
      factor: stats.factor,
      tickets: stats.tickets,
      count: stats.count,
      rotateDeg: this.rotateDeg,
      history: this.history,
    };
  }

  private createRound(gameId: number): BattleRound {
    return {
      roundId: randomUUID(),
      gameId,
      hash: makeHash(),
      status: "waiting",
      countdownSec: this.config.timerSec,
      bets: [],
      winnerTeam: null,
      winnerTicket: null,
      version: 1,
    };
  }

  private computeStats(): BattleStats {
    const redBank = asTwoDecimals(this.round.bets.filter((bet) => bet.team === "red").reduce((sum, bet) => sum + bet.amount, 0));
    const blueBank = asTwoDecimals(this.round.bets.filter((bet) => bet.team === "blue").reduce((sum, bet) => sum + bet.amount, 0));
    const totalBank = redBank + blueBank;

    const redChanceExact = totalBank > 0 ? (redBank / totalBank) * 100 : 50;
    const blueChanceExact = totalBank > 0 ? (blueBank / totalBank) * 100 : 50;

    const redChance = Math.floor(redChanceExact);
    const blueChance = Math.round(blueChanceExact);

    const redFactor = redBank >= 0.01 && totalBank > 0 ? asTwoDecimals(totalBank / redBank) : 2;
    const blueFactor = blueBank >= 0.01 && totalBank > 0 ? asTwoDecimals(totalBank / blueBank) : 2;

    let redTicketEnd = Math.round(redChanceExact * 10);
    if (redTicketEnd < 1) {
      redTicketEnd = 1;
    } else if (redTicketEnd > 999) {
      redTicketEnd = 999;
    }
    const blueTicketStart = redTicketEnd + 1;

    const redUsers = new Set(this.round.bets.filter((bet) => bet.team === "red").map((bet) => bet.userId));
    const blueUsers = new Set(this.round.bets.filter((bet) => bet.team === "blue").map((bet) => bet.userId));

    return {
      bank: [redBank, blueBank],
      chances: [redChance, blueChance],
      factor: [redFactor, blueFactor],
      tickets: [redTicketEnd, blueTicketStart],
      count: [redUsers.size, blueUsers.size],
    };
  }

  private hasBothTeams(): boolean {
    const stats = this.computeStats();
    return stats.count[0] >= 1 && stats.count[1] >= 1;
  }

  private serializeBetRows(): Array<Record<string, unknown>> {
    const grouped = new Map<
      string,
      {
        userId: string;
        uniqueId: string;
        username: string;
        avatar: string;
        color: BattleTeam;
        balType: BattleBalance;
        price: number;
      }
    >();

    for (const bet of this.round.bets) {
      const key = `${bet.userId}:${bet.team}:${bet.balance}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.price = asTwoDecimals(existing.price + bet.amount);
        continue;
      }
      grouped.set(key, {
        userId: bet.userId,
        uniqueId: bet.userId,
        username: bet.username,
        avatar: bet.avatar || DEFAULT_AVATAR,
        color: bet.team,
        balType: bet.balance,
        price: asTwoDecimals(bet.amount),
      });
    }

    return [...grouped.values()]
      .sort((a, b) => b.price - a.price)
      .map((item) => ({
        user_id: item.userId,
        unique_id: item.uniqueId,
        username: item.username,
        avatar: item.avatar,
        color: item.color,
        balType: item.balType,
        price: item.price,
      }));
  }

  private ensureCountdownLoop(): void {
    if (this.countdownTimer) {
      return;
    }

    this.countdownTimer = setInterval(() => {
      if (this.round.status !== "countdown") {
        this.stopCountdownLoop();
        return;
      }

      if (this.round.countdownSec > 0) {
        this.round.countdownSec -= 1;
        this.bumpVersion();
        const min = Math.floor(this.round.countdownSec / 60);
        const sec = this.round.countdownSec - min * 60;
        this.publish(GAME_EVENTS.BATTLE_TIMER, {
          roundId: this.round.roundId,
          countdownSec: this.round.countdownSec,
          min,
          sec,
        }).catch(() => undefined);
      }

      if (this.round.countdownSec <= 0) {
        this.stopCountdownLoop();
        if (!this.resolving) {
          this.resolveRound().catch(() => undefined);
        }
      }
    }, 1000);
  }

  private stopCountdownLoop(): void {
    if (!this.countdownTimer) {
      return;
    }
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  private async resolveRound(): Promise<void> {
    if (this.resolving) {
      return;
    }

    let gameLock: LockLease | null = null;
    try {
      gameLock = await this.acquireLockOrConflict("game:battle", "Battle is busy", RESOLVE_LOCK_WAIT_MS);
      if (this.round.status !== "countdown" || this.round.countdownSec > 0) {
        return;
      }

      this.resolving = true;
      this.round.status = "spinning";
      this.bumpVersion();

      const stats = this.computeStats();
      const winnerTicket = randomTicket();
      const winnerTeam: BattleTeam = winnerTicket <= stats.tickets[0] ? "red" : "blue";
      const winnerFactor = winnerTeam === "red" ? stats.factor[0] : stats.factor[1];

      const groupedStakes = new Map<string, { userId: string; balance: BattleBalance; amount: number }>();
      for (const bet of this.round.bets) {
        if (bet.team !== winnerTeam) {
          continue;
        }
        const key = `${bet.userId}:${bet.balance}`;
        const existing = groupedStakes.get(key);
        if (existing) {
          existing.amount = asTwoDecimals(existing.amount + bet.amount);
        } else {
          groupedStakes.set(key, {
            userId: bet.userId,
            balance: bet.balance,
            amount: asTwoDecimals(bet.amount),
          });
        }
      }
      const winnerStakes = [...groupedStakes.values()];

      this.round.winnerTeam = winnerTeam;
      this.round.winnerTicket = winnerTicket;
      this.history = [{ color: winnerTeam, hash: this.round.hash }, ...this.history].slice(0, BATTLE_HISTORY_LIMIT);
      this.rotateDeg = asTwoDecimals(3600 + winnerTicket * 0.36);
      this.bumpVersion();

      await this.publish(GAME_EVENTS.BATTLE_SLIDER, {
        roundId: this.round.roundId,
        ticket: winnerTicket,
        winnerTeam,
        rotateDeg: this.rotateDeg,
        game: {
          id: this.round.gameId,
          hash: this.round.hash,
          winner_team: winnerTeam,
        },
      });

      try {
        await this.historyStore.append("battle_rounds", {
          roundId: this.round.roundId,
          gameId: this.round.gameId,
          winnerTeam,
          winnerTicket,
          hash: this.round.hash,
          bets: this.serializeBetRows(),
        });
      } catch {
        // History write failures should not stop round transitions.
      }

      if (this.nextRoundTimer) {
        clearTimeout(this.nextRoundTimer);
        this.nextRoundTimer = null;
      }

      const nextGameId = this.round.gameId + 1;
      this.nextRoundTimer = setTimeout(() => {
        this.nextRoundTimer = null;
        this.finalizeRoundAfterSpin(nextGameId, winnerTeam, winnerFactor, winnerStakes).catch(() => {
          this.rotateDeg = 0;
          this.round = this.createRound(nextGameId);
          this.resolving = false;
          this.publish(GAME_EVENTS.BATTLE_NEW_ROUND, this.snapshot()).catch(() => undefined);
        });
      }, BATTLE_SPIN_MS);
    } catch (error) {
      this.resolving = false;
      throw error;
    } finally {
      if (gameLock) {
        await this.lockManager.release(gameLock);
      }
    }
  }

  private calculatePayout(amount: number, factor: number): number {
    const grossWin = amount * factor;
    const profit = Math.max(0, grossWin - amount);
    const commission = profit * (this.config.commissionPct / 100);
    return asTwoDecimals(amount + profit - commission);
  }

  private async applyWinnerPayouts(
    winnerTeam: BattleTeam,
    winnerFactor: number,
    winnerStakes: Array<{ userId: string; balance: BattleBalance; amount: number }>,
  ): Promise<void> {
    for (const winnerBet of winnerStakes) {
      const payout = this.calculatePayout(winnerBet.amount, winnerFactor);
      if (payout <= 0) {
        continue;
      }
      try {
        await this.walletService.applyMutation({
          userId: winnerBet.userId,
          requestId: `battle:${this.round.roundId}:${winnerBet.userId}:${winnerBet.balance}`,
          ledgerType: "game_payout",
          deltaMainAtomic: winnerBet.balance === "balance" ? moneyToAtomic(payout) : 0n,
          deltaBonusAtomic: winnerBet.balance === "bonus" ? moneyToAtomic(payout) : 0n,
          metadata: {
            game: "battle",
            roundId: this.round.roundId,
            winnerTeam,
            payout,
            balance: winnerBet.balance,
          },
        });

        const winnerProfit = asTwoDecimals(payout - winnerBet.amount);
        if (winnerProfit > 0 && this.affiliateService) {
          try {
            await this.affiliateService.creditFromReferralWin({
              winnerUserId: winnerBet.userId,
              winAmount: winnerProfit,
              eventKey: `battle:${this.round.roundId}:${winnerBet.userId}:${winnerBet.balance}`,
              context: {
                game: "battle",
                roundId: this.round.roundId,
                winnerTeam,
                balance: winnerBet.balance,
              },
            });
          } catch {
            // Referral payout failures should not fail resolved game result.
          }
        }
      } catch {
        // One user payout failure must not block others.
      }
    }
  }

  private async finalizeRoundAfterSpin(
    nextGameId: number,
    winnerTeam: BattleTeam,
    winnerFactor: number,
    winnerStakes: Array<{ userId: string; balance: BattleBalance; amount: number }>,
  ): Promise<void> {
    await this.refreshConfig();
    await this.applyWinnerPayouts(winnerTeam, winnerFactor, winnerStakes);
    const delayAfterPayout = Math.max(0, BATTLE_NEXT_ROUND_DELAY_MS - BATTLE_SPIN_MS);
    if (delayAfterPayout > 0) {
      await sleep(delayAfterPayout);
    }
    this.rotateDeg = 0;
    this.round = this.createRound(nextGameId);
    this.resolving = false;
    await this.publish(GAME_EVENTS.BATTLE_NEW_ROUND, this.snapshot());
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
          battle_min_bet: 1,
          battle_max_bet: 1,
          battle_timer: 1,
          battle_commission: 1,
        },
      },
    );

    const minBet = this.asPositiveNumber(settings?.battle_min_bet, DEFAULT_BATTLE_CONFIG.minBet);
    const parsedMaxBet = this.asPositiveNumber(settings?.battle_max_bet, DEFAULT_BATTLE_CONFIG.maxBet);
    const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;
    const timerSec = this.asPositiveInt(settings?.battle_timer, DEFAULT_BATTLE_CONFIG.timerSec);
    const commissionPct = this.asPercent(settings?.battle_commission, DEFAULT_BATTLE_CONFIG.commissionPct);

    this.config = {
      minBet,
      maxBet,
      timerSec,
      commissionPct,
    };
    this.settingsLoadedAt = now;

    if (this.round.status === "waiting" && this.round.bets.length === 0) {
      this.round.countdownSec = this.config.timerSec;
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

  private async resolveAvatar(userId: string): Promise<string> {
    let objectId: ObjectId;
    try {
      objectId = new ObjectId(userId);
    } catch {
      return DEFAULT_AVATAR;
    }

    const user = (await usersCollection(this.db).findOne(
      { _id: objectId },
      { projection: { avatar: 1 } },
    )) as { avatar?: unknown } | null;
    const avatar = typeof user?.avatar === "string" ? user.avatar.trim() : "";
    return avatar || DEFAULT_AVATAR;
  }

  private bumpVersion(): void {
    this.round.version += 1;
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
      aggregateType: "battle",
      aggregateId: this.round.roundId,
      version: this.round.version,
      payload,
    });
  }
}

export const registerBattleHandlers = (router: WsRouter, battleService: BattleService): void => {
  router.register("battle.subscribe", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      ctx.client.subscriptions.add("battle");
      return { data: await battleService.subscribe() };
    },
  });

  router.register("battle.bet", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = battleBetSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid battle bet payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      if (!ctx.request.requestId) {
        throw new AppError("VALIDATION_ERROR", "requestId is required");
      }

      const result = await battleService.bet(
        user.userId,
        user.username,
        ctx.request.requestId,
        parsed.data.amount,
        parsed.data.team,
        parsed.data.balance ?? "balance",
      );
      return { data: result };
    },
  });
};

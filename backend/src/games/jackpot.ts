import { randomBytes, randomUUID } from "crypto";
import { ObjectId, type ClientSession, type Db, type Document, type MongoClient } from "mongodb";
import { z } from "zod";
import { AppError } from "../common/errors";
import { moneyToAtomic } from "../common/money";
import type { OutboxService } from "../infra/events/outbox";
import type { LockLease, MongoLockManager } from "../infra/locks/mongo-lock";
import type { WsRouter } from "../infra/ws/router";
import { usersCollection } from "../user/user.model";
import type { WalletService } from "../wallet/wallet.service";
import { GAME_EVENTS } from "./shared/game-events";
import { GameHistoryService } from "./shared/game-history.service";
import type { AffiliateService } from "../user/affiliate.service";

type JackpotRoom = "easy" | "medium" | "hard";

type JackpotBetBalance = "balance";

type JackpotBet = {
  userId: string;
  username: string;
  avatar: string;
  amount: number;
  color: string;
  balance: JackpotBetBalance;
};

type JackpotRoundStatus = "open" | "countdown" | "spinning";

type JackpotRound = {
  id: string;
  gameNo: number;
  hash: string;
  room: JackpotRoom;
  countdownSec: number;
  timerStarted: boolean;
  status: JackpotRoundStatus;
  bets: JackpotBet[];
  version: number;
};

type JackpotRoomConfig = {
  timeSec: number;
  minBet: number;
  maxBet: number;
  maxBetsPerUser: number;
};

type JackpotHistoryRow = {
  gameId: number;
  winnerId: string;
  winnerName: string;
  winnerAvatar: string;
  winnerChance: number;
  winnerTicket: number;
  winnerBalance: number;
  winnerBonus: number;
  hash: string;
};

type JackpotPendingPayout = {
  userId: string;
  requestId: string;
  amountMain: number;
  profitMain: number;
  metadata: Record<string, unknown>;
};

type JackpotRoundState = {
  pot: number;
  totalTickets: number;
  bets: Array<{
    user: {
      id: string;
      userId: string;
      username: string;
      avatar: string;
    };
    bet: {
      amount: number;
      color: string;
      balance: JackpotBetBalance;
      chance: number;
      from: number;
      to: number;
    };
  }>;
  chances: Array<{
    user: {
      id: string;
      userId: string;
      username: string;
      avatar: string;
    };
    color: string;
    sum: number;
    chance: number;
    circle: {
      start: number;
      end: number;
    };
  }>;
};

type JackpotRoomRuntime = {
  round: JackpotRound;
  timer: NodeJS.Timeout | null;
  resolving: boolean;
  spinDeg: number;
  spinStartedAt: number | null;
  spinDurationMs: number;
  nextGameNo: number;
  history: JackpotHistoryRow[];
  pendingHistory: JackpotHistoryRow | null;
  pendingPayouts: JackpotPendingPayout[];
  payoutTimer: NodeJS.Timeout | null;
};

const jackpotRooms = ["easy", "medium", "hard"] as const;

const DEFAULT_JACKPOT_ROOM_CONFIGS: Record<JackpotRoom, JackpotRoomConfig> = {
  easy: {
    timeSec: 20,
    minBet: 0.1,
    maxBet: 100,
    maxBetsPerUser: 3,
  },
  medium: {
    timeSec: 20,
    minBet: 0.1,
    maxBet: 100,
    maxBetsPerUser: 3,
  },
  hard: {
    timeSec: 20,
    minBet: 0.1,
    maxBet: 100,
    maxBetsPerUser: 3,
  },
};

const cloneDefaultRoomConfigs = (): Record<JackpotRoom, JackpotRoomConfig> => ({
  easy: { ...DEFAULT_JACKPOT_ROOM_CONFIGS.easy },
  medium: { ...DEFAULT_JACKPOT_ROOM_CONFIGS.medium },
  hard: { ...DEFAULT_JACKPOT_ROOM_CONFIGS.hard },
});

const jackpotBetSchema = z.object({
  amount: z.number().positive().max(100000),
  room: z.enum(jackpotRooms),
});

const jackpotSubscribeSchema = z.object({
  room: z.enum(jackpotRooms),
});

const jackpotColors = ["4986f5", "e86376", "62ca5b", "ffc645", "ff4ba1", "8a96ab"] as const;

const GAME_LOCK_WAIT_MS = 12_000;
const RESOLVE_LOCK_WAIT_MS = 15_000;
const SPIN_RESET_DELAY_MS = 8_200;
const WINNER_PAYOUT_DELAY_MS = 6_200;
const PAYOUT_RETRY_DELAY_MS = 1_000;
const SETTINGS_CACHE_TTL_MS = 5_000;
const DEFAULT_JACKPOT_COMMISSION_PCT = 4;
const DEFAULT_AVATAR = "/img/no_avatar.jpg";

const randomJackpotColor = (): string => {
  const index = Math.floor(Math.random() * jackpotColors.length);
  return jackpotColors[index] ?? jackpotColors[0];
};

const randomRoundHash = (): string => randomBytes(16).toString("hex");

const toFixedNumber = (value: number, digits = 2): number => Number(value.toFixed(digits));

export class JackpotService {
  private readonly historyStore: GameHistoryService;
  private readonly rooms = new Map<JackpotRoom, JackpotRoomRuntime>();
  private roomConfigs: Record<JackpotRoom, JackpotRoomConfig> = cloneDefaultRoomConfigs();
  private jackpotCommissionPct = DEFAULT_JACKPOT_COMMISSION_PCT;
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
    for (const room of jackpotRooms) {
      this.rooms.set(room, {
        round: this.newRound(room, 1),
        timer: null,
        resolving: false,
        spinDeg: 0,
        spinStartedAt: null,
        spinDurationMs: 0,
        nextGameNo: 2,
        history: [],
        pendingHistory: null,
        pendingPayouts: [],
        payoutTimer: null,
      });
      this.startLoop(room);
    }
    void this.refreshConfig(true).catch(() => undefined);
  }

  async subscribe(room: JackpotRoom): Promise<Record<string, unknown>> {
    await this.refreshConfig();
    return this.snapshot(room);
  }

  async bet(
    userId: string,
    fallbackUsername: string,
    requestId: string,
    amount: number,
    room: JackpotRoom,
  ): Promise<Record<string, unknown>> {
    await this.refreshConfig();
    const runtime = this.getRuntime(room);
    const config = this.roomConfigs[room];

    if (runtime.round.status === "spinning" || runtime.resolving) {
      throw new AppError("CONFLICT", "Jackpot round is resolving", { retryable: true });
    }
    if (runtime.round.timerStarted && runtime.round.countdownSec <= 0) {
      throw new AppError("CONFLICT", "Bets in this round are closed", { retryable: true });
    }
    if (amount < config.minBet) {
      throw new AppError("VALIDATION_ERROR", `Minimum bet amount ${config.minBet}`);
    }

    let gameLock: LockLease | null = null;
    let walletLock: LockLease | null = null;
    const session = this.mongoClient.startSession();
    try {
      gameLock = await this.acquireLockOrConflict(`game:jackpot:${room}`, "Jackpot is busy", GAME_LOCK_WAIT_MS);
      walletLock = await this.acquireLockOrConflict(`wallet:${userId}`, "Wallet is busy", GAME_LOCK_WAIT_MS);

      if (runtime.round.status === "spinning" || runtime.resolving) {
        throw new AppError("CONFLICT", "Jackpot round is resolving", { retryable: true });
      }
      if (runtime.round.timerStarted && runtime.round.countdownSec <= 0) {
        throw new AppError("CONFLICT", "Bets in this round are closed", { retryable: true });
      }

      const currentUserBets = runtime.round.bets.filter((bet) => bet.userId === userId);
      if (currentUserBets.length >= config.maxBetsPerUser) {
        throw new AppError("CONFLICT", `Only ${config.maxBetsPerUser} bets allowed per round`);
      }
      const currentUserAmount = currentUserBets.reduce((sum, bet) => sum + bet.amount, 0);
      if (currentUserAmount + amount > config.maxBet) {
        throw new AppError("VALIDATION_ERROR", `Maximum bet amount ${config.maxBet}`);
      }

      const txResult = await session.withTransaction(async () => {
        const userMeta = await this.resolveUserMeta(userId, fallbackUsername, session);
        const existingColor = runtime.round.bets.find((bet) => bet.userId === userId)?.color;

        const balance = await this.walletService.applyMutationInSession(
          {
            userId,
            requestId: `${requestId}:jackpot:bet`,
            ledgerType: "game_bet",
            deltaMainAtomic: -moneyToAtomic(amount),
            deltaBonusAtomic: 0n,
            metadata: {
              game: "jackpot",
              room,
              roundId: runtime.round.id,
              gameId: runtime.round.gameNo,
            },
          },
          session,
        );

        runtime.round.bets.push({
          userId,
          username: userMeta.username,
          avatar: userMeta.avatar,
          amount: toFixedNumber(amount),
          color: existingColor ?? randomJackpotColor(),
          balance: "balance",
        });

        if (!runtime.round.timerStarted && this.uniqueUsers(runtime.round.bets) >= 2) {
          runtime.round.timerStarted = true;
          runtime.round.status = "countdown";
          runtime.round.countdownSec = config.timeSec;
        }

        runtime.round.version += 1;
        const snapshot = this.snapshot(room);

        await this.outbox.append(
          {
            type: GAME_EVENTS.JACKPOT_UPDATE,
            aggregateType: "jackpot",
            aggregateId: `${room}:${runtime.round.id}`,
            version: runtime.round.version,
            payload: snapshot,
          },
          session,
        );

        return {
          room,
          roundId: runtime.round.id,
          gameId: runtime.round.gameNo,
          hash: runtime.round.hash,
          balance,
          data: snapshot,
        };
      });

      if (!txResult) {
        throw new AppError("INTERNAL_ERROR", "Jackpot bet failed");
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

  snapshot(room: JackpotRoom): Record<string, unknown> {
    const runtime = this.getRuntime(room);
    const config = this.roomConfigs[room];
    const parsed = this.buildRoundState(runtime.round);
    const now = Date.now();
    const spinRemainingMs =
      runtime.spinStartedAt && runtime.spinDurationMs > 0
        ? Math.max(0, runtime.spinDurationMs - (now - runtime.spinStartedAt))
        : 0;
    return {
      room,
      roundId: runtime.round.id,
      gameId: runtime.round.gameNo,
      hash: runtime.round.hash,
      status: runtime.round.status,
      countdownSec: runtime.round.countdownSec,
      timerStarted: runtime.round.timerStarted,
      time: config.timeSec,
      min: config.minBet,
      max: config.maxBet,
      amount: parsed.pot,
      pot: parsed.pot,
      bets: parsed.bets,
      chances: parsed.chances,
      spinDeg: runtime.spinDeg,
      spinStartedAt: runtime.spinStartedAt,
      spinDurationMs: runtime.spinDurationMs,
      spinRemainingMs,
      history: runtime.history.slice(0, 30),
    };
  }

  private getRuntime(room: JackpotRoom): JackpotRoomRuntime {
    const runtime = this.rooms.get(room);
    if (!runtime) {
      throw new AppError("INTERNAL_ERROR", `Unknown jackpot room: ${room}`);
    }
    return runtime;
  }

  private newRound(room: JackpotRoom, gameNo: number): JackpotRound {
    const config = this.roomConfigs[room];
    return {
      id: randomUUID(),
      gameNo,
      hash: randomRoundHash(),
      room,
      countdownSec: config.timeSec,
      timerStarted: false,
      status: "open",
      bets: [],
      version: 1,
    };
  }

  private startLoop(room: JackpotRoom, publishRoundEvent = true): void {
    const runtime = this.getRuntime(room);
    runtime.resolving = false;
    if (publishRoundEvent) {
      if (runtime.pendingHistory) {
        runtime.history = [runtime.pendingHistory, ...runtime.history].slice(0, 30);
        runtime.pendingHistory = null;
      }
      this.publish(room, GAME_EVENTS.JACKPOT_NEW_ROUND, this.snapshot(room)).catch(() => undefined);
    }

    runtime.timer = setInterval(() => {
      if (runtime.resolving) {
        return;
      }
      if (!runtime.round.timerStarted) {
        return;
      }
      if (runtime.round.countdownSec > 0) {
        runtime.round.countdownSec -= 1;
        runtime.round.version += 1;
        this.publish(room, GAME_EVENTS.JACKPOT_TIMER, {
          room,
          roundId: runtime.round.id,
          gameId: runtime.round.gameNo,
          countdownSec: runtime.round.countdownSec,
        }).catch(() => undefined);
      }
      if (runtime.round.countdownSec <= 0 && !runtime.resolving) {
        runtime.resolving = true;
        this.resolveRound(room).catch(() => undefined);
      }
    }, 1000);
  }

  private async resolveRound(room: JackpotRoom): Promise<void> {
    let gameLock: LockLease | null = null;
    const runtime = this.getRuntime(room);
    try {
      await this.refreshConfig();
      const config = this.roomConfigs[room];
      gameLock = await this.acquireLockOrConflict(`game:jackpot:${room}`, "Jackpot is busy", RESOLVE_LOCK_WAIT_MS);

      runtime.resolving = true;
      runtime.round.status = "spinning";
      if (runtime.timer) {
        clearInterval(runtime.timer);
        runtime.timer = null;
      }

      const parsed = this.buildRoundState(runtime.round);
      if (parsed.totalTickets <= 0 || parsed.bets.length === 0) {
        setTimeout(() => {
          void this.refreshConfig().catch(() => undefined).finally(() => {
            runtime.spinDeg = 0;
            runtime.spinStartedAt = null;
            runtime.spinDurationMs = 0;
            runtime.round = this.newRound(room, runtime.nextGameNo);
            runtime.nextGameNo += 1;
            this.startLoop(room);
          });
        }, SPIN_RESET_DELAY_MS);
        return;
      }

      const winnerTicket = Math.floor(Math.random() * parsed.totalTickets) + 1;
      const winningBet = parsed.bets.find((bet) => bet.bet.from <= winnerTicket && bet.bet.to >= winnerTicket) ?? parsed.bets[0];
      if (!winningBet) {
        throw new AppError("INTERNAL_ERROR", "Could not determine jackpot winner");
      }
      const winningChance = parsed.chances.find((chance) => chance.user.userId === winningBet.user.userId) ?? parsed.chances[0];
      if (!winningChance) {
        throw new AppError("INTERNAL_ERROR", "Could not determine jackpot winner chance");
      }

      const commissionRate = this.jackpotCommissionPct / 100;
      const payoutMain = toFixedNumber(parsed.pot * (1 - commissionRate));
      const payoutBonus = 0;
      const winnerStakeMain = toFixedNumber(winningChance.sum);
      const winnerProfitMain = Math.max(0, toFixedNumber(payoutMain - winnerStakeMain));

      const targetStart = winningChance.circle.start;
      const targetEnd = winningChance.circle.end;
      const segmentSize = Math.max(0, targetEnd - targetStart);
      const targetAngle = segmentSize > 0.001 ? targetStart + Math.random() * segmentSize : targetStart;
      const baseTurns = Math.floor(runtime.spinDeg / 360) * 360;
      runtime.spinDeg = Number((baseTurns + 1440 + targetAngle).toFixed(3));
      runtime.spinStartedAt = Date.now();
      runtime.spinDurationMs = 6_000;

      runtime.round.version += 1;
      await this.outbox.append({
        type: GAME_EVENTS.JACKPOT_SLIDER,
        aggregateType: "jackpot",
        aggregateId: `${room}:${runtime.round.id}`,
        version: runtime.round.version,
        payload: {
          room,
          roundId: runtime.round.id,
          gameId: runtime.round.gameNo,
          hash: runtime.round.hash,
          cords: runtime.spinDeg,
          ticket: winnerTicket,
          winnerId: winningBet.user.id,
          winnerUserId: winningBet.user.userId,
          winnerName: winningBet.user.username,
          winnerAvatar: winningBet.user.avatar,
          winnerChance: winningChance.chance,
          winnerBalance: payoutMain,
          winnerBonus: payoutBonus,
        },
      });

      runtime.pendingPayouts.push({
        userId: winningBet.user.userId,
        requestId: `jackpot:${room}:${runtime.round.id}:resolve`,
        amountMain: payoutMain,
        profitMain: winnerProfitMain,
        metadata: {
          game: "jackpot",
          room,
          roundId: runtime.round.id,
          gameId: runtime.round.gameNo,
          ticket: winnerTicket,
          pot: parsed.pot,
          winnerStake: winnerStakeMain,
        },
      });
      this.schedulePayout(room, WINNER_PAYOUT_DELAY_MS);

      runtime.pendingHistory = {
        gameId: runtime.round.gameNo,
        winnerId: winningBet.user.id,
        winnerName: winningBet.user.username,
        winnerAvatar: winningBet.user.avatar,
        winnerChance: toFixedNumber(winningChance.chance),
        winnerTicket,
        winnerBalance: payoutMain,
        winnerBonus: payoutBonus,
        hash: runtime.round.hash,
      };

      try {
        await this.historyStore.append("jackpot_rounds", {
          room,
          roundId: runtime.round.id,
          gameId: runtime.round.gameNo,
          hash: runtime.round.hash,
          status: "resolved",
          winner: {
            userId: winningBet.user.userId,
            username: winningBet.user.username,
            avatar: winningBet.user.avatar,
            chance: winningChance.chance,
            ticket: winnerTicket,
            payoutMain,
            payoutBonus,
          },
          pot: parsed.pot,
          bets: parsed.bets,
        });
      } catch {
        // History write failure must not block the next round.
      }

      setTimeout(() => {
        void this.refreshConfig().catch(() => undefined).finally(() => {
          runtime.spinDeg = 0;
          runtime.spinStartedAt = null;
          runtime.spinDurationMs = 0;
          runtime.round = this.newRound(room, runtime.nextGameNo);
          runtime.nextGameNo += 1;
          this.startLoop(room);
        });
      }, SPIN_RESET_DELAY_MS);
    } catch (error) {
      runtime.resolving = false;
      if (!runtime.timer) {
        runtime.round.status = "countdown";
        runtime.round.timerStarted = true;
        runtime.round.countdownSec = 1;
        this.startLoop(room, false);
      }
      throw error;
    } finally {
      if (gameLock) {
        await this.lockManager.release(gameLock);
      }
    }
  }

  private buildRoundState(round: JackpotRound): JackpotRoundState {
    const perUser = new Map<
      string,
      {
        userId: string;
        id: string;
        username: string;
        avatar: string;
        color: string;
        sum: number;
      }
    >();

    const betRanges: Array<{
      bet: JackpotBet;
      from: number;
      to: number;
    }> = [];

    let cursor = 1;
    for (const bet of round.bets) {
      const ticketWidth = Math.max(1, Math.floor(bet.amount * 100));
      const from = cursor;
      const to = from + ticketWidth - 1;
      cursor = to + 1;
      betRanges.push({ bet, from, to });

      const current = perUser.get(bet.userId);
      if (!current) {
        perUser.set(bet.userId, {
          userId: bet.userId,
          id: bet.userId,
          username: bet.username,
          avatar: bet.avatar,
          color: bet.color,
          sum: toFixedNumber(bet.amount),
        });
      } else {
        current.sum = toFixedNumber(current.sum + bet.amount);
      }
    }

    const pot = toFixedNumber([...perUser.values()].reduce((sum, item) => sum + item.sum, 0));
    const chanceByUser = new Map<string, number>();
    for (const user of perUser.values()) {
      const chance = pot > 0 ? (user.sum / pot) * 100 : 0;
      chanceByUser.set(user.userId, toFixedNumber(chance));
    }

    let angleCursor = 0;
    const chances = [...perUser.values()].map((user) => {
      const chance = chanceByUser.get(user.userId) ?? 0;
      const sweep = (chance / 100) * 360;
      const start = angleCursor;
      const end = start + sweep;
      angleCursor = end;
      return {
        user: {
          id: user.id,
          userId: user.userId,
          username: user.username,
          avatar: user.avatar,
        },
        color: user.color,
        sum: user.sum,
        chance,
        circle: {
          start,
          end,
        },
      };
    });

    const bets = betRanges
      .map((range) => ({
        user: {
          id: range.bet.userId,
          userId: range.bet.userId,
          username: range.bet.username,
          avatar: range.bet.avatar,
        },
        bet: {
          amount: toFixedNumber(range.bet.amount),
          color: range.bet.color,
          balance: range.bet.balance,
          chance: chanceByUser.get(range.bet.userId) ?? 0,
          from: range.from,
          to: range.to,
        },
      }))
      .reverse();

    return {
      pot,
      totalTickets: Math.max(0, cursor - 1),
      bets,
      chances,
    };
  }

  private uniqueUsers(bets: JackpotBet[]): number {
    const ids = new Set<string>();
    for (const bet of bets) {
      ids.add(bet.userId);
    }
    return ids.size;
  }

  private async resolveUserMeta(
    userId: string,
    fallbackUsername: string,
    session?: ClientSession,
  ): Promise<{ username: string; avatar: string }> {
    let userObjectId: ObjectId;
    try {
      userObjectId = new ObjectId(userId);
    } catch {
      return {
        username: fallbackUsername,
        avatar: DEFAULT_AVATAR,
      };
    }

    const user = (await usersCollection(this.db).findOne({ _id: userObjectId }, { session })) as
      | Record<string, unknown>
      | null;

    return {
      username: typeof user?.username === "string" && user.username.trim().length > 0 ? user.username : fallbackUsername,
      avatar: typeof user?.avatar === "string" && user.avatar.trim().length > 0 ? user.avatar : DEFAULT_AVATAR,
    };
  }

  private async refreshConfig(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.settingsLoadedAt < SETTINGS_CACHE_TTL_MS) {
      return;
    }

    const [settings, roomDocs] = await Promise.all([
      this.db.collection<Document>("settings").findOne(
        {},
        {
          sort: { id: 1, _id: 1 },
          projection: { jackpot_commission: 1 },
        },
      ),
      this.db
        .collection<Document>("rooms")
        .find(
          {
            name: { $in: [...jackpotRooms] },
          },
          {
            projection: {
              name: 1,
              time: 1,
              min: 1,
              max: 1,
              bets: 1,
            },
          },
        )
        .toArray(),
    ]);

    const nextConfigs = cloneDefaultRoomConfigs();
    for (const roomDoc of roomDocs) {
      const room = this.asRoomName(roomDoc.name);
      if (!room) {
        continue;
      }
      const defaults = DEFAULT_JACKPOT_ROOM_CONFIGS[room];
      const minBet = this.asPositiveNumber(roomDoc.min, defaults.minBet);
      const parsedMaxBet = this.asPositiveNumber(roomDoc.max, defaults.maxBet);
      const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;
      nextConfigs[room] = {
        timeSec: this.asPositiveInt(roomDoc.time, defaults.timeSec),
        minBet,
        maxBet,
        maxBetsPerUser: this.asPositiveInt(roomDoc.bets, defaults.maxBetsPerUser),
      };
    }

    this.roomConfigs = nextConfigs;
    this.jackpotCommissionPct = this.asPercent(settings?.jackpot_commission, DEFAULT_JACKPOT_COMMISSION_PCT);
    this.settingsLoadedAt = now;

    for (const room of jackpotRooms) {
      const runtime = this.rooms.get(room);
      if (!runtime) {
        continue;
      }
      const nextTime = this.roomConfigs[room].timeSec;
      if (runtime.round.status === "spinning") {
        continue;
      }
      if (runtime.round.bets.length === 0 && !runtime.round.timerStarted && runtime.round.countdownSec !== nextTime) {
        runtime.round.countdownSec = nextTime;
        runtime.round.version += 1;
      }
    }
  }

  private asRoomName(value: unknown): JackpotRoom | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
      return normalized as JackpotRoom;
    }
    return null;
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

  private schedulePayout(room: JackpotRoom, delayMs: number): void {
    const runtime = this.getRuntime(room);
    if (runtime.pendingPayouts.length === 0) {
      return;
    }
    if (runtime.payoutTimer) {
      clearTimeout(runtime.payoutTimer);
      runtime.payoutTimer = null;
    }
    runtime.payoutTimer = setTimeout(() => {
      runtime.payoutTimer = null;
      this.flushPendingPayout(room).catch(() => undefined);
    }, delayMs);
  }

  private async flushPendingPayout(room: JackpotRoom): Promise<void> {
    const runtime = this.getRuntime(room);
    const pending = runtime.pendingPayouts[0];
    if (!pending) {
      return;
    }

    let walletLock: LockLease | null = null;
    const session = this.mongoClient.startSession();
    try {
      walletLock = await this.acquireLockOrConflict(`wallet:${pending.userId}`, "Wallet is busy", GAME_LOCK_WAIT_MS);
      await session.withTransaction(async () => {
        await this.walletService.applyMutationInSession(
          {
            userId: pending.userId,
            requestId: pending.requestId,
            ledgerType: "game_payout",
            deltaMainAtomic: moneyToAtomic(pending.amountMain),
            deltaBonusAtomic: 0n,
            metadata: pending.metadata,
          },
          session,
        );
      });

      if (pending.profitMain > 0 && this.affiliateService) {
        try {
          await this.affiliateService.creditFromReferralWin({
            winnerUserId: pending.userId,
            winAmount: pending.profitMain,
            eventKey: `jackpot:${pending.requestId}:${pending.userId}`,
            context: pending.metadata,
          });
        } catch {
          // Referral payout failures should not fail resolved game result.
        }
      }

      runtime.pendingPayouts.shift();
      if (runtime.pendingPayouts.length > 0) {
        this.schedulePayout(room, PAYOUT_RETRY_DELAY_MS);
      }
    } catch (error) {
      if (error instanceof AppError && error.retryable) {
        this.schedulePayout(room, PAYOUT_RETRY_DELAY_MS);
      } else {
        runtime.pendingPayouts.shift();
        if (runtime.pendingPayouts.length > 0) {
          this.schedulePayout(room, PAYOUT_RETRY_DELAY_MS);
        }
      }
      throw error;
    } finally {
      await session.endSession();
      if (walletLock) {
        await this.lockManager.release(walletLock);
      }
    }
  }

  private async publish(room: JackpotRoom, type: string, payload: Record<string, unknown>): Promise<void> {
    const runtime = this.getRuntime(room);
    await this.outbox.append({
      type,
      aggregateType: "jackpot",
      aggregateId: `${room}:${runtime.round.id}`,
      version: runtime.round.version,
      payload: {
        room,
        ...payload,
      },
    });
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
}

export const registerJackpotHandlers = (router: WsRouter, jackpotService: JackpotService): void => {
  router.register("jackpot.room.subscribe", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      const parsed = jackpotSubscribeSchema.safeParse(ctx.request.data ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid jackpot subscribe payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      ctx.client.subscriptions.add("jackpot");
      return { data: await jackpotService.subscribe(parsed.data.room) };
    },
  });

  router.register("jackpot.bet", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = jackpotBetSchema.safeParse(ctx.request.data ?? {});
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid jackpot bet payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      if (!ctx.request.requestId) {
        throw new AppError("VALIDATION_ERROR", "requestId is required");
      }
      const result = await jackpotService.bet(
        user.userId,
        user.username,
        ctx.request.requestId,
        parsed.data.amount,
        parsed.data.room,
      );
      return { data: result };
    },
  });
};

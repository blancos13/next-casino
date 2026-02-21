"use client";

import { getCasinoBridge, toWsError } from "./casino-bridge";
import { pushToast } from "./toast-store";

export type BattleTeam = "red" | "blue";
type BattleBalance = "balance" | "bonus";

type BattleBetRow = {
  id: string;
  userId: string;
  uniqueId: string;
  user: string;
  avatar: string;
  amount: number;
  team: BattleTeam;
  balType: BattleBalance;
};

type BattleHistoryItem = {
  color: BattleTeam;
  hash: string;
};

type BattleStoreState = {
  roundId: string;
  gameId: number;
  countdownSec: number;
  minBet: number;
  maxBet: number;
  bank: [number, number];
  chances: [number, number];
  factor: [number, number];
  tickets: [number, number];
  count: [number, number];
  bets: BattleBetRow[];
  history: BattleHistoryItem[];
  rotationDeg: number;
  spinMs: number;
  status: string;
  hash: string;
};

const DEFAULT_AVATAR = "/img/no_avatar.jpg";
const BATTLE_SPIN_MS = 4_000;
const HISTORY_COMMIT_DELAY_MS = 4_000;

const DEFAULT_STATE: BattleStoreState = {
  roundId: "",
  gameId: 0,
  countdownSec: 20,
  minBet: 0.1,
  maxBet: 100,
  bank: [0, 0],
  chances: [50, 50],
  factor: [2, 2],
  tickets: [500, 501],
  count: [0, 0],
  bets: [],
  history: [],
  rotationDeg: 0,
  spinMs: 0,
  status: "",
  hash: "9cf7f472f5c4d5e18a9a4521d4b7eaba",
};

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const asInt = (value: unknown, fallback = 0): number => Math.floor(asNumber(value, fallback));

const asString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
};

const asTeam = (value: unknown): BattleTeam | null => {
  if (value === "red" || value === "blue") {
    return value;
  }
  return null;
};

const asBalance = (value: unknown): BattleBalance => (value === "bonus" ? "bonus" : "balance");

const asAvatar = (value: unknown): string => {
  const avatar = asString(value).trim();
  return avatar.length > 0 ? avatar : DEFAULT_AVATAR;
};

class BattleStore {
  private readonly bridge = getCasinoBridge();
  private readonly listeners = new Set<() => void>();
  private initialized = false;
  private historyCommitTimer: number | null = null;
  private spinResetTimer: number | null = null;
  private state: BattleStoreState = DEFAULT_STATE;

  getSnapshot = (): BattleStoreState => this.state;

  getServerSnapshot = (): BattleStoreState => DEFAULT_STATE;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.initialized) {
      this.initialized = true;
      this.bootstrap();
    }
    return () => {
      this.listeners.delete(listener);
    };
  };

  async placeBet(amount: number, team: BattleTeam): Promise<boolean> {
    try {
      await this.bridge.ensureReady();
      await this.bridge.battleBet({
        amount,
        team,
        balance: this.resolveBalanceType(),
      });
      this.patch({ status: "" });
      pushToast("success", "Your bet is accepted!");
      return true;
    } catch (error) {
      const wsError = toWsError(error);
      if (wsError.code !== "UNAUTHORIZED") {
        this.patch({ status: wsError.message });
        pushToast("error", wsError.message);
      }
      return false;
    }
  }

  private resolveBalanceType(): BattleBalance {
    if (typeof window === "undefined") {
      return "balance";
    }
    return window.localStorage.getItem("balance") === "bonus" ? "bonus" : "balance";
  }

  private patch(patch: Partial<BattleStoreState>): void {
    let hasChanges = false;
    for (const key of Object.keys(patch) as Array<keyof BattleStoreState>) {
      if (!Object.is(this.state[key], patch[key])) {
        hasChanges = true;
        break;
      }
    }
    if (!hasChanges) {
      return;
    }
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private clearTimers(): void {
    if (this.historyCommitTimer !== null) {
      window.clearTimeout(this.historyCommitTimer);
      this.historyCommitTimer = null;
    }
    if (this.spinResetTimer !== null) {
      window.clearTimeout(this.spinResetTimer);
      this.spinResetTimer = null;
    }
  }

  private asPair(raw: unknown, fallback: [number, number]): [number, number] {
    if (!Array.isArray(raw)) {
      return fallback;
    }
    return [asNumber(raw[0], fallback[0]), asNumber(raw[1], fallback[1])];
  }

  private mapBets(rawBets: unknown): BattleBetRow[] {
    if (!Array.isArray(rawBets)) {
      return [];
    }
    return rawBets
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const bet = item as {
          user_id?: unknown;
          userId?: unknown;
          unique_id?: unknown;
          uniqueId?: unknown;
          username?: unknown;
          avatar?: unknown;
          price?: unknown;
          amount?: unknown;
          color?: unknown;
          team?: unknown;
          balType?: unknown;
          balance?: unknown;
        };

        const userId = asString(bet.user_id, asString(bet.userId)).trim();
        const uniqueId = asString(bet.unique_id, asString(bet.uniqueId, userId)).trim();
        const username = asString(bet.username).trim();
        const team = asTeam(bet.color ?? bet.team);
        if (!userId || !uniqueId || !username || !team) {
          return null;
        }

        return {
          id: `${userId}:${team}:${index}`,
          userId,
          uniqueId,
          user: username,
          avatar: asAvatar(bet.avatar),
          amount: asNumber(bet.price, asNumber(bet.amount, 0)),
          team,
          balType: asBalance(bet.balType ?? bet.balance),
        };
      })
      .filter((item): item is BattleBetRow => item !== null)
      .sort((a, b) => b.amount - a.amount);
  }

  private parseHistory(raw: unknown): BattleHistoryItem[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (typeof item === "string") {
          const color = asTeam(item);
          if (!color) {
            return null;
          }
          return { color, hash: "" };
        }
        if (!item || typeof item !== "object") {
          return null;
        }
        const row = item as { color?: unknown; hash?: unknown };
        const color = asTeam(row.color);
        if (!color) {
          return null;
        }
        return {
          color,
          hash: asString(row.hash),
        };
      })
      .filter((item): item is BattleHistoryItem => item !== null)
      .slice(0, 15);
  }

  private applySnapshot(snapshotRaw: unknown): void {
    if (!snapshotRaw || typeof snapshotRaw !== "object") {
      return;
    }
    const snapshot = snapshotRaw as {
      roundId?: unknown;
      gameId?: unknown;
      hash?: unknown;
      status?: unknown;
      countdownSec?: unknown;
      minBet?: unknown;
      maxBet?: unknown;
      bank?: unknown;
      chances?: unknown;
      factor?: unknown;
      tickets?: unknown;
      count?: unknown;
      bets?: unknown;
      history?: unknown;
      rotateDeg?: unknown;
    };

    const hasHistory = Array.isArray(snapshot.history);

    this.patch({
      roundId: asString(snapshot.roundId, this.state.roundId),
      gameId: asInt(snapshot.gameId, this.state.gameId),
      hash: asString(snapshot.hash, this.state.hash),
      status: asString(snapshot.status, this.state.status),
      countdownSec: asInt(snapshot.countdownSec, this.state.countdownSec),
      minBet: asNumber(snapshot.minBet, this.state.minBet),
      maxBet: asNumber(snapshot.maxBet, this.state.maxBet),
      bank: this.asPair(snapshot.bank, this.state.bank),
      chances: this.asPair(snapshot.chances, this.state.chances),
      factor: this.asPair(snapshot.factor, this.state.factor),
      tickets: this.asPair(snapshot.tickets, this.state.tickets),
      count: this.asPair(snapshot.count, this.state.count),
      bets: this.mapBets(snapshot.bets),
      history: hasHistory ? this.parseHistory(snapshot.history) : this.state.history,
      rotationDeg: asNumber(snapshot.rotateDeg, this.state.rotationDeg),
    });
  }

  private bootstrap(): void {
    this.bridge.subscribeEvent("battle.timer", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return;
      }
      const payload = payloadRaw as { countdownSec?: unknown; min?: unknown; sec?: unknown };
      const countdown =
        payload.countdownSec !== undefined
          ? asInt(payload.countdownSec, this.state.countdownSec)
          : Math.max(0, asInt(payload.min, 0) * 60 + asInt(payload.sec, 0));
      this.patch({ countdownSec: countdown });
    });

    this.bridge.subscribeEvent("battle.newBet", (payloadRaw) => {
      this.applySnapshot(payloadRaw);
    });

    this.bridge.subscribeEvent("battle.newRound", (payloadRaw) => {
      this.clearTimers();
      this.applySnapshot(payloadRaw);
      this.patch({
        spinMs: 0,
        rotationDeg: 0,
        status: "",
      });
    });

    this.bridge.subscribeEvent("battle.newGame", (payloadRaw) => {
      this.clearTimers();
      this.applySnapshot(payloadRaw);
      this.patch({
        spinMs: 0,
        rotationDeg: 0,
        status: "",
      });
    });

    this.bridge.subscribeEvent("battle.slider", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return;
      }
      const payload = payloadRaw as {
        ticket?: unknown;
        rotateDeg?: unknown;
        winnerTeam?: unknown;
        game?: unknown;
      };

      const gamePayload =
        payload.game && typeof payload.game === "object"
          ? (payload.game as { winner_team?: unknown; hash?: unknown })
          : null;
      const winnerTeam = asTeam(payload.winnerTeam ?? gamePayload?.winner_team);
      if (!winnerTeam) {
        return;
      }

      const ticket = asInt(payload.ticket, 500);
      const rotateDeg = asNumber(payload.rotateDeg, 3600 + ticket * 0.36);
      const winnerHash = asString(gamePayload?.hash, this.state.hash);

      this.clearTimers();
      this.patch({
        rotationDeg: rotateDeg,
        spinMs: BATTLE_SPIN_MS,
        status: "",
      });

      this.historyCommitTimer = window.setTimeout(() => {
        this.historyCommitTimer = null;
        this.patch({
          history: [{ color: winnerTeam, hash: winnerHash }, ...this.state.history].slice(0, 15),
        });
      }, HISTORY_COMMIT_DELAY_MS);

      this.spinResetTimer = window.setTimeout(() => {
        this.spinResetTimer = null;
        this.patch({ spinMs: 0 });
      }, BATTLE_SPIN_MS + 100);
    });

    this.bridge
      .ensureReady()
      .then(() => this.bridge.subscribeBattle())
      .then((snapshotRaw) => {
        this.applySnapshot(snapshotRaw);
      })
      .catch((error) => {
        const wsError = toWsError(error);
        this.patch({ status: wsError.message });
        pushToast("error", wsError.message);
      });
  }
}

let singleton: BattleStore | null = null;

export const getBattleStore = (): BattleStore => {
  if (!singleton) {
    singleton = new BattleStore();
  }
  return singleton;
};


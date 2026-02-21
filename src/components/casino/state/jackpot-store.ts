"use client";

import { getCasinoBridge, toWsError } from "./casino-bridge";
import { pushToast } from "./toast-store";

export type JackpotRoom = "easy" | "medium" | "hard";

export type JackpotBetRow = {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  amount: number;
  balance: "balance" | "bonus";
  chance: number;
  from: number;
  to: number;
  color: string;
};

export type JackpotChanceRow = {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  chance: number;
  sum: number;
  color: string;
  circle: {
    start: number;
    end: number;
  };
};

export type JackpotWinner = {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  chance: number;
  ticket: number;
  balance: number;
  bonus: number;
};

export type JackpotHistoryRow = {
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

type JackpotStoreState = {
  room: JackpotRoom;
  roundId: string;
  gameId: number;
  hash: string;
  countdownSec: number;
  timeSec: number;
  minBet: number;
  maxBet: number;
  pot: number;
  bets: JackpotBetRow[];
  chances: JackpotChanceRow[];
  spinnerDeg: number;
  spinMs: number;
  winner: JackpotWinner | null;
  winnerVisible: boolean;
  history: JackpotHistoryRow[];
  status: string;
};

const DEFAULT_AVATAR = "/img/no_avatar.jpg";
const WINNER_REVEAL_DELAY_MS = 6_200;
const WINNER_CLEAR_DELAY_MS = 2_000;

const DEFAULT_STATE: JackpotStoreState = {
  room: "easy",
  roundId: "",
  gameId: 0,
  hash: "9cf7f472f5c4d5e18a9a4521d4b7eaba",
  countdownSec: 20,
  timeSec: 20,
  minBet: 0.1,
  maxBet: 100,
  pot: 0,
  bets: [],
  chances: [],
  spinnerDeg: 0,
  spinMs: 0,
  winner: null,
  winnerVisible: false,
  history: [],
  status: "",
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

const asInt = (value: unknown, fallback = 0): number => {
  const numeric = asNumber(value, fallback);
  return Number.isFinite(numeric) ? Math.floor(numeric) : fallback;
};

const asString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
};

const asAvatar = (value: unknown): string => {
  const avatar = asString(value).trim();
  return avatar.length > 0 ? avatar : DEFAULT_AVATAR;
};

const parseRoom = (value: unknown): JackpotRoom | null => {
  if (value === "easy" || value === "medium" || value === "hard") {
    return value;
  }
  return null;
};

class JackpotStore {
  private readonly bridge = getCasinoBridge();
  private readonly listeners = new Set<() => void>();
  private initialized = false;
  private winnerRevealTimer: number | null = null;
  private winnerClearTimer: number | null = null;
  private spinResetTimer: number | null = null;
  private readonly roomStorageKey = "win2x.jackpot.room";
  private state: JackpotStoreState = DEFAULT_STATE;

  getSnapshot = (): JackpotStoreState => this.state;

  getServerSnapshot = (): JackpotStoreState => DEFAULT_STATE;

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

  async setRoom(room: JackpotRoom): Promise<void> {
    if (room === this.state.room) {
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(this.roomStorageKey, room);
    }

    this.clearTransientTimers();
    this.patch({
      room,
      roundId: "",
      gameId: 0,
      hash: DEFAULT_STATE.hash,
      countdownSec: DEFAULT_STATE.timeSec,
      timeSec: DEFAULT_STATE.timeSec,
      minBet: DEFAULT_STATE.minBet,
      maxBet: DEFAULT_STATE.maxBet,
      pot: 0,
      bets: [],
      chances: [],
      spinnerDeg: 0,
      spinMs: 0,
      winner: null,
      winnerVisible: false,
      history: [],
      status: "",
    });

    try {
      await this.bridge.ensureReady();
      const snapshotRaw = await this.bridge.subscribeJackpot(room);
      this.applySnapshot(snapshotRaw);
    } catch (error) {
      const wsError = toWsError(error);
      this.patch({ status: wsError.message });
      pushToast("error", wsError.message);
    }
  }

  async placeBet(amount: number): Promise<boolean> {
    try {
      await this.bridge.ensureReady();
      const result = (await this.bridge.jackpotBet({ amount, room: this.state.room })) as {
        data?: unknown;
      };
      if (result && result.data) {
        this.applySnapshot(result.data);
      }
      this.patch({ status: "" });
      pushToast("success", "Your bet has entered the game!");
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

  private patch(patch: Partial<JackpotStoreState>): void {
    let hasChanges = false;
    for (const key of Object.keys(patch) as Array<keyof JackpotStoreState>) {
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

  private clearTransientTimers(): void {
    if (this.winnerRevealTimer !== null) {
      window.clearTimeout(this.winnerRevealTimer);
      this.winnerRevealTimer = null;
    }
    if (this.winnerClearTimer !== null) {
      window.clearTimeout(this.winnerClearTimer);
      this.winnerClearTimer = null;
    }
    if (this.spinResetTimer !== null) {
      window.clearTimeout(this.spinResetTimer);
      this.spinResetTimer = null;
    }
  }

  private mapBets(raw: unknown): JackpotBetRow[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const row = item as { user?: unknown; bet?: unknown };
        if (!row.user || typeof row.user !== "object" || !row.bet || typeof row.bet !== "object") {
          return null;
        }

        const user = row.user as { id?: unknown; userId?: unknown; username?: unknown; avatar?: unknown };
        const bet = row.bet as {
          amount?: unknown;
          balance?: unknown;
          chance?: unknown;
          from?: unknown;
          to?: unknown;
          color?: unknown;
        };

        const userId = asString(user.userId, asString(user.id));
        const username = asString(user.username).trim();
        if (!userId || !username) {
          return null;
        }

        const balanceRaw = asString(bet.balance, "balance");
        const balance: "balance" | "bonus" = balanceRaw === "bonus" ? "bonus" : "balance";
        const colorValue = asString(bet.color).trim();
        const color = colorValue.startsWith("#") ? colorValue : `#${colorValue || "4986f5"}`;

        return {
          id: `${userId}:${index}`,
          userId,
          username,
          avatar: asAvatar(user.avatar),
          amount: asNumber(bet.amount, 0),
          balance,
          chance: asNumber(bet.chance, 0),
          from: asInt(bet.from, 0),
          to: asInt(bet.to, 0),
          color,
        };
      })
      .filter((item): item is JackpotBetRow => item !== null);
  }

  private mapChances(raw: unknown): JackpotChanceRow[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const row = item as { user?: unknown; color?: unknown; chance?: unknown; sum?: unknown; circle?: unknown };
        if (!row.user || typeof row.user !== "object") {
          return null;
        }
        const user = row.user as { id?: unknown; userId?: unknown; username?: unknown; avatar?: unknown };
        const userId = asString(user.userId, asString(user.id));
        const username = asString(user.username).trim();
        if (!userId || !username) {
          return null;
        }

        const colorValue = asString(row.color).trim();
        const color = colorValue.startsWith("#") ? colorValue : `#${colorValue || "4986f5"}`;
        const circleRaw = row.circle && typeof row.circle === "object" ? (row.circle as { start?: unknown; end?: unknown }) : null;

        return {
          id: `${userId}:${index}`,
          userId,
          username,
          avatar: asAvatar(user.avatar),
          chance: asNumber(row.chance, 0),
          sum: asNumber(row.sum, 0),
          color,
          circle: {
            start: asNumber(circleRaw?.start, 0),
            end: asNumber(circleRaw?.end, 0),
          },
        };
      })
      .filter((item): item is JackpotChanceRow => item !== null);
  }

  private mapHistory(raw: unknown): JackpotHistoryRow[] {
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const row = item as {
          gameId?: unknown;
          winnerId?: unknown;
          winnerName?: unknown;
          winnerAvatar?: unknown;
          winnerChance?: unknown;
          winnerTicket?: unknown;
          winnerBalance?: unknown;
          winnerBonus?: unknown;
          hash?: unknown;
        };

        const winnerId = asString(row.winnerId).trim();
        const winnerName = asString(row.winnerName).trim();
        const hash = asString(row.hash).trim();
        if (!winnerId || !winnerName || !hash) {
          return null;
        }

        return {
          gameId: asInt(row.gameId, 0),
          winnerId,
          winnerName,
          winnerAvatar: asAvatar(row.winnerAvatar),
          winnerChance: asNumber(row.winnerChance, 0),
          winnerTicket: asInt(row.winnerTicket, 0),
          winnerBalance: asNumber(row.winnerBalance, 0),
          winnerBonus: asNumber(row.winnerBonus, 0),
          hash,
        };
      })
      .filter((item): item is JackpotHistoryRow => item !== null)
      .slice(0, 30);
  }

  private applySnapshot(snapshotRaw: unknown): void {
    if (!snapshotRaw || typeof snapshotRaw !== "object") {
      return;
    }

    const snapshot = snapshotRaw as {
      room?: unknown;
      roundId?: unknown;
      gameId?: unknown;
      hash?: unknown;
      status?: unknown;
      countdownSec?: unknown;
      time?: unknown;
      min?: unknown;
      max?: unknown;
      amount?: unknown;
      pot?: unknown;
      bets?: unknown;
      chances?: unknown;
      spinDeg?: unknown;
      spinRemainingMs?: unknown;
      history?: unknown;
    };

    const room = parseRoom(snapshot.room);
    if (!room || room !== this.state.room) {
      return;
    }

    const bets = this.mapBets(snapshot.bets);
    const chances = this.mapChances(snapshot.chances);
    const pot = snapshot.pot !== undefined ? asNumber(snapshot.pot, 0) : asNumber(snapshot.amount, 0);
    const roundStatus = asString(snapshot.status).trim();
    const spinRemainingMs = Math.max(0, asInt(snapshot.spinRemainingMs, 0));

    const patch: Partial<JackpotStoreState> = {
      room,
      roundId: asString(snapshot.roundId, this.state.roundId),
      gameId: asInt(snapshot.gameId, this.state.gameId),
      hash: asString(snapshot.hash, this.state.hash),
      countdownSec: asInt(snapshot.countdownSec, this.state.countdownSec),
      timeSec: asInt(snapshot.time, this.state.timeSec),
      minBet: asNumber(snapshot.min, this.state.minBet),
      maxBet: asNumber(snapshot.max, this.state.maxBet),
      pot,
      bets,
      chances,
      spinnerDeg: asNumber(snapshot.spinDeg, this.state.spinnerDeg),
      history: this.mapHistory(snapshot.history),
      status: "",
    };

    if (roundStatus === "spinning") {
      patch.spinMs = spinRemainingMs;
      patch.winner = null;
      patch.winnerVisible = false;
    } else if (this.state.spinMs !== 0) {
      patch.spinMs = 0;
    }

    this.patch(patch);
  }

  private bootstrap(): void {
    if (typeof window !== "undefined") {
      const savedRoom = parseRoom(window.localStorage.getItem(this.roomStorageKey));
      if (savedRoom && savedRoom !== this.state.room) {
        this.patch({ room: savedRoom });
      }
    }

    this.bridge.subscribeEvent("jackpot.timer", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return;
      }
      const payload = payloadRaw as { room?: unknown; roundId?: unknown; countdownSec?: unknown };
      const room = parseRoom(payload.room);
      if (!room || room !== this.state.room) {
        return;
      }
      this.patch({
        countdownSec: asInt(payload.countdownSec, this.state.countdownSec),
        roundId: asString(payload.roundId, this.state.roundId),
      });
    });

    this.bridge.subscribeEvent("jackpot.update", (payloadRaw) => {
      this.applySnapshot(payloadRaw);
    });

    this.bridge.subscribeEvent("jackpot.newRound", (payloadRaw) => {
      this.clearTransientTimers();
      this.applySnapshot(payloadRaw);
      this.patch({
        spinMs: 1500,
        spinnerDeg: 0,
        status: "",
      });

      this.spinResetTimer = window.setTimeout(() => {
        this.spinResetTimer = null;
        this.patch({ spinMs: 0 });
      }, 1_600);

      if (this.state.winner) {
        this.patch({ winnerVisible: false });
        this.winnerClearTimer = window.setTimeout(() => {
          this.winnerClearTimer = null;
          this.patch({ winner: null, winnerVisible: false });
        }, WINNER_CLEAR_DELAY_MS);
      } else {
        this.patch({ winner: null, winnerVisible: false });
      }
    });

    this.bridge.subscribeEvent("jackpot.slider", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return;
      }
      const payload = payloadRaw as {
        room?: unknown;
        cords?: unknown;
        winnerId?: unknown;
        winnerUserId?: unknown;
        winnerName?: unknown;
        winnerAvatar?: unknown;
        winnerChance?: unknown;
        winnerBalance?: unknown;
        winnerBonus?: unknown;
        ticket?: unknown;
      };

      const room = parseRoom(payload.room);
      if (!room || room !== this.state.room) {
        return;
      }

      const winnerId = asString(payload.winnerId).trim();
      const winnerUserId = asString(payload.winnerUserId, winnerId).trim();
      const winnerName = asString(payload.winnerName).trim();
      if (!winnerId || !winnerUserId || !winnerName) {
        return;
      }

      this.clearTransientTimers();

      this.patch({
        spinnerDeg: asNumber(payload.cords, this.state.spinnerDeg),
        spinMs: 6000,
        winner: null,
        winnerVisible: false,
        status: "",
      });

      this.winnerRevealTimer = window.setTimeout(() => {
        this.winnerRevealTimer = null;
        this.patch({
          spinMs: 0,
          winner: {
            id: winnerId,
            userId: winnerUserId,
            username: winnerName,
            avatar: asAvatar(payload.winnerAvatar),
            chance: asNumber(payload.winnerChance, 0),
            ticket: asInt(payload.ticket, 0),
            balance: asNumber(payload.winnerBalance, 0),
            bonus: asNumber(payload.winnerBonus, 0),
          },
          winnerVisible: true,
          status: "",
        });
      }, WINNER_REVEAL_DELAY_MS);
    });

    this.bridge
      .ensureReady()
      .then(() => this.bridge.subscribeJackpot(this.state.room))
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

let singleton: JackpotStore | null = null;

export const getJackpotStore = (): JackpotStore => {
  if (!singleton) {
    singleton = new JackpotStore();
  }
  return singleton;
};

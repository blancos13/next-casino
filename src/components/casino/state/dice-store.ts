"use client";

import type { GameHistoryRow } from "../types";
import { getCasinoBridge, toWsError } from "./casino-bridge";

type DiceStoreState = {
  historyRows: GameHistoryRow[];
  minBet: number;
  maxBet: number;
  rollResult: number | null;
  lastWin: boolean | null;
  diceHash: string;
  status: string;
};

const FALLBACK_ROWS: GameHistoryRow[] = [
  { id: "1", user: "Luna", bet: 4.2, chance: 62.5, multiplier: 1.54, roll: 37.91, result: 2.27, win: true },
  { id: "2", user: "Kaiser", bet: 8, chance: 40, multiplier: 2.4, roll: 73.04, result: -8, win: false },
  { id: "3", user: "Nova", bet: 2.5, chance: 55.25, multiplier: 1.74, roll: 11.82, result: 1.85, win: true },
  { id: "4", user: "Edge", bet: 6, chance: 35.6, multiplier: 2.69, roll: 50.31, result: -6, win: false },
];

const DEFAULT_STATE: DiceStoreState = {
  historyRows: FALLBACK_ROWS,
  minBet: 0.1,
  maxBet: 100,
  rollResult: null,
  lastWin: null,
  diceHash: "9cf7f472f5c4d5e18a9a4521d4b7eaba",
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

const mapHistoryRow = (
  payload: unknown,
  fallbackId: string,
): GameHistoryRow | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const row = payload as {
    betId?: unknown;
    _id?: unknown;
    user?: unknown;
    username?: unknown;
    userId?: unknown;
    amount?: unknown;
    bet?: unknown;
    chance?: unknown;
    rate?: unknown;
    multiplier?: unknown;
    roll?: unknown;
    result?: unknown;
    profit?: unknown;
    win?: unknown;
  };

  const user =
    (typeof row.user === "string" ? row.user.trim() : "") ||
    (typeof row.username === "string" ? row.username.trim() : "");
  if (!user) {
    return null;
  }

  const result = row.profit ?? row.result;
  const chance = asNumber(row.chance, 50);
  const multiplier = asNumber(row.rate ?? row.multiplier, 0);
  const bet = asNumber(row.amount ?? row.bet, 0);
  const roll = asNumber(row.roll, 0);
  const win = typeof row.win === "boolean" ? row.win : asNumber(result, 0) >= 0;

  const objectId =
    typeof row._id === "string"
      ? row._id
      : row._id && typeof row._id === "object" && "$oid" in row._id
        ? String((row._id as { $oid: unknown }).$oid)
        : fallbackId;

  return {
    id: typeof row.betId === "string" ? row.betId : objectId,
    user,
    bet,
    chance,
    multiplier,
    roll,
    result: asNumber(result, 0),
    win,
  };
};

class DiceStore {
  private readonly bridge = getCasinoBridge();
  private readonly listeners = new Set<() => void>();
  private readonly knownIds = new Set<string>();
  private initialized = false;
  private state: DiceStoreState = DEFAULT_STATE;

  getSnapshot = (): DiceStoreState => this.state;

  getServerSnapshot = (): DiceStoreState => DEFAULT_STATE;

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

  async placeBet(input: { amount: number; chance: number; direction: "under" | "over" }): Promise<boolean> {
    try {
      await this.bridge.ensureReady();
      const result = (await this.bridge.diceBet(input)) as {
        betId?: unknown;
        username?: unknown;
        amount?: unknown;
        chance?: unknown;
        rate?: unknown;
        roll?: unknown;
        profit?: unknown;
        win?: unknown;
        serverSeedHash?: unknown;
      };

      const roll = asNumber(result.roll, this.state.rollResult ?? 0);
      const win = typeof result.win === "boolean" ? result.win : this.state.lastWin;
      const hash = typeof result.serverSeedHash === "string" ? result.serverSeedHash : this.state.diceHash;

      const mapped = mapHistoryRow(
        {
          betId: result.betId,
          user: this.bridge.getState().username,
          username: result.username,
          userId: this.bridge.getState().userId,
          amount: result.amount,
          chance: result.chance,
          rate: result.rate,
          roll: result.roll,
          profit: result.profit,
          win: result.win,
        },
        `local-${Date.now()}`,
      );

      if (mapped) {
        this.appendRow(mapped);
      }

      this.patch({
        rollResult: Number.isFinite(roll) ? roll : this.state.rollResult,
        lastWin: win,
        diceHash: hash,
        status: "",
      });
      return true;
    } catch (error) {
      const wsError = toWsError(error);
      if (wsError.code !== "UNAUTHORIZED") {
        this.patch({ status: wsError.message });
      }
      return false;
    }
  }

  setStatus(status: string): void {
    this.patch({ status });
  }

  private patch(patch: Partial<DiceStoreState>): void {
    let hasChanges = false;
    for (const key of Object.keys(patch) as Array<keyof DiceStoreState>) {
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

  private appendRow(row: GameHistoryRow): void {
    if (this.knownIds.has(row.id)) {
      return;
    }
    this.knownIds.add(row.id);
    this.patch({ historyRows: [row, ...this.state.historyRows].slice(0, 50) });
  }

  private setRows(rows: GameHistoryRow[]): void {
    const unique: GameHistoryRow[] = [];
    const ids = new Set<string>();
    for (const row of rows) {
      if (ids.has(row.id)) {
        continue;
      }
      ids.add(row.id);
      unique.push(row);
    }
    this.knownIds.clear();
    for (const id of ids) {
      this.knownIds.add(id);
    }
    this.patch({ historyRows: unique });
  }

  private bootstrap(): void {
    this.bridge.subscribeEvent("stream.bet.created", (payload) => {
      const row = mapHistoryRow(payload, `stream-${Date.now()}`);
      if (!row) {
        return;
      }
      this.appendRow(row);
    });

    this.bridge
      .ensureReady()
      .then(() => this.bridge.subscribeDice())
      .then((subscribeRaw) => {
        if (!subscribeRaw || typeof subscribeRaw !== "object") {
          return;
        }
        const payload = subscribeRaw as { minBet?: unknown; maxBet?: unknown };
        const minBet = asNumber(payload.minBet, this.state.minBet);
        const parsedMaxBet = asNumber(payload.maxBet, this.state.maxBet);
        const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;
        this.patch({ minBet, maxBet });
      })
      .then(() => this.bridge.getDiceSnapshot(50))
      .then((snapshotRaw) => {
        if (!snapshotRaw || typeof snapshotRaw !== "object") {
          return;
        }
        const bets = (snapshotRaw as { bets?: unknown }).bets;
        if (!Array.isArray(bets)) {
          return;
        }
        const mapped = bets
          .map((item, index) => mapHistoryRow(item, `snapshot-${index}`))
          .filter((item): item is GameHistoryRow => item !== null);
        if (mapped.length > 0) {
          this.setRows(mapped);
        }
      })
      .catch((error) => {
        this.patch({ status: toWsError(error).message });
      });
  }
}

let singleton: DiceStore | null = null;

export const getDiceStore = (): DiceStore => {
  if (!singleton) {
    singleton = new DiceStore();
  }
  return singleton;
};

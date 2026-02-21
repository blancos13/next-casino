"use client";

import { getCasinoBridge, toWsError } from "./casino-bridge";

type CrashPhase = "betting" | "running" | "ended";

export type CrashBetRow = {
  id: string;
  userId: string;
  user: string;
  amount: number;
  cashedOut: boolean;
  cashoutMultiplier: number | null;
  payout: number | null;
};

export type CrashHistoryItem = {
  multiplier: number;
  hash: string;
};

type CrashStoreState = {
  roundId: string;
  phase: CrashPhase;
  countdownSec: number;
  minBet: number;
  maxBet: number;
  multiplier: number;
  crashPoint: number | null;
  bets: CrashBetRow[];
  history: CrashHistoryItem[];
  graphPoints: number[];
  status: string;
  hash: string;
};

const DEFAULT_STATE: CrashStoreState = {
  roundId: "",
  phase: "betting",
  countdownSec: 10,
  minBet: 0.1,
  maxBet: 100,
  multiplier: 1,
  crashPoint: null,
  bets: [],
  history: [],
  graphPoints: [1],
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

const asPhase = (value: unknown): CrashPhase => {
  if (value === "running" || value === "ended") {
    return value;
  }
  return "betting";
};

const normalizeGraphPoints = (raw: unknown, fallbackMultiplier: number): number[] => {
  if (!Array.isArray(raw)) {
    return [1, Number(fallbackMultiplier.toFixed(4))].slice(-2500);
  }
  const parsed = raw
    .map((item) => asNumber(item, 0))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Number(item.toFixed(4)))
    .slice(-2500);

  if (parsed.length === 0) {
    return [1, Number(fallbackMultiplier.toFixed(4))].slice(-2500);
  }
  if (parsed[0] !== 1) {
    return [1, ...parsed].slice(-2500);
  }
  return parsed;
};

const mapBet = (input: unknown, fallbackId: string): CrashBetRow | null => {
  if (!input || typeof input !== "object") {
    return null;
  }

  const bet = input as {
    id?: unknown;
    userId?: unknown;
    username?: unknown;
    amount?: unknown;
    cashedOut?: unknown;
    cashoutMultiplier?: unknown;
    payout?: unknown;
  };

  const userId = typeof bet.userId === "string" ? bet.userId : "";
  const username = typeof bet.username === "string" ? bet.username.trim() : "";
  const amount = asNumber(bet.amount, 0);
  if (!userId || !username) {
    return null;
  }

  return {
    id: typeof bet.id === "string" ? bet.id : `${fallbackId}:${userId}:${amount}`,
    userId,
    user: username,
    amount,
    cashedOut: Boolean(bet.cashedOut),
    cashoutMultiplier:
      bet.cashoutMultiplier === null || bet.cashoutMultiplier === undefined
        ? null
        : asNumber(bet.cashoutMultiplier, 0),
    payout: bet.payout === null || bet.payout === undefined ? null : asNumber(bet.payout, 0),
  };
};

class CrashStore {
  private readonly bridge = getCasinoBridge();
  private readonly listeners = new Set<() => void>();
  private initialized = false;
  private lastEndedRoundId = "";
  private state: CrashStoreState = DEFAULT_STATE;

  getSnapshot = (): CrashStoreState => this.state;

  getServerSnapshot = (): CrashStoreState => DEFAULT_STATE;

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

  async placeBet(amount: number): Promise<boolean> {
    try {
      await this.bridge.ensureReady();
      const result = (await this.bridge.crashBet({ amount })) as {
        roundId?: unknown;
        bets?: unknown;
      };
      if (result.roundId === this.state.roundId && Array.isArray(result.bets)) {
        this.patch({
          bets: this.mapBets(result.bets),
        });
      }
      this.patch({ status: "" });
      return true;
    } catch (error) {
      const wsError = toWsError(error);
      if (wsError.code !== "UNAUTHORIZED") {
        this.patch({ status: wsError.message });
      }
      return false;
    }
  }

  async cashout(atMultiplier?: number): Promise<boolean> {
    try {
      await this.bridge.ensureReady();
      await this.bridge.crashCashout(
        atMultiplier && Number.isFinite(atMultiplier) ? { atMultiplier } : undefined,
      );
      this.patch({ status: "" });
      return true;
    } catch (error) {
      const wsError = toWsError(error);
      if (wsError.code !== "UNAUTHORIZED") {
        this.patch({ status: wsError.message });
      }
      return false;
    }
  }

  private patch(patch: Partial<CrashStoreState>): void {
    let hasChanges = false;
    for (const key of Object.keys(patch) as Array<keyof CrashStoreState>) {
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

  private pushHistory(roundId: string, value: number, hash: string): void {
    if (!roundId || this.lastEndedRoundId === roundId || !Number.isFinite(value) || value <= 0) {
      return;
    }
    this.lastEndedRoundId = roundId;
    const history = [
      {
        multiplier: Number(value.toFixed(2)),
        hash: hash.trim(),
      },
      ...this.state.history,
    ].slice(0, 24);
    this.patch({
      history,
    });
  }

  private appendGraphPoint(value: number): number[] {
    if (!Number.isFinite(value) || value <= 0) {
      return this.state.graphPoints;
    }
    return [...this.state.graphPoints, Number(value.toFixed(4))].slice(-2500);
  }

  private mapBets(rawBets: unknown[]): CrashBetRow[] {
    return rawBets
      .map((item, index) => mapBet(item, `${this.state.roundId}:${index}`))
      .filter((item): item is CrashBetRow => item !== null)
      .sort((a, b) => b.amount - a.amount);
  }

  private applySnapshot(snapshotRaw: unknown): void {
    if (!snapshotRaw || typeof snapshotRaw !== "object") {
      return;
    }
    const snapshot = snapshotRaw as {
      roundId?: unknown;
      hash?: unknown;
      phase?: unknown;
      countdownSec?: unknown;
      minBet?: unknown;
      maxBet?: unknown;
      multiplier?: unknown;
      crashPoint?: unknown;
      bets?: unknown;
      history?: unknown;
      graphPoints?: unknown;
    };

    const roundId = typeof snapshot.roundId === "string" ? snapshot.roundId : this.state.roundId;
    const phase = asPhase(snapshot.phase);
    const countdownSec = asNumber(snapshot.countdownSec, this.state.countdownSec);
    const minBet = asNumber(snapshot.minBet, this.state.minBet);
    const parsedMaxBet = asNumber(snapshot.maxBet, this.state.maxBet);
    const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;
    const multiplier = asNumber(snapshot.multiplier, this.state.multiplier);
    const crashPoint =
      snapshot.crashPoint === undefined || snapshot.crashPoint === null
        ? null
        : asNumber(snapshot.crashPoint, multiplier);

    let bets = this.state.bets;
    if (Array.isArray(snapshot.bets)) {
      bets = this.mapBets(snapshot.bets);
    }
    const parsedHistory = Array.isArray(snapshot.history)
      ? snapshot.history
          .map((item) => {
            if (typeof item === "number" || typeof item === "string") {
              const multiplier = asNumber(item, 0);
              if (multiplier <= 0) {
                return null;
              }
              return {
                multiplier: Number(multiplier.toFixed(2)),
                hash: "",
              };
            }
            if (!item || typeof item !== "object") {
              return null;
            }
            const row = item as { multiplier?: unknown; hash?: unknown };
            const multiplier = asNumber(row.multiplier, 0);
            if (multiplier <= 0) {
              return null;
            }
            return {
              multiplier: Number(multiplier.toFixed(2)),
              hash: typeof row.hash === "string" ? row.hash : "",
            };
          })
          .filter((item): item is CrashHistoryItem => item !== null)
          .slice(0, 24)
      : null;
    const history = parsedHistory ?? this.state.history;

    const graphPoints =
      phase === "betting" ? [1] : normalizeGraphPoints(snapshot.graphPoints, multiplier);

    this.patch({
      roundId,
      hash: typeof snapshot.hash === "string" ? snapshot.hash : this.state.hash,
      phase,
      countdownSec,
      minBet,
      maxBet,
      multiplier,
      crashPoint,
      bets,
      history,
      graphPoints,
    });

    if (phase === "ended") {
      const historyValue = crashPoint ?? multiplier;
      this.pushHistory(
        roundId,
        historyValue,
        typeof snapshot.hash === "string" ? snapshot.hash : this.state.hash,
      );
    }
  }

  private bootstrap(): void {
    this.bridge.subscribeEvent("crash.round.reset", (payload) => {
      this.applySnapshot(payload);
    });

    this.bridge.subscribeEvent("crash.timer", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return;
      }
      const payload = payloadRaw as { roundId?: unknown; hash?: unknown; countdownSec?: unknown; phase?: unknown };
      const phase = asPhase(payload.phase);
      this.patch({
        roundId: typeof payload.roundId === "string" ? payload.roundId : this.state.roundId,
        hash: typeof payload.hash === "string" ? payload.hash : this.state.hash,
        countdownSec: asNumber(payload.countdownSec, this.state.countdownSec),
        phase,
        graphPoints: phase === "betting" ? [1] : this.state.graphPoints,
      });
    });

    this.bridge.subscribeEvent("crash.tick", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return;
      }
      const payload = payloadRaw as {
        roundId?: unknown;
        hash?: unknown;
        multiplier?: unknown;
        phase?: unknown;
        crashPoint?: unknown;
        graphPoints?: unknown;
      };
      const roundId = typeof payload.roundId === "string" ? payload.roundId : this.state.roundId;
      const phase = asPhase(payload.phase);
      const multiplier = asNumber(payload.multiplier, this.state.multiplier);
      const crashPoint =
        payload.crashPoint === undefined || payload.crashPoint === null
          ? this.state.crashPoint
          : asNumber(payload.crashPoint, multiplier);

      const graphPoints =
        phase === "betting"
          ? [1]
          : Array.isArray(payload.graphPoints)
            ? normalizeGraphPoints(payload.graphPoints, multiplier)
            : this.appendGraphPoint(multiplier);

      this.patch({
        roundId,
        hash: typeof payload.hash === "string" ? payload.hash : this.state.hash,
        multiplier,
        phase,
        crashPoint,
        graphPoints,
      });

      if (phase === "ended") {
        this.pushHistory(
          roundId,
          crashPoint ?? multiplier,
          typeof payload.hash === "string" ? payload.hash : this.state.hash,
        );
      }
    });

    this.bridge.subscribeEvent("crash.bets.snapshot", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return;
      }
      const payload = payloadRaw as { roundId?: unknown; phase?: unknown; bets?: unknown };
      const roundId = typeof payload.roundId === "string" ? payload.roundId : this.state.roundId;
      const phase = asPhase(payload.phase);
      const bets = Array.isArray(payload.bets) ? this.mapBets(payload.bets) : this.state.bets;
      this.patch({ roundId, phase, bets });
    });

    this.bridge
      .ensureReady()
      .then(() => this.bridge.subscribeCrash())
      .then((snapshotRaw) => {
        this.applySnapshot(snapshotRaw);
      })
      .catch((error) => {
        this.patch({ status: toWsError(error).message });
      });
  }
}

let singleton: CrashStore | null = null;

export const getCrashStore = (): CrashStore => {
  if (!singleton) {
    singleton = new CrashStore();
  }
  return singleton;
};

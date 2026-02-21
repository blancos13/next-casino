"use client";

import { getCasinoBridge, toWsError } from "./casino-bridge";

export type WheelColor = "red" | "black" | "green" | "yellow";

type WheelBetRow = {
  id: string;
  userId: string;
  user: string;
  amount: number;
  color: WheelColor;
};

type WheelHistoryItem = {
  color: WheelColor;
  hash: string;
};

type WheelBettingPhase = "betting" | "waitingSpin" | "spinning";

type WheelStoreState = {
  roundId: string;
  countdownSec: number;
  minBet: number;
  maxBet: number;
  bets: WheelBetRow[];
  history: WheelHistoryItem[];
  resultColor: WheelColor | null;
  rotationDeg: number;
  spinMs: number;
  bettingPhase: WheelBettingPhase;
  isPlacingBet: boolean;
  status: string;
  hash: string;
};

const DEFAULT_STATE: WheelStoreState = {
  roundId: "",
  countdownSec: 15,
  minBet: 0.1,
  maxBet: 100,
  bets: [],
  history: [],
  resultColor: null,
  rotationDeg: 0,
  spinMs: 0,
  bettingPhase: "betting",
  isPlacingBet: false,
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

const asColor = (value: unknown): WheelColor | null => {
  if (value === "red" || value === "black" || value === "green" || value === "yellow") {
    return value;
  }
  return null;
};

class WheelStore {
  private readonly bridge = getCasinoBridge();
  private readonly listeners = new Set<() => void>();
  private initialized = false;
  private state: WheelStoreState = DEFAULT_STATE;
  private spinResetTimer: number | null = null;

  getSnapshot = (): WheelStoreState => this.state;

  getServerSnapshot = (): WheelStoreState => DEFAULT_STATE;

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

  async placeBet(amount: number, color: WheelColor): Promise<boolean> {
    if (this.state.isPlacingBet || this.state.bettingPhase !== "betting") {
      return false;
    }
    this.patch({ isPlacingBet: true });
    try {
      await this.bridge.ensureReady();
      await this.bridge.wheelBet({ amount, color });
      this.patch({ status: "" });
      return true;
    } catch (error) {
      const wsError = toWsError(error);
      if (wsError.code !== "UNAUTHORIZED") {
        this.patch({ status: wsError.message });
      }
      return false;
    } finally {
      this.patch({ isPlacingBet: false });
    }
  }

  private patch(patch: Partial<WheelStoreState>): void {
    let hasChanges = false;
    for (const key of Object.keys(patch) as Array<keyof WheelStoreState>) {
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

  private mapBets(rawBets: unknown[]): WheelBetRow[] {
    return rawBets
      .map((item, index) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const bet = item as { userId?: unknown; username?: unknown; amount?: unknown; color?: unknown };
        const userId = typeof bet.userId === "string" ? bet.userId : "";
        const username = typeof bet.username === "string" ? bet.username.trim() : "";
        const color = asColor(bet.color);
        if (!userId || !color || !username) {
          return null;
        }
        return {
          id: `${userId}:${color}:${index}`,
          userId,
          user: username,
          amount: asNumber(bet.amount, 0),
          color,
        };
      })
      .filter((item): item is WheelBetRow => item !== null)
      .sort((a, b) => b.amount - a.amount);
  }

  private applySnapshot(snapshotRaw: unknown): void {
    if (!snapshotRaw || typeof snapshotRaw !== "object") {
      return;
    }
    const snapshot = snapshotRaw as {
      roundId?: unknown;
      hash?: unknown;
      countdownSec?: unknown;
      minBet?: unknown;
      maxBet?: unknown;
      bets?: unknown;
      history?: unknown;
      rotateDeg?: unknown;
    };
    const roundId = typeof snapshot.roundId === "string" ? snapshot.roundId : this.state.roundId;
    const countdownSec = asNumber(snapshot.countdownSec, this.state.countdownSec);
    const minBet = asNumber(snapshot.minBet, this.state.minBet);
    const parsedMaxBet = asNumber(snapshot.maxBet, this.state.maxBet);
    const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;
    const bets = Array.isArray(snapshot.bets) ? this.mapBets(snapshot.bets) : this.state.bets;
    const parsedHistory = Array.isArray(snapshot.history)
      ? snapshot.history
          .map((item) => {
            if (typeof item === "string") {
              const color = asColor(item);
              if (!color) {
                return null;
              }
              return {
                color,
                hash: "",
              };
            }
            if (!item || typeof item !== "object") {
              return null;
            }
            const row = item as { color?: unknown; hash?: unknown };
            const color = asColor(row.color);
            if (!color) {
              return null;
            }
            return {
              color,
              hash: typeof row.hash === "string" ? row.hash : "",
            };
          })
          .filter((item): item is WheelHistoryItem => item !== null)
          .slice(0, 24)
      : null;
    const history = parsedHistory ?? this.state.history;
    const rotationDeg = asNumber(snapshot.rotateDeg, this.state.rotationDeg);
    const bettingPhase = this.resolveBettingPhase(countdownSec, this.state.spinMs);

    this.patch({
      roundId,
      countdownSec,
      minBet,
      maxBet,
      bets,
      history,
      hash: typeof snapshot.hash === "string" ? snapshot.hash : this.state.hash,
      rotationDeg,
      bettingPhase,
    });
  }

  private resolveBettingPhase(countdownSec: number, spinMs: number): WheelBettingPhase {
    if (spinMs > 0) {
      return "spinning";
    }
    if (countdownSec <= 0) {
      return "waitingSpin";
    }
    return "betting";
  }

  private bootstrap(): void {
    this.bridge.subscribeEvent("wheel.timer", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return;
      }
      const payload = payloadRaw as { roundId?: unknown; hash?: unknown; countdownSec?: unknown };
      const countdownSec = asNumber(payload.countdownSec, this.state.countdownSec);
      this.patch({
        roundId: typeof payload.roundId === "string" ? payload.roundId : this.state.roundId,
        hash: typeof payload.hash === "string" ? payload.hash : this.state.hash,
        countdownSec,
        bettingPhase: this.resolveBettingPhase(countdownSec, this.state.spinMs),
      });
    });

    this.bridge.subscribeEvent("wheel.bets", (payloadRaw) => {
      this.applySnapshot(payloadRaw);
    });

    this.bridge.subscribeEvent("wheel.newRound", (payloadRaw) => {
      if (this.spinResetTimer !== null) {
        window.clearTimeout(this.spinResetTimer);
        this.spinResetTimer = null;
      }
      this.applySnapshot(payloadRaw);
      this.patch({
        resultColor: null,
        spinMs: 0,
        bettingPhase: "betting",
        status: "",
      });
    });

    this.bridge.subscribeEvent("wheel.slider", (payloadRaw) => {
      if (!payloadRaw || typeof payloadRaw !== "object") {
        return;
      }
      const payload = payloadRaw as {
        roundId?: unknown;
        hash?: unknown;
        resultColor?: unknown;
        resultAngle?: unknown;
        rotateDeg?: unknown;
      };
      const resultColor = asColor(payload.resultColor);
      const roundId = typeof payload.roundId === "string" ? payload.roundId : this.state.roundId;
      if (!resultColor) {
        return;
      }
      const targetByColor: Record<WheelColor, number> = {
        red: 19.7,
        black: 13.1,
        green: 6.5,
        yellow: 0,
      };
      const payloadRotate = asNumber(payload.rotateDeg, Number.NaN);
      const payloadAngle = asNumber(payload.resultAngle, Number.NaN);
      const fallbackAngle = Number.isFinite(payloadAngle) ? payloadAngle : targetByColor[resultColor];
      const baseTurns = Math.floor(this.state.rotationDeg / 360) * 360;
      const rotateDeg = Number.isFinite(payloadRotate)
        ? payloadRotate
        : Number((baseTurns + 1080 + fallbackAngle).toFixed(1));
      if (this.spinResetTimer !== null) {
        window.clearTimeout(this.spinResetTimer);
        this.spinResetTimer = null;
      }
      this.patch({
        roundId,
        hash: typeof payload.hash === "string" ? payload.hash : this.state.hash,
        resultColor,
        rotationDeg: rotateDeg,
        spinMs: 9000,
        bettingPhase: "spinning",
        status: "",
      });
      this.spinResetTimer = window.setTimeout(() => {
        this.spinResetTimer = null;
        this.patch({
          spinMs: 0,
          bettingPhase: this.resolveBettingPhase(this.state.countdownSec, 0),
          status: `Result: ${resultColor}`,
        });
      }, 9100);
    });

    this.bridge
      .ensureReady()
      .then(() => this.bridge.subscribeWheel())
      .then((snapshotRaw) => {
        this.applySnapshot(snapshotRaw);
      })
      .catch((error) => {
        this.patch({ status: toWsError(error).message });
      });
  }
}

let singleton: WheelStore | null = null;

export const getWheelStore = (): WheelStore => {
  if (!singleton) {
    singleton = new WheelStore();
  }
  return singleton;
};

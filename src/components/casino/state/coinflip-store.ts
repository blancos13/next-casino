"use client";

import { getCasinoBridge, toWsError } from "./casino-bridge";

export type CoinSide = "heads" | "tails";

const DEFAULT_AVATAR = "/img/no_avatar.jpg";
const RESOLVE_PREPARE_MS = 2_000;
const RESOLVE_SPIN_START_MS = 8_000;
const RESOLVE_REVEAL_MS = 15_000;
const RESOLVE_FINALIZE_MS = 20_000;
const RESOLVE_COUNTDOWN_START = 5;

export type CoinflipOpenGame = {
  id: string;
  creatorUserId: string;
  creatorUser: string;
  creatorAvatar: string;
  creatorSide: CoinSide;
  creatorTicketFrom: number;
  creatorTicketTo: number;
  amount: number;
  createdAt: number;
};

export type CoinflipEndedGame = {
  id: string;
  creatorUserId: string;
  creatorUser: string;
  creatorAvatar: string;
  joinerUserId: string;
  joinerUser: string;
  joinerAvatar: string;
  winnerUserId: string;
  winnerUser: string;
  winnerAvatar: string;
  creatorSide: CoinSide;
  resultSide: CoinSide;
  amount: number;
  payout: number;
  creatorTicketFrom: number;
  creatorTicketTo: number;
  joinerTicketFrom: number;
  joinerTicketTo: number;
  winnerTicket: number;
};

export type CoinflipResolvingPhase = "prepare" | "countdown" | "spinning" | "revealed";

export type CoinflipResolvingGame = CoinflipEndedGame & {
  phase: CoinflipResolvingPhase;
  countdownValue: number | null;
  sliderItems: string[];
};

type CoinflipStoreState = {
  openGames: CoinflipOpenGame[];
  resolvingGames: CoinflipResolvingGame[];
  endedGames: CoinflipEndedGame[];
  minBet: number;
  maxBet: number;
  status: string;
};

type ResolveFlowTimers = {
  countdownStartTimer: number;
  spinStartTimer: number;
  revealTimer: number;
  finalizeTimer: number;
  countdownInterval: number | null;
};

const DEFAULT_STATE: CoinflipStoreState = {
  openGames: [],
  resolvingGames: [],
  endedGames: [],
  minBet: 0.1,
  maxBet: 100,
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

const asSide = (value: unknown): CoinSide | null => {
  if (value === "heads" || value === "tails") {
    return value;
  }
  return null;
};

const asAvatar = (value: unknown): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return DEFAULT_AVATAR;
};

class CoinflipStore {
  private readonly bridge = getCasinoBridge();
  private readonly listeners = new Set<() => void>();
  private readonly knownEndedIds = new Set<string>();
  private readonly resolveTimers = new Map<string, ResolveFlowTimers>();
  private initialized = false;
  private state: CoinflipStoreState = DEFAULT_STATE;

  getSnapshot = (): CoinflipStoreState => this.state;

  getServerSnapshot = (): CoinflipStoreState => DEFAULT_STATE;

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

  async createGame(amount: number, side: CoinSide): Promise<boolean> {
    try {
      await this.bridge.ensureReady();
      const result = (await this.bridge.coinflipCreate({ amount, side })) as {
        game?: unknown;
      };
      const openGame = this.mapOpenGame(result.game);
      if (openGame) {
        this.upsertOpenGame(openGame);
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

  async joinGame(gameId: string): Promise<boolean> {
    try {
      await this.bridge.ensureReady();
      const result = (await this.bridge.coinflipJoin({ gameId })) as {
        result?: unknown;
      };
      const resolved = this.mapEndedGame(result.result);
      if (resolved) {
        this.removeOpenGame(resolved.id);
        this.startResolving(resolved);
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

  private patch(patch: Partial<CoinflipStoreState>): void {
    let hasChanges = false;
    for (const key of Object.keys(patch) as Array<keyof CoinflipStoreState>) {
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

  private mapOpenGame(raw: unknown): CoinflipOpenGame | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const payload = raw as {
      id?: unknown;
      creatorUserId?: unknown;
      creatorUsername?: unknown;
      creatorAvatar?: unknown;
      creatorSide?: unknown;
      creatorTicketFrom?: unknown;
      creatorTicketTo?: unknown;
      amount?: unknown;
      createdAt?: unknown;
    };
    const id = typeof payload.id === "string" ? payload.id : "";
    const creatorUserId = typeof payload.creatorUserId === "string" ? payload.creatorUserId : "";
    const creatorUsername = typeof payload.creatorUsername === "string" ? payload.creatorUsername.trim() : "";
    const creatorSide = asSide(payload.creatorSide);
    const amount = asNumber(payload.amount, 0);
    if (!id || !creatorUserId || !creatorSide || !creatorUsername) {
      return null;
    }
    const span = Math.max(1, Math.floor(amount * 100));
    const creatorTicketFrom = Math.max(1, Math.floor(asNumber(payload.creatorTicketFrom, 1)));
    const creatorTicketTo = Math.max(creatorTicketFrom, Math.floor(asNumber(payload.creatorTicketTo, creatorTicketFrom + span)));
    return {
      id,
      creatorUserId,
      creatorUser: creatorUsername,
      creatorAvatar: asAvatar(payload.creatorAvatar),
      creatorSide,
      creatorTicketFrom,
      creatorTicketTo,
      amount,
      createdAt: asNumber(payload.createdAt, Date.now()),
    };
  }

  private mapEndedGame(raw: unknown): CoinflipEndedGame | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const payload = raw as {
      gameId?: unknown;
      creatorUserId?: unknown;
      creatorUsername?: unknown;
      creatorAvatar?: unknown;
      joinerUserId?: unknown;
      joinerUsername?: unknown;
      joinerAvatar?: unknown;
      winnerUserId?: unknown;
      winnerUsername?: unknown;
      winnerAvatar?: unknown;
      creatorSide?: unknown;
      resultSide?: unknown;
      amount?: unknown;
      payout?: unknown;
      creatorTicketFrom?: unknown;
      creatorTicketTo?: unknown;
      joinerTicketFrom?: unknown;
      joinerTicketTo?: unknown;
      winnerTicket?: unknown;
    };
    const id = typeof payload.gameId === "string" ? payload.gameId : "";
    const creatorUserId = typeof payload.creatorUserId === "string" ? payload.creatorUserId : "";
    const creatorUsername = typeof payload.creatorUsername === "string" ? payload.creatorUsername.trim() : "";
    const joinerUserId = typeof payload.joinerUserId === "string" ? payload.joinerUserId : "";
    const joinerUsername = typeof payload.joinerUsername === "string" ? payload.joinerUsername.trim() : "";
    const winnerUserId = typeof payload.winnerUserId === "string" ? payload.winnerUserId : "";
    const winnerUsername = typeof payload.winnerUsername === "string" ? payload.winnerUsername.trim() : "";
    const creatorSide = asSide(payload.creatorSide);
    const resultSide = asSide(payload.resultSide);
    const amount = asNumber(payload.amount, 0);
    if (
      !id ||
      !creatorUserId ||
      !joinerUserId ||
      !winnerUserId ||
      !creatorSide ||
      !resultSide ||
      !creatorUsername ||
      !joinerUsername ||
      !winnerUsername
    ) {
      return null;
    }

    const span = Math.max(1, Math.floor(amount * 100));
    const creatorTicketFrom = Math.max(1, Math.floor(asNumber(payload.creatorTicketFrom, 1)));
    const creatorTicketTo = Math.max(creatorTicketFrom, Math.floor(asNumber(payload.creatorTicketTo, creatorTicketFrom + span)));
    const joinerTicketFrom = Math.max(creatorTicketTo + 1, Math.floor(asNumber(payload.joinerTicketFrom, creatorTicketTo + 1)));
    const joinerTicketTo = Math.max(joinerTicketFrom, Math.floor(asNumber(payload.joinerTicketTo, creatorTicketTo + span)));
    const winnerTicketRaw = Math.floor(asNumber(payload.winnerTicket, this.randomTicket(joinerTicketTo)));
    const winnerTicket = Math.min(Math.max(1, winnerTicketRaw), joinerTicketTo);
    const creatorAvatar = asAvatar(payload.creatorAvatar);
    const joinerAvatar = asAvatar(payload.joinerAvatar);
    const winnerAvatar =
      payload.winnerAvatar !== undefined
        ? asAvatar(payload.winnerAvatar)
        : winnerUserId === creatorUserId
          ? creatorAvatar
          : joinerAvatar;

    return {
      id,
      creatorUserId,
      creatorUser: creatorUsername,
      creatorAvatar,
      joinerUserId,
      joinerUser: joinerUsername,
      joinerAvatar,
      winnerUserId,
      winnerUser: winnerUsername,
      winnerAvatar,
      creatorSide,
      resultSide,
      amount,
      payout: asNumber(payload.payout, 0),
      creatorTicketFrom,
      creatorTicketTo,
      joinerTicketFrom,
      joinerTicketTo,
      winnerTicket,
    };
  }

  private upsertOpenGame(game: CoinflipOpenGame): void {
    const index = this.state.openGames.findIndex((item) => item.id === game.id);
    const next = [...this.state.openGames];
    if (index === -1) {
      next.unshift(game);
    } else {
      next[index] = game;
    }
    next.sort((a, b) => b.createdAt - a.createdAt);
    this.patch({ openGames: next });
  }

  private upsertResolvingGame(game: CoinflipResolvingGame): void {
    const index = this.state.resolvingGames.findIndex((item) => item.id === game.id);
    const next = [...this.state.resolvingGames];
    if (index === -1) {
      next.unshift(game);
    } else {
      next[index] = game;
    }
    this.patch({ resolvingGames: next });
  }

  private removeOpenGame(id: string): void {
    this.patch({
      openGames: this.state.openGames.filter((item) => item.id !== id),
    });
  }

  private removeResolvingGame(id: string): void {
    this.patch({
      resolvingGames: this.state.resolvingGames.filter((item) => item.id !== id),
    });
  }

  private updateResolvingGame(id: string, patch: Partial<CoinflipResolvingGame>): void {
    const index = this.state.resolvingGames.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
    const current = this.state.resolvingGames[index];
    const nextGame = { ...current, ...patch };
    if (Object.is(current, nextGame)) {
      return;
    }
    const next = [...this.state.resolvingGames];
    next[index] = nextGame;
    this.patch({ resolvingGames: next });
  }

  private pushEnded(game: CoinflipEndedGame): void {
    if (this.knownEndedIds.has(game.id)) {
      return;
    }
    this.knownEndedIds.add(game.id);
    this.patch({
      endedGames: [game, ...this.state.endedGames].slice(0, 40),
    });
  }

  private startResolving(game: CoinflipEndedGame): void {
    if (this.knownEndedIds.has(game.id)) {
      return;
    }
    const existing = this.state.resolvingGames.find((item) => item.id === game.id);
    if (!existing) {
      this.upsertResolvingGame({
        ...game,
        phase: "prepare",
        countdownValue: null,
        sliderItems: this.buildSliderItems(game),
      });
    }
    this.ensureResolveFlow(game.id);
  }

  private ensureResolveFlow(gameId: string): void {
    if (this.resolveTimers.has(gameId)) {
      return;
    }

    const flow: ResolveFlowTimers = {
      countdownStartTimer: window.setTimeout(() => {
        let countdownValue = RESOLVE_COUNTDOWN_START;
        this.updateResolvingGame(gameId, {
          phase: "countdown",
          countdownValue,
        });
        flow.countdownInterval = window.setInterval(() => {
          countdownValue -= 1;
          if (countdownValue >= 0) {
            this.updateResolvingGame(gameId, {
              phase: "countdown",
              countdownValue,
            });
          }
          if (countdownValue <= 0 && flow.countdownInterval !== null) {
            window.clearInterval(flow.countdownInterval);
            flow.countdownInterval = null;
          }
        }, 1000);
      }, RESOLVE_PREPARE_MS),
      spinStartTimer: window.setTimeout(() => {
        if (flow.countdownInterval !== null) {
          window.clearInterval(flow.countdownInterval);
          flow.countdownInterval = null;
        }
        this.updateResolvingGame(gameId, {
          phase: "spinning",
          countdownValue: null,
        });
      }, RESOLVE_SPIN_START_MS),
      revealTimer: window.setTimeout(() => {
        this.updateResolvingGame(gameId, {
          phase: "revealed",
          countdownValue: null,
        });
      }, RESOLVE_REVEAL_MS),
      finalizeTimer: window.setTimeout(() => {
        this.clearResolveFlow(gameId);
        const resolved = this.state.resolvingGames.find((item) => item.id === gameId);
        if (!resolved) {
          return;
        }
        this.removeResolvingGame(gameId);
        this.pushEnded(this.toEndedGame(resolved));
      }, RESOLVE_FINALIZE_MS),
      countdownInterval: null,
    };

    this.resolveTimers.set(gameId, flow);
  }

  private clearResolveFlow(gameId: string): void {
    const flow = this.resolveTimers.get(gameId);
    if (!flow) {
      return;
    }
    window.clearTimeout(flow.countdownStartTimer);
    window.clearTimeout(flow.spinStartTimer);
    window.clearTimeout(flow.revealTimer);
    window.clearTimeout(flow.finalizeTimer);
    if (flow.countdownInterval !== null) {
      window.clearInterval(flow.countdownInterval);
    }
    this.resolveTimers.delete(gameId);
  }

  private toEndedGame(game: CoinflipResolvingGame): CoinflipEndedGame {
    const {
      phase: _phase,
      countdownValue: _countdownValue,
      sliderItems: _sliderItems,
      ...ended
    } = game;
    return ended;
  }

  private buildSliderItems(game: CoinflipEndedGame): string[] {
    const list: string[] = [];
    for (let i = 0; i <= 50; i += 1) {
      list.push(game.creatorAvatar);
      list.push(game.joinerAvatar);
    }
    for (let i = list.length - 1; i > 0; i -= 1) {
      const index = Math.floor(Math.random() * (i + 1));
      const swap = list[i];
      list[i] = list[index] ?? DEFAULT_AVATAR;
      list[index] = swap ?? DEFAULT_AVATAR;
    }
    const normalized = list.slice(0, 110);
    while (normalized.length < 110) {
      normalized.push(normalized[0] ?? DEFAULT_AVATAR);
    }
    normalized[2] = game.winnerAvatar;
    return normalized;
  }

  private randomTicket(maxTicket: number): number {
    const max = Math.max(1, Math.floor(maxTicket));
    return Math.floor(Math.random() * max) + 1;
  }

  private bootstrap(): void {
    this.bridge.subscribeEvent("coinflip.created", (payload) => {
      const game = this.mapOpenGame(payload);
      if (!game) {
        return;
      }
      this.upsertOpenGame(game);
    });

    this.bridge.subscribeEvent("coinflip.resolved", (payload) => {
      const ended = this.mapEndedGame(payload);
      if (!ended) {
        return;
      }
      this.removeOpenGame(ended.id);
      this.startResolving(ended);
    });

    this.bridge
      .ensureReady()
      .then(() => this.bridge.subscribeCoinflip())
      .then((snapshotRaw) => {
        if (!snapshotRaw || typeof snapshotRaw !== "object") {
          return;
        }
        const snapshot = snapshotRaw as { openGames?: unknown; minBet?: unknown; maxBet?: unknown };
        if (!Array.isArray(snapshot.openGames)) {
          const minBet = asNumber(snapshot.minBet, this.state.minBet);
          const parsedMaxBet = asNumber(snapshot.maxBet, this.state.maxBet);
          const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;
          this.patch({ minBet, maxBet });
          return;
        }
        const minBet = asNumber(snapshot.minBet, this.state.minBet);
        const parsedMaxBet = asNumber(snapshot.maxBet, this.state.maxBet);
        const maxBet = parsedMaxBet < minBet ? minBet : parsedMaxBet;
        const resolvingIds = new Set(this.state.resolvingGames.map((item) => item.id));
        const openGames = snapshot.openGames
          .map((item) => this.mapOpenGame(item))
          .filter((item): item is CoinflipOpenGame => item !== null)
          .filter((item) => !resolvingIds.has(item.id));
        this.patch({ openGames, minBet, maxBet });
      })
      .catch((error) => {
        this.patch({ status: toWsError(error).message });
      });
  }
}

let singleton: CoinflipStore | null = null;

export const getCoinflipStore = (): CoinflipStore => {
  if (!singleton) {
    singleton = new CoinflipStore();
  }
  return singleton;
};

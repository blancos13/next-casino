"use client";

type WsEnvelopeRequest<T> = {
  type: string;
  requestId: string;
  ts: number;
  auth?: { accessToken: string };
  data: T;
};

type WsEnvelopeError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

type WsEnvelopeResponse<T> = {
  type: string;
  requestId: string;
  ok: boolean;
  serverTs: number;
  data?: T;
  error?: WsEnvelopeError;
  eventId?: string;
  stateVersion?: number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: WsEnvelopeError) => void;
  timeoutId: number;
};

type BalancePayload = {
  main?: unknown;
  bonus?: unknown;
  stateVersion?: unknown;
};

export type CasinoBridgeState = {
  connection: "idle" | "connecting" | "open" | "closed";
  isReady: boolean;
  isAuthenticated: boolean;
  username: string;
  userId: string;
  balanceMain: string;
  balanceBonus: string;
  stateVersion: number;
  lastError: string;
  authDialogOpen: boolean;
  authDialogTab: "login" | "register";
};

type AuthPayload = {
  user: {
    userId: string;
    username: string;
    roles: string[];
    sessionId?: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    expiresInSec: number;
  };
};

const STORAGE_KEYS = {
  accessToken: "win2x.accessToken",
  refreshToken: "win2x.refreshToken",
};

const WS_URL_FROM_ENV = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_WS_URL : undefined;

const resolveWsUrl = (): string => {
  if (WS_URL_FROM_ENV && WS_URL_FROM_ENV.trim().length > 0) {
    return WS_URL_FROM_ENV.trim();
  }
  if (typeof window === "undefined") {
    return "ws://localhost:8080/ws";
  }
  const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname || "localhost";
  return `${wsProto}://${host}:8080/ws`;
};

const DEFAULT_STATE: CasinoBridgeState = {
  connection: "idle",
  isReady: false,
  isAuthenticated: false,
  username: "",
  userId: "",
  balanceMain: "0.00",
  balanceBonus: "0.00",
  stateVersion: 0,
  lastError: "",
  authDialogOpen: false,
  authDialogTab: "login",
};

const makeRequestId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const toMoneyString = (value: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed.toFixed(2);
    }
  }
  return "0.00";
};

const asBalancePayload = (value: unknown): BalancePayload | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as BalancePayload;
};

export const toWsError = (error: unknown): WsEnvelopeError => {
  if (typeof error === "object" && error !== null) {
    const maybe = error as Partial<WsEnvelopeError>;
    if (typeof maybe.code === "string" && typeof maybe.message === "string") {
      return {
        code: maybe.code,
        message: maybe.message,
        retryable: Boolean(maybe.retryable),
        details: maybe.details,
      };
    }
  }
  return {
    code: "INTERNAL_ERROR",
    message: "Request failed",
    retryable: false,
  };
};

class CasinoBridge {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private readyPromise: Promise<void> | null = null;
  private reconnectTimer: number | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  private storeListeners = new Set<() => void>();
  private bootStarted = false;

  private accessToken = "";
  private refreshToken = "";
  private socketAuthenticated = false;

  private state: CasinoBridgeState = DEFAULT_STATE;

  getState = (): CasinoBridgeState => this.state;

  getServerSnapshot = (): CasinoBridgeState => DEFAULT_STATE;

  subscribeStore = (listener: () => void): (() => void) => {
    this.storeListeners.add(listener);

    if (typeof window !== "undefined" && !this.bootStarted) {
      this.bootStarted = true;
      window.setTimeout(() => {
        this.ensureReady().catch((error) => {
          this.patchState({ lastError: toWsError(error).message });
        });
      }, 0);
    }

    return () => {
      this.storeListeners.delete(listener);
    };
  };

  subscribeEvent(type: string, listener: (payload: unknown) => void): () => void {
    const listeners = this.eventListeners.get(type) ?? new Set<(payload: unknown) => void>();
    listeners.add(listener);
    this.eventListeners.set(type, listeners);
    return () => {
      const current = this.eventListeners.get(type);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.eventListeners.delete(type);
      }
    };
  }

  openAuthDialog(tab: "login" | "register" = "login"): void {
    this.patchState({
      authDialogOpen: true,
      authDialogTab: tab,
      lastError: "",
    });
  }

  closeAuthDialog(): void {
    this.patchState({ authDialogOpen: false });
  }

  async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = (async () => {
      await this.ensureConnected();
      await this.restoreAuthSession();
      if (this.state.isAuthenticated) {
        await this.refreshBalance();
      }
      await this.request("chat.subscribe", {}, { auth: false });
      this.patchState({ isReady: true, lastError: "" });
    })().catch((error) => {
      this.patchState({ lastError: toWsError(error).message });
      throw error;
    });

    return this.readyPromise;
  }

  async refreshBalance(): Promise<void> {
    if (!this.state.isAuthenticated) {
      return;
    }

    const balance = (await this.request("wallet.balance.get", {}, { auth: true })) as {
      main: string;
      bonus: string;
      stateVersion?: number;
    };

    this.patchBalance(asBalancePayload(balance));
  }

  async redeemPromo(code: string): Promise<unknown> {
    return this.request("promo.redeem", { code }, { auth: true });
  }

  async login(input: { username: string; password: string }): Promise<void> {
    const payload = (await this.request("auth.login", input, { auth: false })) as AuthPayload;
    this.applyAuthPayload(payload);
    await this.refreshBalance();
  }

  async register(input: { username: string; email?: string; password: string; refCode?: string }): Promise<void> {
    const payload = (await this.request("auth.register", input, { auth: false })) as AuthPayload;
    this.applyAuthPayload(payload);
    await this.refreshBalance();
  }

  async logout(): Promise<void> {
    if (!this.state.isAuthenticated) {
      return;
    }
    try {
      await this.request("auth.logout", {}, { auth: true });
    } finally {
      this.clearTokens();
      this.patchState({
        balanceMain: "0.00",
        balanceBonus: "0.00",
        authDialogOpen: false,
      });
    }
  }

  async diceBet(input: {
    amount: number;
    chance: number;
    direction: "under" | "over";
    clientSeed?: string;
  }): Promise<unknown> {
    const result = (await this.request("dice.bet", input, { auth: true })) as {
      balance?: { main?: unknown; bonus?: unknown; stateVersion?: unknown };
    };

    this.patchBalance(asBalancePayload(result.balance));

    return result;
  }

  async subscribeCrash(): Promise<unknown> {
    return this.request("crash.subscribe", {}, { auth: false });
  }

  async crashBet(input: { amount: number }): Promise<unknown> {
    const result = (await this.request("crash.bet", input, { auth: true })) as {
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance));
    return result;
  }

  async crashCashout(input?: { atMultiplier?: number }): Promise<unknown> {
    const result = (await this.request("crash.cashout", input ?? {}, { auth: true })) as {
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance));
    return result;
  }

  async subscribeJackpot(room: "easy" | "medium" | "hard"): Promise<unknown> {
    return this.request("jackpot.room.subscribe", { room }, { auth: false });
  }

  async jackpotBet(input: { amount: number; room: "easy" | "medium" | "hard" }): Promise<unknown> {
    const result = (await this.request("jackpot.bet", input, { auth: true })) as {
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance));
    return result;
  }

  async subscribeWheel(): Promise<unknown> {
    return this.request("wheel.subscribe", {}, { auth: false });
  }

  async wheelBet(input: { amount: number; color: "red" | "black" | "green" | "yellow" }): Promise<unknown> {
    const result = (await this.request("wheel.bet", input, { auth: true })) as {
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance));
    return result;
  }

  async subscribeCoinflip(): Promise<unknown> {
    return this.request("coinflip.subscribe", {}, { auth: false });
  }

  async coinflipCreate(input: { amount: number; side: "heads" | "tails" }): Promise<unknown> {
    const result = (await this.request("coinflip.create", input, { auth: true })) as {
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance));
    return result;
  }

  async coinflipJoin(input: { gameId: string }): Promise<unknown> {
    const result = (await this.request("coinflip.join", input, { auth: true })) as {
      joinBalance?: BalancePayload;
      winnerBalance?: BalancePayload;
      result?: { winnerUserId?: unknown };
    };
    const winnerUserId = typeof result.result?.winnerUserId === "string" ? result.result.winnerUserId : "";
    if (winnerUserId && winnerUserId === this.state.userId) {
      this.patchBalance(asBalancePayload(result.winnerBalance));
    } else {
      this.patchBalance(asBalancePayload(result.joinBalance));
    }
    return result;
  }

  async subscribeBattle(): Promise<unknown> {
    return this.request("battle.subscribe", {}, { auth: false });
  }

  async fairCheck(hash: string): Promise<unknown> {
    return this.request("fair.check", { hash: hash.trim() }, { auth: false });
  }

  async battleBet(input: { amount: number; team: "red" | "blue"; balance?: "balance" | "bonus" }): Promise<unknown> {
    const result = (await this.request("battle.bet", input, { auth: true })) as {
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance));
    return result;
  }

  async getBonusWheel(): Promise<unknown> {
    return this.request("bonus.getWheel", {}, { auth: false });
  }

  async spinBonus(): Promise<unknown> {
    const result = (await this.request("bonus.spin", {}, { auth: true })) as {
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance));
    return result;
  }

  async getAffiliateStats(): Promise<unknown> {
    return this.request("affiliate.stats", {}, { auth: true });
  }

  async claimAffiliate(): Promise<unknown> {
    const result = (await this.request("affiliate.claim", {}, { auth: true })) as {
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance));
    return result;
  }

  async getAdminOverview(): Promise<unknown> {
    return this.request("admin.overview", {}, { auth: true });
  }

  async getAdminUsers(input?: { page?: number; pageSize?: number; query?: string }): Promise<unknown> {
    return this.request(
      "admin.users.list",
      {
        page: input?.page ?? 1,
        pageSize: input?.pageSize ?? 20,
        query: input?.query ?? "",
      },
      { auth: true },
    );
  }

  async getAdminUser(userId: string): Promise<unknown> {
    return this.request("admin.user.get", { userId }, { auth: true });
  }

  async updateAdminUser(input: {
    userId: string;
    balance: number;
    bonus: number;
    role: "admin" | "moder" | "youtuber" | "user";
    ban: boolean;
    banReason?: string;
    chatBanUntil?: string | number | null;
    chatBanReason?: string;
  }): Promise<unknown> {
    return this.request("admin.user.update", input, { auth: true });
  }

  async getAdminBonuses(): Promise<unknown> {
    return this.request("admin.bonus.list", {}, { auth: true });
  }

  async createAdminBonus(input: {
    sum: number;
    type: "group" | "refs";
    bg: string;
    color: string;
    status: boolean;
  }): Promise<unknown> {
    return this.request("admin.bonus.create", input, { auth: true });
  }

  async updateAdminBonus(input: {
    id: string;
    sum: number;
    type: "group" | "refs";
    bg: string;
    color: string;
    status: boolean;
  }): Promise<unknown> {
    return this.request("admin.bonus.update", input, { auth: true });
  }

  async deleteAdminBonus(id: string): Promise<unknown> {
    return this.request("admin.bonus.delete", { id }, { auth: true });
  }

  async getAdminPromos(): Promise<unknown> {
    return this.request("admin.promo.list", {}, { auth: true });
  }

  async createAdminPromo(input: {
    code: string;
    type: "balance" | "bonus";
    limit: boolean;
    amount: number;
    countUse: number;
  }): Promise<unknown> {
    return this.request("admin.promo.create", input, { auth: true });
  }

  async updateAdminPromo(input: {
    id: string;
    code: string;
    type: "balance" | "bonus";
    limit: boolean;
    amount: number;
    countUse: number;
    active: boolean;
  }): Promise<unknown> {
    return this.request("admin.promo.update", input, { auth: true });
  }

  async deleteAdminPromo(id: string): Promise<unknown> {
    return this.request("admin.promo.delete", { id }, { auth: true });
  }

  async getAdminFilters(): Promise<unknown> {
    return this.request("admin.filter.list", {}, { auth: true });
  }

  async createAdminFilter(word: string): Promise<unknown> {
    return this.request("admin.filter.create", { word }, { auth: true });
  }

  async updateAdminFilter(input: { id: string; word: string }): Promise<unknown> {
    return this.request("admin.filter.update", input, { auth: true });
  }

  async deleteAdminFilter(id: string): Promise<unknown> {
    return this.request("admin.filter.delete", { id }, { auth: true });
  }

  async getAdminWithdraws(): Promise<unknown> {
    return this.request("admin.withdraws.list", {}, { auth: true });
  }

  async acceptAdminWithdraw(id: string, txHash: string): Promise<unknown> {
    const payload: { id: string; txHash: string } = { id, txHash: txHash.trim() };
    return this.request("admin.withdraw.accept", payload, { auth: true });
  }

  async returnAdminWithdraw(id: string, reason: string): Promise<unknown> {
    return this.request("admin.withdraw.return", { id, reason: reason.trim() }, { auth: true });
  }

  async getAdminWalletProviderConfig(): Promise<unknown> {
    return this.request("admin.wallet.providerConfig.get", {}, { auth: true });
  }
  async getAdminSettings(): Promise<unknown> {
    return this.request("admin.settings.get", {}, { auth: true });
  }

  async saveAdminSettings(input: {
    settings: Record<string, unknown>;
    rooms: Array<{
      id?: string;
      name: string;
      title?: string;
      time?: string | number;
      min?: string | number;
      max?: string | number;
      bets?: string | number;
    }>;
  }): Promise<unknown> {
    return this.request("admin.settings.save", input, { auth: true });
  }

  async saveAdminWalletProviderConfig(input: {
    provider?: "oxapay";
    deposit: {
      enabled: boolean;
      selections: Array<{ code: string; networks: string[] }>;
    };
    withdraw: {
      enabled: boolean;
      selections: Array<{ code: string; networks: string[] }>;
    };
  }): Promise<unknown> {
    return this.request("admin.wallet.providerConfig.save", input, { auth: true });
  }
  async walletDeposit(amount: number): Promise<unknown> {
    const result = (await this.request("wallet.deposit.request", { amount }, { auth: true })) as {
      main?: unknown;
      bonus?: unknown;
      stateVersion?: unknown;
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance ?? result));
    return result;
  }

  async walletGetDepositMethods(): Promise<unknown> {
    return this.request("wallet.deposit.methods", {}, { auth: true });
  }
  async walletGetWithdrawMethods(): Promise<unknown> {
    return this.request("wallet.withdraw.methods", {}, { auth: true });
  }

  async walletGetOrCreateStaticAddress(input: {
    provider: "oxapay";
    toCurrency: string;
    network: string;
  }): Promise<unknown> {
    return this.request("wallet.deposit.staticAddress", input, { auth: true });
  }

  // Backward compatible alias for older UI flows.
  async walletCreateDepositInvoice(input: {
    provider: "oxapay";
    payCurrency?: string;
    toCurrency?: string;
    network?: string;
  }): Promise<unknown> {
    return this.request(
      "wallet.deposit.staticAddress",
      {
        provider: input.provider,
        toCurrency: input.toCurrency ?? input.payCurrency ?? "USDT",
        network: input.network ?? "TRON",
      },
      { auth: true },
    );
  }

  async walletWithdraw(input: {
    amount: number;
    provider?: "oxapay";
    currency: string;
    network: string;
    address: string;
  }): Promise<unknown> {
    const result = (await this.request(
      "wallet.withdraw.request",
      {
        amount: input.amount,
        provider: input.provider ?? "oxapay",
        currency: input.currency,
        network: input.network,
        address: input.address,
      },
      { auth: true },
    )) as {
      main?: unknown;
      bonus?: unknown;
      stateVersion?: unknown;
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance ?? result));
    return result;
  }

  async walletExchange(input: { from: "main" | "bonus"; to: "main" | "bonus"; amount: number }): Promise<unknown> {
    const result = (await this.request("wallet.exchange", input, { auth: true })) as {
      main?: unknown;
      bonus?: unknown;
      stateVersion?: unknown;
      balance?: BalancePayload;
    };
    this.patchBalance(asBalancePayload(result.balance ?? result));
    return result;
  }

  async trackAffiliateVisit(input: { refCode: string; visitorId: string }): Promise<unknown> {
    return this.request("affiliate.visit", input, { auth: false });
  }

  async getDiceSnapshot(limit = 20): Promise<unknown> {
    return this.request("dice.snapshot.get", { limit }, { auth: false });
  }

  async subscribeDice(): Promise<unknown> {
    return this.request("dice.subscribe", {}, { auth: false });
  }

  async getChatHistory(limit = 50): Promise<unknown> {
    return this.request("chat.history", { limit }, { auth: false });
  }

  async getChatOnlineCount(): Promise<unknown> {
    return this.request("chat.online", {}, { auth: false });
  }

  async getChatUserCard(userId: string): Promise<unknown> {
    return this.request("chat.userCard", { userId }, { auth: false });
  }
  async sendChat(text: string): Promise<unknown> {
    return this.request("chat.send", { text }, { auth: true });
  }

  private patchState(patch: Partial<CasinoBridgeState>): void {
    let hasChanges = false;
    for (const key of Object.keys(patch) as Array<keyof CasinoBridgeState>) {
      if (!Object.is(this.state[key], patch[key])) {
        hasChanges = true;
        break;
      }
    }

    if (!hasChanges) {
      return;
    }

    this.state = { ...this.state, ...patch };
    for (const listener of this.storeListeners) {
      listener();
    }
  }

  private patchBalance(balance: BalancePayload | null): void {
    if (!balance) {
      return;
    }
    this.patchState({
      balanceMain: toMoneyString(balance.main),
      balanceBonus: toMoneyString(balance.bonus),
      stateVersion: typeof balance.stateVersion === "number" ? balance.stateVersion : this.state.stateVersion,
    });
  }

  private emitEvent(type: string, payload: unknown): void {
    const listeners = this.eventListeners.get(type);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(payload);
    }
  }

  private handleAuthError(error: WsEnvelopeError): void {
    if (error.code === "UNAUTHORIZED") {
      this.openAuthDialog("login");
    }
  }

  private async ensureConnected(): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.patchState({ connection: "connecting" });

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(resolveWsUrl());

      ws.onopen = () => {
        this.ws = ws;
        this.socketAuthenticated = false;
        this.patchState({ connection: "open", lastError: "" });
        resolve();
      };

      ws.onmessage = (event) => {
        this.handleWsMessage(event.data);
      };

      ws.onerror = () => {
        // handled by close + pending rejection
      };

      ws.onclose = () => {
        this.ws = null;
        this.socketAuthenticated = false;
        this.patchState({ connection: "closed" });
        this.rejectPendingRequests({
          code: "INTERNAL_ERROR",
          message: "WebSocket disconnected",
          retryable: true,
        });
        this.scheduleReconnect();
      };

      window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          try {
            ws.close();
          } catch {
            // noop
          }
          reject(new Error("WebSocket connect timeout"));
        }
      }, 8_000);
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private scheduleReconnect(): void {
    if (typeof window === "undefined") {
      return;
    }
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected()
        .then(() => this.restoreAuthSession())
        .then(() => {
          if (this.state.isAuthenticated) {
            return this.refreshBalance();
          }
          return undefined;
        })
        .catch((error) => {
          this.patchState({ lastError: toWsError(error).message });
        });
    }, 1500);
  }

  private handleWsMessage(raw: string | ArrayBuffer | Blob): void {
    if (typeof raw !== "string") {
      return;
    }

    let message: WsEnvelopeResponse<unknown>;
    try {
      message = JSON.parse(raw) as WsEnvelopeResponse<unknown>;
    } catch {
      return;
    }

    const pending = this.pendingRequests.get(message.requestId);
    if (pending) {
      window.clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(message.requestId);
      if (message.ok) {
        pending.resolve(message.data);
      } else {
        const error =
          message.error ?? {
            code: "INTERNAL_ERROR",
            message: "Unknown error",
            retryable: false,
          };
        this.handleAuthError(error);
        pending.reject(error);
      }
      return;
    }

    if (message.type === "wallet.balance.updated" && message.data && typeof message.data === "object") {
      const payload = message.data as { main?: unknown; bonus?: unknown; stateVersion?: unknown };
      this.patchState({
        balanceMain: toMoneyString(payload.main),
        balanceBonus: toMoneyString(payload.bonus),
        stateVersion:
          typeof payload.stateVersion === "number" ? payload.stateVersion : this.state.stateVersion,
      });
    }

    this.emitEvent(message.type, message.data);
  }

  private rejectPendingRequests(error: WsEnvelopeError): void {
    for (const pending of this.pendingRequests.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private async request<TData extends Record<string, unknown>, TResponse>(
    type: string,
    data: TData,
    options?: {
      auth?: boolean;
      timeoutMs?: number;
      skipAuthBootstrap?: boolean;
    },
  ): Promise<TResponse> {
    await this.ensureConnected();

    if (options?.auth && !options.skipAuthBootstrap && !this.socketAuthenticated) {
      await this.restoreAuthSession();
    }

    if (options?.auth && !this.socketAuthenticated && !this.accessToken) {
      const authError: WsEnvelopeError = {
        code: "UNAUTHORIZED",
        message: "Login required",
        retryable: false,
      };
      this.handleAuthError(authError);
      throw authError;
    }

    const requestId = makeRequestId();
    const payload: WsEnvelopeRequest<TData> = {
      type,
      requestId,
      ts: Date.now(),
      data,
    };

    if (options?.auth && !this.socketAuthenticated && this.accessToken) {
      payload.auth = {
        accessToken: this.accessToken,
      };
    }

    return new Promise<TResponse>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject({
          code: "INTERNAL_ERROR",
          message: "WebSocket is not connected",
          retryable: true,
        } as WsEnvelopeError);
        return;
      }

      const timeoutMs = options?.timeoutMs ?? 12_000;
      const timeoutId = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject({
          code: "TIMEOUT",
          message: `${type} timed out`,
          retryable: true,
        } as WsEnvelopeError);
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (value) => resolve(value as TResponse),
        reject: (error) => reject(error),
        timeoutId,
      });

      this.ws.send(JSON.stringify(payload));
    });
  }

  private async restoreAuthSession(): Promise<void> {
    this.loadSavedTokens();

    if (this.accessToken) {
      try {
        const me = (await this.request("auth.me", {}, { auth: true, skipAuthBootstrap: true })) as {
          userId: string;
          username: string;
          roles: string[];
        };
        this.patchState({
          isAuthenticated: true,
          username: me.username,
          userId: me.userId,
          lastError: "",
        });
        this.socketAuthenticated = true;
        return;
      } catch {
        this.clearTokens();
      }
    }

    if (this.refreshToken) {
      try {
        const refreshed = (await this.request(
          "auth.refresh",
          { refreshToken: this.refreshToken },
          { auth: false, skipAuthBootstrap: true },
        )) as AuthPayload;
        this.applyAuthPayload(refreshed);
        return;
      } catch {
        this.clearTokens();
      }
    }

    this.patchState({
      isAuthenticated: false,
      username: "",
      userId: "",
    });
  }

  private applyAuthPayload(payload: AuthPayload): void {
    this.accessToken = payload.tokens.accessToken;
    this.refreshToken = payload.tokens.refreshToken;

    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEYS.accessToken, this.accessToken);
      window.localStorage.setItem(STORAGE_KEYS.refreshToken, this.refreshToken);
    }

    this.patchState({
      isAuthenticated: true,
      username: payload.user.username,
      userId: payload.user.userId,
      authDialogOpen: false,
      authDialogTab: "login",
      lastError: "",
    });
    this.socketAuthenticated = true;
  }

  private clearTokens(): void {
    this.accessToken = "";
    this.refreshToken = "";
    this.socketAuthenticated = false;
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEYS.accessToken);
      window.localStorage.removeItem(STORAGE_KEYS.refreshToken);
    }
    this.patchState({
      isAuthenticated: false,
      username: "",
      userId: "",
    });
  }

  private loadSavedTokens(): void {
    if (typeof window === "undefined") {
      return;
    }
    if (!this.accessToken) {
      this.accessToken = window.localStorage.getItem(STORAGE_KEYS.accessToken) ?? "";
    }
    if (!this.refreshToken) {
      this.refreshToken = window.localStorage.getItem(STORAGE_KEYS.refreshToken) ?? "";
    }
  }
}

type GlobalWithCasinoBridge = typeof globalThis & {
  __win2xCasinoBridge?: CasinoBridge;
};

export const getCasinoBridge = (): CasinoBridge => {
  const globalScope = globalThis as GlobalWithCasinoBridge;
  if (!globalScope.__win2xCasinoBridge) {
    globalScope.__win2xCasinoBridge = new CasinoBridge();
  }
  return globalScope.__win2xCasinoBridge;
};

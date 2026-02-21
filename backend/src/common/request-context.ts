import type { Db, MongoClient } from "mongodb";
import type { Logger } from "pino";
import type { EventBus } from "../infra/events/event-bus";
import type { RequestLedgerService } from "../infra/idempotency/request-ledger";
import type { MongoLockManager } from "../infra/locks/mongo-lock";
import type { WsServerClient } from "../infra/ws/server";
import type { ValidWsRequest } from "../infra/ws/protocol";
import type { OutboxService } from "../infra/events/outbox";

export type AuthUser = {
  userId: string;
  username: string;
  roles: string[];
  sessionId?: string;
};

export type ServiceRegistry = {
  authService: {
    resolveAccessToken(token: string): Promise<AuthUser>;
  };
  walletService: {
    handleOxaPayWebhook(
      payload: Record<string, unknown>,
      rawBody: string,
      hmacHeader?: string | null,
    ): Promise<"credited" | "ignored" | "already">;
  } & Record<string, unknown>;
  promoService: unknown;
  diceService: unknown;
  crashService: unknown;
  jackpotService: unknown;
  wheelService: unknown;
  coinflipService: unknown;
  battleService: unknown;
  chatService: unknown;
  bonusService: unknown;
  adminService: unknown;
  profileService: unknown;
  affiliateService: unknown;
};

export type AppMetrics = {
  activeConnections: number;
  totalRequests: number;
  totalErrors: number;
  lockTimeouts: number;
  requestInProgress: number;
  txRollbacks: number;
};

export type AppContext = {
  logger: Logger;
  mongoClient: MongoClient;
  db: Db;
  eventBus: EventBus;
  outbox: OutboxService;
  requestLedger: RequestLedgerService;
  lockManager: MongoLockManager;
  services: ServiceRegistry;
  metrics: AppMetrics;
};

export type CommandContext = AppContext & {
  client: WsServerClient;
  request: ValidWsRequest;
  authUser: AuthUser | null;
  requireAuth(): AuthUser;
};

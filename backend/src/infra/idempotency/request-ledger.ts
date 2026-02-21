import type { Collection, Db } from "mongodb";
import { AppError } from "../../common/errors";

type RequestLedgerStatus = "processing" | "completed" | "failed";

export type StoredResponseSnapshot = {
  type: string;
  requestId: string;
  ok: boolean;
  serverTs: number;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
  eventId?: string;
  stateVersion?: number;
};

type RequestLedgerDoc = {
  userId: string;
  requestId: string;
  type: string;
  status: RequestLedgerStatus;
  response?: StoredResponseSnapshot;
  createdAt: Date;
  updatedAt: Date;
};

export type BeginRequestResult =
  | { kind: "new" }
  | { kind: "processing" }
  | { kind: "completed"; response: StoredResponseSnapshot };

export class RequestLedgerService {
  private readonly collection: Collection<RequestLedgerDoc>;

  constructor(db: Db) {
    this.collection = db.collection<RequestLedgerDoc>("request_ledger");
  }

  async begin(userId: string, requestId: string, type: string): Promise<BeginRequestResult> {
    const now = new Date();
    try {
      await this.collection.insertOne({
        userId,
        requestId,
        type,
        status: "processing",
        createdAt: now,
        updatedAt: now,
      });
      return { kind: "new" };
    } catch (error: unknown) {
      const mongoError = error as { code?: number };
      if (mongoError.code !== 11000) {
        throw error;
      }

      const existing = await this.collection.findOne({ userId, requestId });
      if (!existing) {
        throw new AppError("INTERNAL_ERROR", "Idempotency conflict without existing request");
      }
      if (existing.status === "completed" && existing.response) {
        return { kind: "completed", response: existing.response };
      }
      return { kind: "processing" };
    }
  }

  async complete(userId: string, requestId: string, response: StoredResponseSnapshot): Promise<void> {
    await this.collection.updateOne(
      { userId, requestId, status: "processing" },
      {
        $set: {
          status: "completed",
          response,
          updatedAt: new Date(),
        },
      },
    );
  }

  async fail(userId: string, requestId: string): Promise<void> {
    await this.collection.updateOne(
      { userId, requestId, status: "processing" },
      {
        $set: {
          status: "failed",
          updatedAt: new Date(),
        },
      },
    );
  }
}


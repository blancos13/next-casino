import { randomUUID } from "crypto";
import type { Collection, Db } from "mongodb";
import { AppError } from "../../common/errors";

type LockDoc = {
  _id: string;
  ownerId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type LockLease = {
  key: string;
  ownerId: string;
  expiresAt: Date;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetriableLockError = (error: unknown): boolean => {
  const mongoError = error as { code?: number; codeName?: string };
  return mongoError.code === 11000 || mongoError.code === 112 || mongoError.codeName === "WriteConflict";
};

const backoffMs = (attempt: number): number => {
  const base = Math.min(250, Math.floor(15 * Math.pow(1.35, attempt)));
  const jitter = Math.floor(Math.random() * 20);
  return base + jitter;
};

export class MongoLockManager {
  private readonly collection: Collection<LockDoc>;

  constructor(
    db: Db,
    private readonly defaultTtlMs: number,
    private readonly defaultWaitMs: number,
  ) {
    this.collection = db.collection<LockDoc>("locks");
  }

  async acquire(key: string, options?: { waitMs?: number; ttlMs?: number }): Promise<LockLease> {
    const waitMs = options?.waitMs ?? this.defaultWaitMs;
    const ttlMs = options?.ttlMs ?? this.defaultTtlMs;
    const ownerId = randomUUID();
    const deadline = Date.now() + waitMs;
    let attempt = 0;

    while (Date.now() <= deadline) {
      attempt += 1;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMs);

      try {
        // Fast path: claim an expired lock document without creating a new one.
        const takeover = await this.collection.findOneAndUpdate(
          {
            _id: key,
            expiresAt: { $lte: now },
          },
          {
            $set: {
              ownerId,
              expiresAt,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          {
            returnDocument: "after",
          },
        );

        if (takeover) {
          return { key, ownerId, expiresAt: takeover.expiresAt };
        }

        // Slow path: first acquisition when lock document does not exist yet.
        await this.collection.insertOne({
          _id: key,
          ownerId,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        });
        return { key, ownerId, expiresAt };
      } catch (error: unknown) {
        if (!isRetriableLockError(error)) {
          throw error;
        }
      }

      await sleep(backoffMs(attempt));
    }

    throw new AppError("LOCK_TIMEOUT", `Failed to acquire lock: ${key}`, { retryable: true });
  }

  async renew(lease: LockLease, ttlMs = this.defaultTtlMs): Promise<LockLease> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: lease.key,
        ownerId: lease.ownerId,
      },
      {
        $set: {
          expiresAt: new Date(Date.now() + ttlMs),
          updatedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
      },
    );

    if (!updated) {
      throw new AppError("LOCK_TIMEOUT", `Failed to renew lock: ${lease.key}`, { retryable: true });
    }

    return {
      key: updated._id,
      ownerId: updated.ownerId,
      expiresAt: updated.expiresAt,
    };
  }

  async release(lease: LockLease): Promise<void> {
    // Keep the lock document and only expire it. This avoids hot insert/delete churn
    // and reduces _id index write conflicts under contention.
    await this.collection.updateOne({
      _id: lease.key,
      ownerId: lease.ownerId,
    }, {
      $set: {
        expiresAt: new Date(0),
        updatedAt: new Date(),
      },
    });
  }
}

import { type Db, type MongoClient } from "mongodb";
import { AppError } from "../common/errors";
import { atomicFromDecimal, atomicToMoney } from "../common/money";
import type { OutboxService } from "../infra/events/outbox";
import type { MongoLockManager } from "../infra/locks/mongo-lock";
import type { WalletService } from "../wallet/wallet.service";
import { promoCodeCollection } from "./promocode.model";
import { promoRedemptionCollection } from "./promo-redemption.model";

export class PromoCodeService {
  constructor(
    private readonly db: Db,
    private readonly mongoClient: MongoClient,
    private readonly lockManager: MongoLockManager,
    private readonly walletService: WalletService,
    private readonly outbox: OutboxService,
  ) {}

  async redeem(userId: string, code: string, requestId?: string): Promise<{
    code: string;
    rewardType: "main" | "bonus";
    amount: number;
    balance: { main: string; bonus: string; stateVersion: number };
  }> {
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      throw new AppError("VALIDATION_ERROR", "Promo code is required");
    }

    const promoLock = await this.lockManager.acquire(`promo:${userId}:${normalizedCode}`);
    const walletLock = await this.lockManager.acquire(`wallet:${userId}`);
    const session = this.mongoClient.startSession();

    try {
      const result = await session.withTransaction(async () => {
        const now = new Date();
        const promo = await promoCodeCollection(this.db).findOne(
          {
            code: normalizedCode,
            active: true,
          },
          { session },
        );

        if (!promo) {
          throw new AppError("NOT_FOUND", "Promo code not found");
        }
        if (promo.startsAt && promo.startsAt > now) {
          throw new AppError("FORBIDDEN", "Promo code is not active yet");
        }
        if (promo.expiresAt && promo.expiresAt <= now) {
          throw new AppError("FORBIDDEN", "Promo code expired");
        }
        if (promo.currentRedemptions >= promo.maxRedemptions) {
          throw new AppError("FORBIDDEN", "Promo code limit reached");
        }

        try {
          await promoRedemptionCollection(this.db).insertOne(
            {
              promoCodeId: promo._id.toHexString(),
              userId,
              code: normalizedCode,
              amount: promo.rewardAmount,
              rewardType: promo.rewardType,
              requestId,
              createdAt: now,
            },
            { session },
          );
        } catch (error: unknown) {
          const mongoError = error as { code?: number };
          if (mongoError.code === 11000) {
            throw new AppError("CONFLICT", "Promo code already redeemed");
          }
          throw error;
        }

        await promoCodeCollection(this.db).updateOne(
          { _id: promo._id },
          {
            $inc: {
              currentRedemptions: 1,
            },
            $set: {
              updatedAt: now,
            },
          },
          { session },
        );

        const amountAtomic = atomicFromDecimal(promo.rewardAmount);
        const walletMutation = await this.walletService.applyMutationInSession(
          {
            userId,
            requestId,
            ledgerType: "promo",
            deltaMainAtomic: promo.rewardType === "main" ? amountAtomic : 0n,
            deltaBonusAtomic: promo.rewardType === "bonus" ? amountAtomic : 0n,
            metadata: {
              code: normalizedCode,
            },
          },
          session,
        );

        await this.outbox.append(
          {
            type: "promo.redeem.result",
            aggregateType: "promo",
            aggregateId: normalizedCode,
            version: walletMutation.stateVersion,
            userId,
            payload: {
              code: normalizedCode,
              rewardType: promo.rewardType,
              amount: atomicToMoney(amountAtomic),
              userId,
            },
          },
          session,
        );

        return {
          code: normalizedCode,
          rewardType: promo.rewardType,
          amount: atomicToMoney(amountAtomic),
          balance: {
            main: walletMutation.main,
            bonus: walletMutation.bonus,
            stateVersion: walletMutation.stateVersion,
          },
        };
      });

      if (!result) {
        throw new AppError("INTERNAL_ERROR", "Promo transaction failed");
      }
      return result;
    } finally {
      await session.endSession();
      await this.lockManager.release(walletLock);
      await this.lockManager.release(promoLock);
    }
  }
}


import type { Db } from "mongodb";
import { AppError } from "../common/errors";
import type { OutboxService } from "../infra/events/outbox";
import type { WalletService } from "../wallet/wallet.service";
import { bonusSpinCollection } from "./bonus-spin.model";
import type { BonusSector } from "./bonus.types";
import { moneyToAtomic } from "../common/money";

const BONUS_COOLDOWN_MS = 60 * 60 * 1000;

const sectors: BonusSector[] = [
  { id: "s1", label: "0.10", reward: 0.1, weight: 25 },
  { id: "s2", label: "0.25", reward: 0.25, weight: 20 },
  { id: "s3", label: "0.50", reward: 0.5, weight: 18 },
  { id: "s4", label: "1.00", reward: 1, weight: 14 },
  { id: "s5", label: "2.00", reward: 2, weight: 10 },
  { id: "s6", label: "5.00", reward: 5, weight: 8 },
  { id: "s7", label: "10.00", reward: 10, weight: 4 },
  { id: "s8", label: "25.00", reward: 25, weight: 1 },
];

const weightedPick = (): BonusSector => {
  const total = sectors.reduce((sum, sector) => sum + sector.weight, 0);
  const point = Math.random() * total;
  let cursor = 0;
  for (const sector of sectors) {
    cursor += sector.weight;
    if (point <= cursor) {
      return sector;
    }
  }
  return sectors[0]!;
};

export class BonusService {
  constructor(
    private readonly db: Db,
    private readonly walletService: WalletService,
    private readonly outbox: OutboxService,
  ) {}

  getWheel(): { sectors: BonusSector[]; cooldownMs: number } {
    return {
      sectors,
      cooldownMs: BONUS_COOLDOWN_MS,
    };
  }

  async spin(userId: string, requestId?: string): Promise<Record<string, unknown>> {
    const latest = await bonusSpinCollection(this.db).findOne(
      { userId },
      { sort: { createdAt: -1 } },
    );
    if (latest && Date.now() - latest.createdAt.getTime() < BONUS_COOLDOWN_MS) {
      const retryAt = latest.createdAt.getTime() + BONUS_COOLDOWN_MS;
      throw new AppError("CONFLICT", "Bonus cooldown is active", {
        details: { retryAt },
      });
    }

    const sector = weightedPick();
    const balance = await this.walletService.applyMutation({
      userId,
      requestId: requestId ? `${requestId}:bonus` : undefined,
      ledgerType: "promo",
      deltaMainAtomic: 0n,
      deltaBonusAtomic: moneyToAtomic(sector.reward),
      metadata: { game: "bonus", sectorId: sector.id },
    });

    await bonusSpinCollection(this.db).insertOne({
      userId,
      sectorId: sector.id,
      reward: sector.reward,
      requestId,
      createdAt: new Date(),
    });

    await this.outbox.append({
      type: "bonus.spin.anim",
      aggregateType: "bonus",
      aggregateId: sector.id,
      version: balance.stateVersion,
      userId,
      payload: {
        sectorId: sector.id,
      },
    });

    await this.outbox.append({
      type: "bonus.spin.result",
      aggregateType: "bonus",
      aggregateId: sector.id,
      version: balance.stateVersion,
      userId,
      payload: {
        sectorId: sector.id,
        reward: sector.reward,
        balance,
      },
    });

    return {
      sectorId: sector.id,
      reward: sector.reward,
      balance,
      nextAt: Date.now() + BONUS_COOLDOWN_MS,
    };
  }
}

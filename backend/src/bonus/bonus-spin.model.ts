import type { Collection, Db, ObjectId } from "mongodb";

export type BonusSpinDoc = {
  _id: ObjectId;
  userId: string;
  sectorId: string;
  reward: number;
  requestId?: string;
  createdAt: Date;
};

export const bonusSpinCollection = (db: Db): Collection<BonusSpinDoc> =>
  db.collection<BonusSpinDoc>("bonus_spins");


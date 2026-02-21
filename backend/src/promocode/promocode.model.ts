import type { Collection, Db, Decimal128, ObjectId } from "mongodb";

export type PromoCodeDoc = {
  _id: ObjectId;
  code: string;
  rewardType: "main" | "bonus";
  rewardAmount: Decimal128;
  maxRedemptions: number;
  currentRedemptions: number;
  startsAt?: Date;
  expiresAt?: Date;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const promoCodeCollection = (db: Db): Collection<PromoCodeDoc> =>
  db.collection<PromoCodeDoc>("promocodes");


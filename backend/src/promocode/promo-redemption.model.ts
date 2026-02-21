import type { Collection, Db, Decimal128, ObjectId } from "mongodb";

export type PromoRedemptionDoc = {
  _id: ObjectId;
  promoCodeId: string;
  userId: string;
  code: string;
  amount: Decimal128;
  rewardType: "main" | "bonus";
  requestId?: string;
  createdAt: Date;
};

export const promoRedemptionCollection = (db: Db): Collection<PromoRedemptionDoc> =>
  db.collection<PromoRedemptionDoc>("promo_redemptions");


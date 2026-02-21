import type { Collection, Db, ObjectId, Decimal128 } from "mongodb";

export type UserDoc = {
  _id: ObjectId;
  username: string;
  email?: string;
  passwordHash: string;
  roles: string[];
  unique_id?: string;
  affiliateCode?: string;
  referralCode?: string;
  referredBy?: string;
  ref_id?: string;
  ref_money?: Decimal128 | number | string;
  ref_money_all?: Decimal128 | number | string;
  link_trans?: number;
  link_reg?: number;
  referralTransitions?: number;
  referralRegistrations?: number;
  totalReferralIncome?: Decimal128 | number | string;
  availableReferralBalance?: Decimal128 | number | string;
  affiliateWallet?: Decimal128 | number | string | { USD?: Decimal128 | number | string };
  affiliateStats?: {
    totalReferred?: number;
    totalCommission?: Decimal128 | number | string;
    transitions?: number;
    clicks?: number;
    registrations?: number;
  };
  balances: {
    main: Decimal128;
    bonus: Decimal128;
  };
  stateVersion: number;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export const usersCollection = (db: Db): Collection<UserDoc> => db.collection<UserDoc>("users");

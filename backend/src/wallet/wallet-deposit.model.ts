import type { Collection, Db, Decimal128, ObjectId } from "mongodb";

export type WalletDepositStatus = "pending" | "paid" | "failed" | "expired";

export type WalletDepositDoc = {
  _id: ObjectId;
  userId: string;
  requestId?: string;
  provider: "oxapay";
  providerTrackId: string;
  paymentUrl: string;
  invoiceCurrency: string;
  payCurrency: string;
  requestedAmount: Decimal128;
  status: WalletDepositStatus;
  ledgerId?: string;
  paidAt?: Date;
  raw?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export const walletDepositsCollection = (db: Db): Collection<WalletDepositDoc> =>
  db.collection<WalletDepositDoc>("wallet_deposits");


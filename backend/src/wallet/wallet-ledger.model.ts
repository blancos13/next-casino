import type { Collection, Db, Decimal128, ObjectId } from "mongodb";

export type WalletLedgerDoc = {
  _id: ObjectId;
  userId: string;
  requestId?: string;
  type: "deposit" | "withdraw" | "exchange" | "game_bet" | "game_payout" | "promo";
  amountMain: Decimal128;
  amountBonus: Decimal128;
  balanceMainAfter: Decimal128;
  balanceBonusAfter: Decimal128;
  metadata?: Record<string, unknown>;
  createdAt: Date;
};

export const walletLedgerCollection = (db: Db): Collection<WalletLedgerDoc> =>
  db.collection<WalletLedgerDoc>("wallet_ledger");


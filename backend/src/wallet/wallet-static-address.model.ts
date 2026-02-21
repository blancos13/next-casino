import type { Collection, Db, ObjectId } from "mongodb";

export type WalletStaticAddressDoc = {
  _id: ObjectId;
  userId: string;
  provider: "oxapay";
  toCurrency: string;
  network: string;
  address: string;
  addressLc: string;
  trackId: string;
  callbackUrl?: string;
  autoWithdrawal: boolean;
  status: "active" | "revoked";
  raw?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export const walletStaticAddressesCollection = (db: Db): Collection<WalletStaticAddressDoc> =>
  db.collection<WalletStaticAddressDoc>("wallet_static_addresses");

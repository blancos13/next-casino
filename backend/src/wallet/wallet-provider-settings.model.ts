import type { Collection, Db, ObjectId } from "mongodb";

export type WalletProviderSelection = {
  code: string;
  networks: string[];
};

export type WalletProviderFlowConfig = {
  enabled: boolean;
  selections: WalletProviderSelection[];
};

export type WalletProviderSettingsDoc = {
  _id: ObjectId;
  provider: "oxapay";
  deposit: WalletProviderFlowConfig;
  withdraw: WalletProviderFlowConfig;
  createdAt: Date;
  updatedAt: Date;
};

export const walletProviderSettingsCollection = (db: Db): Collection<WalletProviderSettingsDoc> =>
  db.collection<WalletProviderSettingsDoc>("wallet_provider_settings");

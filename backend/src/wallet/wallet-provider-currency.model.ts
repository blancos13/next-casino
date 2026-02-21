import type { Collection, Db, ObjectId } from "mongodb";
import type { OxaPayCurrencyOption } from "./oxapay.client";

export type WalletProviderCurrencyCatalogDoc = {
  _id: ObjectId;
  provider: "oxapay";
  currencies: OxaPayCurrencyOption[];
  updatedAt: Date;
};

export const walletProviderCurrencyCatalogCollection = (db: Db): Collection<WalletProviderCurrencyCatalogDoc> =>
  db.collection<WalletProviderCurrencyCatalogDoc>("wallet_provider_currency_catalog");

import type { Collection, Db, Decimal128, ObjectId } from "mongodb";

export type CurrencyRateDoc = {
  _id: ObjectId;
  base: string;
  quote: string;
  rate: Decimal128;
  updatedAt: Date;
};

export const currencyRateCollection = (db: Db): Collection<CurrencyRateDoc> =>
  db.collection<CurrencyRateDoc>("currency_rates");


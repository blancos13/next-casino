import { Decimal128, type Db } from "mongodb";
import type { Logger } from "pino";
import { currencyRateCollection } from "./currency-rate.model";

const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price";
const DEFAULT_INTERVAL_MS = 60_000;

const SYMBOL_TO_COINGECKO: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  USDC: "usd-coin",
  BNB: "binancecoin",
  DOGE: "dogecoin",
  POL: "polygon-ecosystem-token",
  LTC: "litecoin",
  SOL: "solana",
  TRX: "tron",
  SHIB: "shiba-inu",
  TON: "toncoin",
  XMR: "monero",
  DAI: "dai",
  BCH: "bitcoin-cash",
  NOT: "notcoin",
  DOGS: "dogs",
};

const STATIC_USD_ONE = new Set<string>(["USDT", "USDC", "DAI"]);

export class CurrencyRateSyncService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
  ) {}

  async start(): Promise<void> {
    await this.syncOnce();
    this.timer = setInterval(() => {
      void this.syncOnce();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  async syncOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const now = new Date();
      const writes: Array<{
        updateOne: {
          filter: { base: string; quote: "USD" };
          update: {
            $set: { rate: Decimal128; updatedAt: Date };
          };
          upsert: true;
        };
      }> = [];

      for (const symbol of STATIC_USD_ONE) {
        writes.push({
          updateOne: {
            filter: { base: symbol, quote: "USD" },
            update: {
              $set: {
                rate: Decimal128.fromString("1"),
                updatedAt: now,
              },
            },
            upsert: true,
          },
        });
      }

      const ids = Array.from(new Set(Object.values(SYMBOL_TO_COINGECKO)));
      if (ids.length > 0) {
        const url = `${COINGECKO_API}?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd`;
        const response = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`CoinGecko request failed (${response.status})`);
        }
        const json = (await response.json()) as Record<string, { usd?: unknown }>;
        for (const [symbol, id] of Object.entries(SYMBOL_TO_COINGECKO)) {
          const usdValue = json[id]?.usd;
          const rate = Number(usdValue);
          if (!Number.isFinite(rate) || rate <= 0) {
            continue;
          }
          writes.push({
            updateOne: {
              filter: { base: symbol, quote: "USD" },
              update: {
                $set: {
                  rate: Decimal128.fromString(rate.toString()),
                  updatedAt: now,
                },
              },
              upsert: true,
            },
          });
        }
      }

      if (writes.length > 0) {
        await currencyRateCollection(this.db).bulkWrite(writes, { ordered: false });
      }

      this.logger.info(
        {
          module: "wallet.rates",
          intervalMs: this.intervalMs,
          updated: writes.length,
        },
        "Currency rates synced",
      );
    } catch (error) {
      this.logger.warn(
        {
          module: "wallet.rates",
          err: error,
        },
        "Currency rate sync failed",
      );
    } finally {
      this.running = false;
    }
  }
}

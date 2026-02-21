import { Decimal128, ObjectId, type ClientSession, type Db, type Document, type MongoClient } from "mongodb";
import { AppError, isAppError } from "../common/errors";
import {
atomicFromDecimal,
atomicToMoney,
decimalFromAtomic,
formatMoney,
moneyToAtomic,
} from "../common/money";
import type { OutboxService } from "../infra/events/outbox";
import type { MongoLockManager } from "../infra/locks/mongo-lock";
import { usersCollection } from "../user/user.model";
import { currencyRateCollection } from "./currency-rate.model";
import { walletLedgerCollection } from "./wallet-ledger.model";
import { walletProviderCurrencyCatalogCollection } from "./wallet-provider-currency.model";
import {
walletProviderSettingsCollection,
type WalletProviderFlowConfig,
type WalletProviderSelection,
} from "./wallet-provider-settings.model";
import { walletStaticAddressesCollection, type WalletStaticAddressDoc } from "./wallet-static-address.model";
import type { OxaPayClient, OxaPayCurrencyOption } from "./oxapay.client";
import type { WalletBalance, WalletMutationResult } from "./wallet.types";
type ParsedWebhookTx = {
id: string;
usdValue: number;
address?: string;
currency?: string;
network?: string;
raw: Record<string, unknown>;
};
const STABLE_USD_CURRENCIES = new Set<string>(["USDT", "USDC", "DAI"]);
const SETTINGS_CACHE_TTL_MS = 5_000;
const DEFAULT_WALLET_OPERATIONAL_SETTINGS = {
minDeposit: 0,
maxDeposit: 0,
minDepositForWithdraw: 0,
profitKoef: 1,
} as const;
const DEFAULT_PROVIDER_FLOW_SETTINGS: WalletProviderFlowConfig = {
enabled: true,
selections: [],
};
type WalletOperationalSettings = {
minDeposit: number;
maxDeposit: number;
minDepositForWithdraw: number;
profitKoef: number;
};
type WalletProviderRuntimeSettings = {
deposit: WalletProviderFlowConfig;
withdraw: WalletProviderFlowConfig;
};
export class WalletService {
private operationalSettings: WalletOperationalSettings = {
minDeposit: DEFAULT_WALLET_OPERATIONAL_SETTINGS.minDeposit,
maxDeposit: DEFAULT_WALLET_OPERATIONAL_SETTINGS.maxDeposit,
minDepositForWithdraw: DEFAULT_WALLET_OPERATIONAL_SETTINGS.minDepositForWithdraw,
profitKoef: DEFAULT_WALLET_OPERATIONAL_SETTINGS.profitKoef,
};
private operationalSettingsLoadedAt = 0;
private providerSettings: WalletProviderRuntimeSettings = {
deposit: { ...DEFAULT_PROVIDER_FLOW_SETTINGS },
withdraw: { ...DEFAULT_PROVIDER_FLOW_SETTINGS },
};
private providerSettingsLoadedAt = 0;
constructor(
private readonly db: Db,
private readonly mongoClient: MongoClient,
private readonly lockManager: MongoLockManager,
private readonly outbox: OutboxService,
private readonly oxapayClient: OxaPayClient,
) {}
  async getBalance(userId: string): Promise<WalletBalance> {
    const user = await usersCollection(this.db).findOne({ _id: new ObjectId(userId) });
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found");
    }
return {
main: formatMoney(atomicFromDecimal(user.balances.main)),
bonus: formatMoney(atomicFromDecimal(user.balances.bonus)),
stateVersion: user.stateVersion,
};
}
async getDepositMethods(): Promise<{
coinsPerUsd: number;
providers: Array<{
id: "oxapay";
title: string;
enabled: boolean;
reason?: string;
currencies: OxaPayCurrencyOption[];
}>;
}> {
return this.buildWalletMethodsResponse("deposit");
}
async getWithdrawMethods(): Promise<{
coinsPerUsd: number;
providers: Array<{
id: "oxapay";
title: string;
enabled: boolean;
reason?: string;
currencies: OxaPayCurrencyOption[];
}>;
}> {
return this.buildWalletMethodsResponse("withdraw");
}
async getOrCreateStaticAddress(
userId: string,
provider: "oxapay",
toCurrency: string,
network: string,
requestId?: string,
  ): Promise<{
provider: "oxapay";
toCurrency: string;
network: string;
address: string;
trackId: string;
callbackUrl?: string;
  }> {
    if (provider !== "oxapay") {
      throw new AppError("VALIDATION_ERROR", "Unsupported provider");
    }
    if (!this.oxapayClient.isConfigured()) {
      throw new AppError("CONFLICT", "OxaPay is not configured");
    }
    const users = usersCollection(this.db);
    const user = await users.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found");
    }
    const normalizedCurrency = toCurrency.trim().toUpperCase();
    const normalizedNetwork = network.trim();
    if (!normalizedCurrency || !normalizedNetwork) {
      throw new AppError("VALIDATION_ERROR", "toCurrency and network are required");
    }
    const methods = await this.getDepositMethods();
    const providerInfo = methods.providers[0];
    if (!providerInfo || !providerInfo.enabled) {
      throw new AppError("CONFLICT", providerInfo?.reason ?? "Deposit is currently unavailable");
    }
const currencyInfo = providerInfo.currencies.find((item) => item.code === normalizedCurrency);
const selectedNetwork = currencyInfo ? this.findNetworkOption(currencyInfo.networks, normalizedNetwork) : null;
if (selectedNetwork && !selectedNetwork.status) {
throw new AppError("VALIDATION_ERROR", `${selectedNetwork.id} network is currently unavailable`);
}
const selectedNetworkId = selectedNetwork?.id ?? normalizedNetwork;
const requestNetwork = selectedNetwork?.requestNetwork ?? normalizedNetwork;
const collection = walletStaticAddressesCollection(this.db);
const existing = await collection.findOne({
userId,
provider: "oxapay",
toCurrency: normalizedCurrency,
network: selectedNetworkId,
status: "active",
});
if (existing) {
if (!existing.addressLc) {
await collection.updateOne(
{ _id: existing._id },
{
$set: {
addressLc: existing.address.toLowerCase(),
updatedAt: new Date(),
},
},
);
}
return this.mapStaticAddress(existing);
}
const networkCandidates = this.buildNetworkCandidates(selectedNetwork, requestNetwork, selectedNetworkId);
const orderId = requestId ? `ws-${requestId}` : `dep-${userId}-${Date.now()}`;
const description = `deposit:${userId}:${normalizedCurrency}:${selectedNetworkId}`;
let created: Awaited<ReturnType<OxaPayClient["createStaticAddress"]>> | null = null;
let lastNetworkError: unknown = null;
for (const networkCandidate of networkCandidates) {
try {
created = await this.oxapayClient.createStaticAddress({
toCurrency: normalizedCurrency,
network: networkCandidate,
callbackUrl: undefined,
email: user.email,
orderId,
description,
});
break;
} catch (error) {
lastNetworkError = error;
if (this.shouldTryNextNetworkCandidate(error)) {
continue;
}
throw error;
}
}
    if (!created) {
      if (lastNetworkError) {
        throw lastNetworkError;
      }
      throw new AppError("CONFLICT", "Failed to create static address");
    }
const now = new Date();
const insertDoc: Omit<WalletStaticAddressDoc, "_id"> = {
userId,
provider: "oxapay",
toCurrency: normalizedCurrency,
network: selectedNetworkId,
address: created.address,
addressLc: created.address.toLowerCase(),
trackId: created.trackId,
callbackUrl: created.callbackUrl,
autoWithdrawal: this.oxapayClient.isStaticAutoWithdrawalEnabled(),
status: "active",
raw: created.raw,
createdAt: now,
updatedAt: now,
};
try {
await collection.insertOne(insertDoc);
return {
provider: "oxapay",
toCurrency: normalizedCurrency,
network: selectedNetworkId,
address: created.address,
trackId: created.trackId,
callbackUrl: created.callbackUrl,
};
} catch (error) {
if (isDuplicateKeyError(error)) {
const afterDuplicate = await collection.findOne({
userId,
provider: "oxapay",
toCurrency: normalizedCurrency,
network: selectedNetworkId,
status: "active",
});
if (afterDuplicate) {
return this.mapStaticAddress(afterDuplicate);
}
}
throw error;
}
}
async handleOxaPayWebhook(
payload: Record<string, unknown>,
rawBody: string,
hmacHeader?: string | null,
  ): Promise<"credited" | "ignored" | "already"> {
if (!this.oxapayClient.isConfigured()) {
return "ignored";
}
    if (!this.oxapayClient.verifyMerchantHmac(rawBody, hmacHeader)) {
      throw new AppError("FORBIDDEN", "Invalid webhook signature");
    }
const status = this.pickString([payload.status]).toLowerCase();
if (status !== "paid") {
return "ignored";
}
const type = this.pickString([payload.type]).toLowerCase();
if (type === "payout") {
return "ignored";
}
const staticAddress = await this.findStaticAddressForWebhook(payload);
if (!staticAddress) {
return "ignored";
}
const txs = this.parseWebhookTransactions(payload);
if (txs.length === 0) {
return "ignored";
}
const operationalSettings = await this.getOperationalSettings();
let credited = 0;
let already = 0;
for (const tx of txs) {
if (!Number.isFinite(tx.usdValue) || tx.usdValue <= 0) {
continue;
}
const coins = Number((tx.usdValue * this.oxapayClient.getCoinsPerUsd()).toFixed(6));
if (!Number.isFinite(coins) || coins <= 0) {
continue;
}
if (!this.isDepositAmountAllowed(coins, operationalSettings)) {
continue;
}
const requestId = `oxapay:static:${staticAddress.trackId}:${tx.id}`;
try {
await this.applyMutation({
userId: staticAddress.userId,
requestId,
ledgerType: "deposit",
deltaMainAtomic: moneyToAtomic(coins),
deltaBonusAtomic: 0n,
metadata: {
source: "oxapay_static",
trackId: staticAddress.trackId,
address: staticAddress.address,
toCurrency: staticAddress.toCurrency,
network: staticAddress.network,
usdValue: tx.usdValue,
coinsPerUsd: this.oxapayClient.getCoinsPerUsd(),
callbackType: type || "unknown",
callbackStatus: status,
tx: tx.raw,
},
});
credited += 1;
} catch (error) {
if (isDuplicateKeyError(error)) {
already += 1;
continue;
}
throw error;
}
}
await walletStaticAddressesCollection(this.db).updateOne(
{ _id: staticAddress._id },
{
$set: {
raw: payload,
updatedAt: new Date(),
},
},
);
if (credited > 0) {
return "credited";
}
if (already > 0) {
return "already";
}
return "ignored";
}
async deposit(userId: string, amount: number, requestId?: string): Promise<WalletMutationResult> {
const settings = await this.getOperationalSettings();
this.assertDepositAmountAllowed(amount, settings);
return this.applyMutation({
userId,
requestId,
ledgerType: "deposit",
deltaMainAtomic: moneyToAtomic(amount),
deltaBonusAtomic: 0n,
metadata: { source: "manual" },
});
}
async requestWithdraw(input: {
userId: string;
amount: number;
provider: "oxapay";
currency: string;
network: string;
address: string;
requestId?: string;
  }): Promise<
WalletMutationResult & {
withdraw: {
provider: "oxapay";
currency: string;
network: string;
address: string;
amountCoins: string;
amountUsd: string;
amountCrypto: string;
receiveCrypto: string;
rateUsd: string;
feeCrypto: string;
};
}
  > {
    if (input.provider !== "oxapay") {
      throw new AppError("VALIDATION_ERROR", "Unsupported provider");
    }
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError("VALIDATION_ERROR", "Withdraw amount must be greater than 0");
    }
const settings = await this.getOperationalSettings();
await this.assertWithdrawAllowed(input.userId, amount, settings);
    const normalizedCurrency = input.currency.trim().toUpperCase();
    const normalizedNetwork = input.network.trim();
    const normalizedAddress = input.address.trim();
    if (!normalizedCurrency || !normalizedNetwork || !normalizedAddress) {
      throw new AppError("VALIDATION_ERROR", "Currency, network and address are required");
    }
    const methods = await this.getWithdrawMethods();
    const providerInfo = methods.providers[0];
    if (!providerInfo || !providerInfo.enabled) {
      throw new AppError("CONFLICT", providerInfo?.reason ?? "Withdraw is currently unavailable");
    }
const currencyInfo = providerInfo.currencies.find((item) => item.code === normalizedCurrency);
if (!currencyInfo || !currencyInfo.status) {
throw new AppError("VALIDATION_ERROR", `Unsupported currency: ${normalizedCurrency}`);
}
const networkInfo = this.findNetworkOption(currencyInfo.networks, normalizedNetwork);
if (!networkInfo) {
throw new AppError("VALIDATION_ERROR", `Unsupported network: ${normalizedNetwork}`);
}
if (!networkInfo.status) {
throw new AppError("VALIDATION_ERROR", `${networkInfo.id} network is currently unavailable`);
}
const usdRate = await this.getUsdRate(normalizedCurrency);
if (!usdRate || usdRate <= 0) {
throw new AppError("CONFLICT", `Exchange rate is unavailable for ${normalizedCurrency}`);
}
const coinsPerUsd = this.oxapayClient.getCoinsPerUsd();
    const usdAmount = Number((amount / coinsPerUsd).toFixed(8));
    const cryptoAmount = Number((usdAmount / usdRate).toFixed(12));
    if (cryptoAmount <= 0) {
      throw new AppError("VALIDATION_ERROR", "Withdraw amount is below the minimum");
    }
    if (typeof networkInfo.withdrawMin === "number" && cryptoAmount < networkInfo.withdrawMin) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Minimum withdraw is ${networkInfo.withdrawMin} ${normalizedCurrency} on ${networkInfo.id}`,
      );
    }
    if (typeof networkInfo.withdrawMax === "number" && cryptoAmount > networkInfo.withdrawMax) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Maximum withdraw is ${networkInfo.withdrawMax} ${normalizedCurrency} on ${networkInfo.id}`,
      );
    }
    const feeCrypto = typeof networkInfo.withdrawFee === "number" ? networkInfo.withdrawFee : 0;
    const receiveCrypto = Number((cryptoAmount - feeCrypto).toFixed(12));
    if (receiveCrypto <= 0) {
      throw new AppError("VALIDATION_ERROR", "Withdraw amount is not enough to cover network fee");
    }
const result = await this.applyMutation({
userId: input.userId,
requestId: input.requestId,
ledgerType: "withdraw",
deltaMainAtomic: -moneyToAtomic(amount),
deltaBonusAtomic: 0n,
metadata: {
source: "withdraw_request",
adminStatus: "pending",
provider: "oxapay",
currency: normalizedCurrency,
network: networkInfo.id,
address: normalizedAddress,
amountCoins: amount,
amountUsd: usdAmount,
amountCrypto: cryptoAmount,
receiveCrypto,
rateUsd: usdRate,
feeCrypto,
},
});
return {
...result,
withdraw: {
provider: "oxapay",
currency: normalizedCurrency,
network: networkInfo.id,
address: normalizedAddress,
amountCoins: amount.toFixed(2),
amountUsd: usdAmount.toFixed(8),
amountCrypto: cryptoAmount.toFixed(12),
receiveCrypto: receiveCrypto.toFixed(12),
rateUsd: usdRate.toFixed(8),
feeCrypto: feeCrypto.toFixed(12),
},
};
}
async withdraw(userId: string, amount: number, requestId?: string): Promise<WalletMutationResult> {
return this.applyMutation({
userId,
requestId,
ledgerType: "withdraw",
deltaMainAtomic: -moneyToAtomic(amount),
deltaBonusAtomic: 0n,
metadata: { source: "manual" },
});
}
async exchange(
userId: string,
from: "main" | "bonus",
to: "main" | "bonus",
amount: number,
requestId?: string,
  ): Promise<WalletMutationResult> {
    if (from === to) {
      throw new AppError("VALIDATION_ERROR", "from and to wallets must be different");
    }
const atomic = moneyToAtomic(amount);
return this.applyMutation({
userId,
requestId,
ledgerType: "exchange",
deltaMainAtomic: from === "main" ? -atomic : atomic,
deltaBonusAtomic: from === "bonus" ? -atomic : atomic,
metadata: { from, to, rate: 1 },
});
}
async applyMutation(params: {
userId: string;
requestId?: string;
ledgerType: "deposit" | "withdraw" | "exchange" | "game_bet" | "game_payout" | "promo";
deltaMainAtomic: bigint;
deltaBonusAtomic: bigint;
metadata?: Record<string, unknown>;
}): Promise<WalletMutationResult> {
const lock = await this.lockManager.acquire(`wallet:${params.userId}`);
const session = this.mongoClient.startSession();
    try {
      const result = await session.withTransaction(async () => this.applyMutationInSession(params, session));
      if (!result) {
        throw new AppError("INTERNAL_ERROR", "Wallet mutation transaction failed");
      }
      return result;
} finally {
await session.endSession();
await this.lockManager.release(lock);
}
}
async applyMutationInSession(
params: {
userId: string;
requestId?: string;
ledgerType: "deposit" | "withdraw" | "exchange" | "game_bet" | "game_payout" | "promo";
deltaMainAtomic: bigint;
deltaBonusAtomic: bigint;
metadata?: Record<string, unknown>;
},
session: ClientSession,
): Promise<WalletMutationResult> {
const users = usersCollection(this.db);
const ledger = walletLedgerCollection(this.db);
    const user = await users.findOne({ _id: new ObjectId(params.userId) }, { session });
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found");
    }
const currentMain = atomicFromDecimal(user.balances.main);
const currentBonus = atomicFromDecimal(user.balances.bonus);
    const nextMain = currentMain + params.deltaMainAtomic;
    const nextBonus = currentBonus + params.deltaBonusAtomic;
    if (nextMain < 0n || nextBonus < 0n) {
      throw new AppError("INSUFFICIENT_BALANCE", "Insufficient balance");
    }
const nextVersion = user.stateVersion + 1;
await users.updateOne(
{ _id: user._id },
      {
        $set: {
          "balances.main": decimalFromAtomic(nextMain),
          "balances.bonus": decimalFromAtomic(nextBonus),
          stateVersion: nextVersion,
          updatedAt: new Date(),
        },
},
{ session },
);
const ledgerInsert = await ledger.insertOne(
{
userId: params.userId,
requestId: params.requestId,
type: params.ledgerType,
amountMain: decimalFromAtomic(params.deltaMainAtomic),
amountBonus: decimalFromAtomic(params.deltaBonusAtomic),
balanceMainAfter: decimalFromAtomic(nextMain),
balanceBonusAfter: decimalFromAtomic(nextBonus),
metadata: params.metadata,
createdAt: new Date(),
},
{ session },
);
await this.outbox.append(
{
type: "wallet.balance.updated",
aggregateType: "wallet",
aggregateId: params.userId,
version: nextVersion,
userId: params.userId,
payload: {
userId: params.userId,
main: atomicToMoney(nextMain),
bonus: atomicToMoney(nextBonus),
stateVersion: nextVersion,
deltaMain: atomicToMoney(params.deltaMainAtomic),
deltaBonus: atomicToMoney(params.deltaBonusAtomic),
type: params.ledgerType,
},
},
session,
);
return {
main: formatMoney(nextMain),
bonus: formatMoney(nextBonus),
stateVersion: nextVersion,
ledgerId: ledgerInsert.insertedId.toHexString(),
};
}
private async getOperationalSettings(force = false): Promise<WalletOperationalSettings> {
const now = Date.now();
if (!force && now - this.operationalSettingsLoadedAt < SETTINGS_CACHE_TTL_MS) {
return this.operationalSettings;
}
const settings = await this.db.collection<Document>("settings").findOne(
{},
{
sort: { id: 1, _id: 1 },
projection: {
min_dep: 1,
max_dep: 1,
min_dep_withdraw: 1,
profit_koef: 1,
},
},
);
const parseNonNegative = (value: unknown, fallback: number): number => {
const parsed = this.parseNumberish(value);
if (!Number.isFinite(parsed) || parsed < 0) {
return fallback;
}
return Number(parsed.toFixed(8));
};
this.operationalSettings = {
minDeposit: parseNonNegative(settings?.min_dep, DEFAULT_WALLET_OPERATIONAL_SETTINGS.minDeposit),
maxDeposit: parseNonNegative(settings?.max_dep, DEFAULT_WALLET_OPERATIONAL_SETTINGS.maxDeposit),
minDepositForWithdraw: parseNonNegative(
settings?.min_dep_withdraw,
DEFAULT_WALLET_OPERATIONAL_SETTINGS.minDepositForWithdraw,
),
profitKoef: parseNonNegative(settings?.profit_koef, DEFAULT_WALLET_OPERATIONAL_SETTINGS.profitKoef),
};
this.operationalSettingsLoadedAt = now;
return this.operationalSettings;
}
private assertDepositAmountAllowed(amount: number, settings: WalletOperationalSettings): void {
if (!this.isDepositAmountAllowed(amount, settings)) {
if (settings.minDeposit > 0 && amount < settings.minDeposit) {
throw new AppError("VALIDATION_ERROR", `Minimum deposit amount is ${settings.minDeposit.toFixed(2)} coins`);
}
if (settings.maxDeposit > 0 && amount > settings.maxDeposit) {
throw new AppError("VALIDATION_ERROR", `Maximum deposit amount is ${settings.maxDeposit.toFixed(2)} coins`);
}
}
}
private isDepositAmountAllowed(amount: number, settings: WalletOperationalSettings): boolean {
if (settings.minDeposit > 0 && amount < settings.minDeposit) {
return false;
}
if (settings.maxDeposit > 0 && amount > settings.maxDeposit) {
return false;
}
return true;
}
private async assertWithdrawAllowed(
userId: string,
amount: number,
settings: WalletOperationalSettings,
): Promise<void> {
if (settings.minDepositForWithdraw <= 0 && settings.profitKoef <= 0) {
return;
}
    const totals = await this.getUserDepositAndWithdrawTotals(userId);
    if (settings.minDepositForWithdraw > 0 && totals.deposited + 1e-8 < settings.minDepositForWithdraw) {
      throw new AppError(
        "CONFLICT",
        `Minimum total deposit required for withdraw is ${settings.minDepositForWithdraw.toFixed(2)} coins`,
        {
details: {
minDepositForWithdraw: settings.minDepositForWithdraw,
deposited: Number(totals.deposited.toFixed(2)),
},
},
);
}
    if (settings.profitKoef > 0) {
      const maxWithdrawAllowed = Number((totals.deposited * settings.profitKoef).toFixed(8));
      if (maxWithdrawAllowed > 0 && totals.withdrawn + amount - maxWithdrawAllowed > 1e-8) {
        throw new AppError(
          "CONFLICT",
          `Withdraw exceeds anti-minus limit (${settings.profitKoef.toFixed(2)}x deposits)`,
          {
details: {
deposited: Number(totals.deposited.toFixed(2)),
withdrawn: Number(totals.withdrawn.toFixed(2)),
requested: Number(amount.toFixed(2)),
maxWithdrawAllowed: Number(maxWithdrawAllowed.toFixed(2)),
},
},
);
}
}
}
private async getUserDepositAndWithdrawTotals(userId: string): Promise<{
deposited: number;
withdrawn: number;
}> {
const rows = await walletLedgerCollection(this.db)
.aggregate<{ _id: string; sum: unknown }>([
{
$match: {
userId,
$or: [
                { type: "deposit" },
                {
                  type: "withdraw",
                  "metadata.adminStatus": { $ne: "returned" },
                },
              ],
},
},
{
$group: {
_id: "$type",
sum: { $sum: "$amountMain" },
},
},
])
.toArray();
let deposited = 0;
let withdrawn = 0;
for (const row of rows) {
const sum = this.parseNumberish(row.sum);
if (!Number.isFinite(sum)) {
continue;
}
if (row._id === "deposit") {
deposited = Math.max(0, sum);
} else if (row._id === "withdraw") {
withdrawn = Math.abs(sum);
}
}
return {
deposited: Number(deposited.toFixed(8)),
withdrawn: Number(withdrawn.toFixed(8)),
};
}
private parseNumberish(value: unknown): number {
if (typeof value === "number") {
return Number.isFinite(value) ? value : NaN;
}
if (typeof value === "string") {
const parsed = Number(value);
return Number.isFinite(parsed) ? parsed : NaN;
}
if (value instanceof Decimal128) {
const parsed = Number(value.toString());
return Number.isFinite(parsed) ? parsed : NaN;
}
if (value && typeof value === "object" && typeof (value as { toString?: unknown }).toString === "function") {
const parsed = Number((value as { toString: () => string }).toString());
return Number.isFinite(parsed) ? parsed : NaN;
}
return NaN;
}
private async findStaticAddressForWebhook(payload: Record<string, unknown>): Promise<WalletStaticAddressDoc | null> {
const collection = walletStaticAddressesCollection(this.db);
const addressCandidates = this.extractAddressCandidates(payload);
for (const address of addressCandidates) {
const found =
(await collection.findOne({
provider: "oxapay",
addressLc: address.toLowerCase(),
status: "active",
})) ??
(await collection.findOne({
provider: "oxapay",
address,
status: "active",
}));
if (found) {
return found;
}
}
const trackId = this.pickString([payload.track_id, payload.trackId, payload.track]);
if (trackId) {
const foundByTrack = await collection.findOne({
provider: "oxapay",
trackId,
status: "active",
});
if (foundByTrack) {
return foundByTrack;
}
}
return null;
}
private parseWebhookTransactions(payload: Record<string, unknown>): ParsedWebhookTx[] {
const txsRaw = payload.txs;
const output: ParsedWebhookTx[] = [];
if (Array.isArray(txsRaw) && txsRaw.length > 0) {
txsRaw.forEach((txRaw, index) => {
if (!txRaw || typeof txRaw !== "object") {
return;
}
const tx = txRaw as Record<string, unknown>;
const txHash = this.pickString([tx.tx_hash, tx.txID, tx.hash, tx.id, tx.transaction_id]);
const txDate = this.pickString([tx.date, payload.date, Date.now()]);
const id = txHash || `tx-${txDate}-${index}`;
const txCurrency = this.pickString([tx.currency, tx.payCurrency]).toUpperCase();
const usdValue =
this.pickNumber([
tx.price,
tx.value,
tx.received_amount_usd,
tx.auto_convert_amount,
txCurrency === this.oxapayClient.getInvoiceCurrency() ? tx.received_amount : undefined,
payload.value,
]) ?? 0;
const address = this.pickString([tx.address, payload.address]);
const currency = this.pickString([tx.currency, payload.currency]);
const network = this.pickString([tx.network]);
output.push({
id,
usdValue,
address: address || undefined,
currency: currency || undefined,
network: network || undefined,
raw: tx,
});
});
}
if (output.length > 0) {
return output;
}
const payloadCurrency = this.pickString([payload.currency]).toUpperCase();
const fallbackUsd = this.pickNumber([
payload.price,
payload.value,
payload.payAmount,
payloadCurrency === this.oxapayClient.getInvoiceCurrency() ? payload.amount : undefined,
]);
if (!fallbackUsd || fallbackUsd <= 0) {
return [];
}
    const fallbackId =
      this.pickString([payload.track_id, payload.trackId, payload.track]) +
      ":" +
      this.pickString([payload.date, Date.now()]);
return [
{
id: fallbackId,
usdValue: fallbackUsd,
address: this.pickString([payload.address]) || undefined,
currency: this.pickString([payload.currency]) || undefined,
network: this.pickString([payload.network]) || undefined,
raw: payload,
},
];
}
private extractAddressCandidates(payload: Record<string, unknown>): string[] {
const candidates: string[] = [];
const push = (value: unknown) => {
if (typeof value === "string" && value.trim()) {
candidates.push(value.trim());
}
};
push(payload.address);
const txs = payload.txs;
if (Array.isArray(txs)) {
txs.forEach((txRaw) => {
if (!txRaw || typeof txRaw !== "object") {
return;
}
const tx = txRaw as Record<string, unknown>;
push(tx.address);
});
}
return Array.from(new Set(candidates));
}
private async getUsdRates(codes: string[]): Promise<Record<string, number | null>> {
const normalized = Array.from(
new Set(
codes
.map((code) => code.trim().toUpperCase())
.filter((code) => code.length > 0),
),
);
const output: Record<string, number | null> = {};
if (normalized.length === 0) {
return output;
}
const docs = await currencyRateCollection(this.db)
.find({
base: { $in: normalized },
quote: "USD",
})
.toArray();
for (const doc of docs) {
output[doc.base] = this.parseUsdRate(doc.rate);
}
for (const code of normalized) {
if (typeof output[code] === "number" && Number.isFinite(output[code])) {
continue;
}
output[code] = STABLE_USD_CURRENCIES.has(code) ? 1 : null;
}
return output;
}
private async buildWalletMethodsResponse(flow: "deposit" | "withdraw"): Promise<{
coinsPerUsd: number;
providers: Array<{
id: "oxapay";
title: string;
enabled: boolean;
reason?: string;
currencies: OxaPayCurrencyOption[];
}>;
}> {
const currencies = await this.loadProviderCurrencies();
const providerSettings = await this.getProviderSettings();
const flowSettings = flow === "deposit" ? providerSettings.deposit : providerSettings.withdraw;
const scopedCurrencies = this.applyProviderFlow(currencies, flowSettings);
const providerConfigured = this.oxapayClient.isConfigured();
const enabled = providerConfigured && flowSettings.enabled && scopedCurrencies.length > 0;
let reason: string | undefined;
if (!providerConfigured) {
reason = `Crypto ${flow} is temporarily unavailable`;
} else if (!flowSettings.enabled) {
reason = `${flow === "deposit" ? "Deposit" : "Withdraw"} is disabled by admin`;
} else if (scopedCurrencies.length === 0) {
reason = `No currencies enabled for ${flow}`;
}
return {
coinsPerUsd: this.oxapayClient.getCoinsPerUsd(),
providers: [
{
id: "oxapay",
title: "Crypto",
enabled,
reason,
currencies: scopedCurrencies,
},
],
};
}
private async loadProviderCurrencies(): Promise<OxaPayCurrencyOption[]> {
const cachedCurrencies = await this.loadCachedDepositCurrencies();
let currencies: OxaPayCurrencyOption[] = cachedCurrencies ?? this.oxapayClient.getDefaultCurrencies();
try {
const fetched = await this.oxapayClient.getAcceptedCurrencies();
if (fetched.length > 0) {
currencies = fetched;
await this.saveDepositCurrencies(fetched);
}
} catch {
// keep cached/fallback values if provider API is unavailable
}
const usdRates = await this.getUsdRates(currencies.map((item) => item.code));
return currencies.map((item) => ({
...item,
usdRate: usdRates[item.code] ?? null,
}));
}
private async loadCachedDepositCurrencies(): Promise<OxaPayCurrencyOption[] | null> {
const catalog = await walletProviderCurrencyCatalogCollection(this.db).findOne({ provider: "oxapay" });
if (!catalog || !Array.isArray(catalog.currencies) || catalog.currencies.length === 0) {
return null;
}
return catalog.currencies;
}
private async saveDepositCurrencies(currencies: OxaPayCurrencyOption[]): Promise<void> {
await walletProviderCurrencyCatalogCollection(this.db).updateOne(
{ provider: "oxapay" },
{
$set: {
provider: "oxapay",
currencies,
updatedAt: new Date(),
},
},
{ upsert: true },
);
}
private async getUsdRate(code: string): Promise<number | null> {
const normalized = code.trim().toUpperCase();
if (!normalized) {
return null;
}
if (STABLE_USD_CURRENCIES.has(normalized)) {
return 1;
}
const doc = await currencyRateCollection(this.db).findOne({
base: normalized,
quote: "USD",
});
if (!doc) {
return null;
}
return this.parseUsdRate(doc.rate);
}
private async getProviderSettings(force = false): Promise<WalletProviderRuntimeSettings> {
const now = Date.now();
if (!force && now - this.providerSettingsLoadedAt < SETTINGS_CACHE_TTL_MS) {
return this.providerSettings;
}
const collection = walletProviderSettingsCollection(this.db);
const row = await collection.findOne({ provider: "oxapay" });
const deposit = this.normalizeProviderFlowConfig(row?.deposit);
const withdraw = this.normalizeProviderFlowConfig(row?.withdraw);
if (!row) {
const createdAt = new Date();
await collection.updateOne(
{ provider: "oxapay" },
{
$setOnInsert: {
provider: "oxapay",
deposit,
withdraw,
createdAt,
},
$set: {
updatedAt: createdAt,
},
},
{ upsert: true },
);
}
this.providerSettings = { deposit, withdraw };
this.providerSettingsLoadedAt = now;
return this.providerSettings;
}
private normalizeProviderFlowConfig(raw: unknown): WalletProviderFlowConfig {
const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
const enabled = row.enabled === false || row.enabled === 0 || row.enabled === "0" ? false : true;
const rawSelections = Array.isArray(row.selections) ? row.selections : [];
const dedupe = new Map<string, WalletProviderSelection>();
for (const item of rawSelections) {
if (!item || typeof item !== "object") {
continue;
}
const selection = item as Record<string, unknown>;
const code = typeof selection.code === "string" ? selection.code.trim().toUpperCase() : "";
if (!code) {
continue;
}
const rawNetworks = Array.isArray(selection.networks) ? selection.networks : [];
const networks = Array.from(
new Set(
rawNetworks
.map((network) => (typeof network === "string" ? network.trim() : ""))
.filter((network) => network.length > 0),
),
);
dedupe.set(code, { code, networks });
}
return {
enabled,
selections: Array.from(dedupe.values()).sort((left, right) => left.code.localeCompare(right.code)),
};
}
private applyProviderFlow(
currencies: OxaPayCurrencyOption[],
flow: WalletProviderFlowConfig,
): OxaPayCurrencyOption[] {
const selectionMap = new Map(flow.selections.map((item) => [item.code, item]));
    if (selectionMap.size === 0) {
      return [];
    }
    const output: OxaPayCurrencyOption[] = [];
    for (const currency of currencies) {
      const selection = selectionMap.get(currency.code);
      if (!selection) {
        continue;
      }
      const networks = this.filterCurrencyNetworksBySelection(currency.networks, selection.networks, "whitelist");
      if (networks.length === 0) {
        continue;
      }
      output.push({
        ...currency,
        networks,
      });
    }
    return output;
}
private filterCurrencyNetworksBySelection(
networks: OxaPayCurrencyOption["networks"],
selectedNetworks: string[],
mode: "whitelist" | "blacklist",
): OxaPayCurrencyOption["networks"] {
if (selectedNetworks.length === 0) {
return mode === "whitelist" ? networks : [];
}
const selected = selectedNetworks.map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0);
const matchesSelection = (network: OxaPayCurrencyOption["networks"][number]): boolean => {
const tokens = new Set<string>();
tokens.add(network.id.trim().toLowerCase());
tokens.add(network.requestNetwork.trim().toLowerCase());
for (const alias of network.aliases) {
const token = alias.trim().toLowerCase();
if (token) {
tokens.add(token);
}
}
for (const candidate of selected) {
if (tokens.has(candidate)) {
return true;
}
}
return false;
};
if (mode === "whitelist") {
return networks.filter(matchesSelection);
}
return networks.filter((network) => !matchesSelection(network));
}
private parseUsdRate(value: { toString(): string }): number | null {
const parsed = Number(value.toString());
if (!Number.isFinite(parsed) || parsed <= 0) {
return null;
}
return parsed;
}
private findNetworkOption(
networks: OxaPayCurrencyOption["networks"],
networkInput: string,
): OxaPayCurrencyOption["networks"][number] | null {
const needle = networkInput.trim().toLowerCase();
if (!needle) {
return null;
}
for (const network of networks) {
if (network.id.trim().toLowerCase() === needle) {
return network;
}
if (network.requestNetwork.trim().toLowerCase() === needle) {
return network;
}
const aliasMatch = network.aliases.some((alias) => alias.trim().toLowerCase() === needle);
if (aliasMatch) {
return network;
}
}
return null;
}
private mapStaticAddress(doc: WalletStaticAddressDoc): {
provider: "oxapay";
toCurrency: string;
network: string;
address: string;
trackId: string;
callbackUrl?: string;
} {
return {
provider: "oxapay",
toCurrency: doc.toCurrency,
network: doc.network,
address: doc.address,
trackId: doc.trackId,
callbackUrl: doc.callbackUrl,
};
}
private buildNetworkCandidates(
selectedNetwork: OxaPayCurrencyOption["networks"][number] | null,
requestNetwork: string,
selectedNetworkId: string,
): string[] {
const candidates = new Set<string>();
const push = (value: string) => {
const trimmed = value.trim();
if (!trimmed) {
return;
}
candidates.add(trimmed);
candidates.add(trimmed.toUpperCase());
};
push(requestNetwork);
push(selectedNetworkId);
if (selectedNetwork) {
push(selectedNetwork.id);
push(selectedNetwork.requestNetwork);
for (const alias of selectedNetwork.aliases) {
push(alias);
}
}
return Array.from(candidates.values());
}
private shouldTryNextNetworkCandidate(error: unknown): boolean {
if (!isAppError(error)) {
return false;
}
if (error.code !== "CONFLICT") {
return false;
}
const status = Number(error.details?.status);
return Number.isFinite(status) && status === 400;
}
private pickString(values: unknown[]): string {
for (const value of values) {
if (typeof value === "string" && value.trim()) {
return value.trim();
}
if (typeof value === "number" && Number.isFinite(value)) {
return String(value);
}
}
return "";
}
private pickNumber(values: unknown[]): number | null {
for (const value of values) {
const numeric = Number(value);
if (Number.isFinite(numeric) && numeric > 0) {
return Number(numeric.toFixed(6));
}
}
return null;
}
}
const isDuplicateKeyError = (error: unknown): boolean => {
if (!error || typeof error !== "object") {
return false;
}
const candidate = error as { code?: unknown };
return candidate.code === 11000;
};

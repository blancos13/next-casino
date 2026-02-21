import { Decimal128, ObjectId, type Db, type Document } from "mongodb";
import { AppError } from "../common/errors";
import { moneyToAtomic } from "../common/money";
import type { WalletService } from "../wallet/wallet.service";
import { usersCollection, type UserDoc } from "./user.model";

const DEFAULT_MIN_AFFILIATE_WITHDRAW = 1;
const DEFAULT_REFERRAL_WIN_PERCENT = 10;
const DEFAULT_REFERRAL_SIGNUP_BONUS = 1;
const SETTINGS_CACHE_TTL_MS = 5_000;

type AffiliateSettings = {
  minWithdraw: number;
  referralWinPercent: number;
  referralSignupBonus: number;
};

const toFiniteNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value instanceof Decimal128) {
    const parsed = Number.parseFloat(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if ("USD" in objectValue) {
      return toFiniteNumber(objectValue.USD);
    }
    if ("amount" in objectValue) {
      return toFiniteNumber(objectValue.amount);
    }
    if ("value" in objectValue) {
      return toFiniteNumber(objectValue.value);
    }
  }
  return 0;
};

const toSafeInt = (value: unknown): number => {
  const parsed = Math.floor(toFiniteNumber(value));
  return parsed > 0 ? parsed : 0;
};

const pickFirstString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return "";
};

const normalizeMoney = (value: number): number => {
  return Number(Math.max(0, value).toFixed(2));
};

const normalizeRefCode = (value: string): string => value.trim().toUpperCase();
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const caseInsensitiveEq = (value: string): RegExp => new RegExp(`^${escapeRegex(value)}$`, "i");
const buildFallbackRefCode = (userId: ObjectId): string => userId.toHexString().slice(0, 8).toUpperCase();

const countByRef = async (db: Db, codeCandidates: string[]): Promise<number> => {
  const candidates = codeCandidates.map((value) => value.trim()).filter((value) => value.length > 0);
  if (candidates.length === 0) {
    return 0;
  }
  const candidateMatchers = candidates.map((value) => caseInsensitiveEq(value));

  return db.collection("users").countDocuments({
    $or: [
      { referredBy: { $in: candidateMatchers } },
      { ref_id: { $in: candidateMatchers } },
    ],
  });
};

type AffiliateStatsResponse = {
  refCode: string;
  totalIncome: number;
  transitions: number;
  registrations: number;
  availableBalance: number;
  minWithdraw: number;
  referralWinPercent: number;
  referralSignupBonus: number;
};

export class AffiliateService {
  private cachedSettings: AffiliateSettings = {
    minWithdraw: DEFAULT_MIN_AFFILIATE_WITHDRAW,
    referralWinPercent: DEFAULT_REFERRAL_WIN_PERCENT,
    referralSignupBonus: DEFAULT_REFERRAL_SIGNUP_BONUS,
  };

  private settingsLoadedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly walletService: WalletService,
  ) {}

  async getStats(userId: string): Promise<AffiliateStatsResponse> {
    const user = await usersCollection(this.db).findOne({ _id: new ObjectId(userId) });
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found");
    }

    return this.buildStats(user);
  }

  async trackVisit(input: { refCode: string; visitorId: string }): Promise<{ tracked: boolean }> {
    const refCode = normalizeRefCode(input.refCode);
    const visitorId = input.visitorId.trim();
    if (!refCode || !visitorId) {
      return { tracked: false };
    }

    const referrer = await this.resolveReferrerByCode(refCode);
    if (!referrer) {
      return { tracked: false };
    }

    const visits = this.db.collection("affiliate_visits");
    const result = await visits.updateOne(
      {
        referrerId: referrer._id.toHexString(),
        visitorId,
      },
      {
        $setOnInsert: {
          refCode,
          referrerId: referrer._id.toHexString(),
          visitorId,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    if (result.upsertedCount > 0) {
      await usersCollection(this.db).updateOne(
        { _id: referrer._id },
        {
          $inc: {
            link_trans: 1,
            "affiliateStats.transitions": 1,
            "affiliateStats.clicks": 1,
          },
          $set: {
            updatedAt: new Date(),
          },
        },
      );
      return { tracked: true };
    }

    return { tracked: false };
  }

  async claim(userId: string, requestId?: string): Promise<{
    claimed: string;
    availableBalance: number;
    balance: {
      main: string;
      bonus: string;
      stateVersion: number;
      ledgerId: string;
    };
  }> {
    const user = await usersCollection(this.db).findOne({ _id: new ObjectId(userId) });
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found");
    }

    const settings = await this.getSettings();
    const stats = await this.buildStats(user);
    const claimAmount = normalizeMoney(stats.availableBalance);
    if (claimAmount <= 0) {
      throw new AppError("CONFLICT", "No referral balance to claim");
    }
    if (stats.availableBalance < settings.minWithdraw) {
      throw new AppError(
        "CONFLICT",
        `Minimum withdrawal amount ${settings.minWithdraw.toFixed(2)} coins`,
        {
          details: { minWithdraw: settings.minWithdraw },
        },
      );
    }

    const balance = await this.walletService.applyMutation({
      userId,
      requestId: requestId ? `${requestId}:affiliate.claim` : undefined,
      ledgerType: "promo",
      deltaMainAtomic: moneyToAtomic(claimAmount),
      deltaBonusAtomic: 0n,
      metadata: {
        source: "affiliate",
        refCode: stats.refCode,
      },
    });

    await usersCollection(this.db).updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          ref_money: Decimal128.fromString("0"),
          affiliateWallet: 0,
          availableReferralBalance: 0,
          updatedAt: new Date(),
        },
      },
    );

    return {
      claimed: claimAmount.toFixed(2),
      availableBalance: 0,
      balance,
    };
  }

  async creditFromReferralWin(input: {
    winnerUserId: string;
    winAmount: number;
    eventKey?: string;
    context?: Record<string, unknown>;
  }): Promise<{ credited: boolean; amount: number }> {
    const normalizedWinAmount = normalizeMoney(input.winAmount);
    if (normalizedWinAmount <= 0) {
      return { credited: false, amount: 0 };
    }

    const winner = await usersCollection(this.db).findOne({ _id: new ObjectId(input.winnerUserId) });
    if (!winner) {
      return { credited: false, amount: 0 };
    }

    const referrer = await this.resolveReferrerForWinner(winner);
    if (!referrer || referrer._id.equals(winner._id)) {
      return { credited: false, amount: 0 };
    }

    const settings = await this.getSettings();
    const commission = normalizeMoney((normalizedWinAmount * settings.referralWinPercent) / 100);
    if (commission <= 0) {
      return { credited: false, amount: 0 };
    }

    const eventKey = typeof input.eventKey === "string" ? input.eventKey.trim() : "";
    if (eventKey) {
      const marker = await this.db.collection("affiliate_earnings").updateOne(
        { eventKey },
        {
          $setOnInsert: {
            eventKey,
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
      if (marker.upsertedCount === 0) {
        return { credited: false, amount: 0 };
      }
    }

    const nextRefMoney = normalizeMoney(toFiniteNumber(referrer.ref_money) + commission);
    const nextRefMoneyAll = normalizeMoney(toFiniteNumber(referrer.ref_money_all) + commission);
    const nextTotalCommission = normalizeMoney(
      toFiniteNumber(referrer.affiliateStats?.totalCommission) + commission,
    );

    await usersCollection(this.db).updateOne(
      { _id: referrer._id },
      {
        $set: {
          ref_money: Decimal128.fromString(nextRefMoney.toFixed(2)),
          ref_money_all: Decimal128.fromString(nextRefMoneyAll.toFixed(2)),
          availableReferralBalance: Decimal128.fromString(nextRefMoney.toFixed(2)),
          "affiliateStats.totalCommission": Decimal128.fromString(nextTotalCommission.toFixed(2)),
          updatedAt: new Date(),
        },
      },
    );

    if (eventKey) {
      await this.db.collection("affiliate_earnings").updateOne(
        { eventKey },
        {
          $set: {
            referrerId: referrer._id.toHexString(),
            winnerUserId: winner._id.toHexString(),
            winAmount: normalizedWinAmount,
            commission,
            percent: settings.referralWinPercent,
            context: input.context ?? {},
          },
        },
      );
    } else {
      await this.db.collection("affiliate_earnings").insertOne({
        referrerId: referrer._id.toHexString(),
        winnerUserId: winner._id.toHexString(),
        winAmount: normalizedWinAmount,
        commission,
        percent: settings.referralWinPercent,
        context: input.context ?? {},
        createdAt: new Date(),
      });
    }

    return { credited: true, amount: commission };
  }

  private async buildStats(user: UserDoc): Promise<AffiliateStatsResponse> {
    const settings = await this.getSettings();
    const refCode = await this.ensureRefCode(user);

    const availableBalance = normalizeMoney(
      toFiniteNumber(user.ref_money ?? user.affiliateWallet ?? user.availableReferralBalance),
    );
    const totalIncome = normalizeMoney(
      toFiniteNumber(user.ref_money_all ?? user.affiliateStats?.totalCommission ?? user.totalReferralIncome),
    );

    const transitions = toSafeInt(
      user.link_trans ??
        user.referralTransitions ??
        user.affiliateStats?.transitions ??
        user.affiliateStats?.clicks,
    );

    let registrations = toSafeInt(
      user.link_reg ??
        user.referralRegistrations ??
        user.affiliateStats?.totalReferred ??
        user.affiliateStats?.registrations,
    );

    if (registrations === 0) {
      const candidates = [
        refCode,
        pickFirstString(user.unique_id),
        pickFirstString(user.affiliateCode),
        user._id.toHexString(),
      ];
      registrations = await countByRef(this.db, candidates);
    }

    return {
      refCode,
      totalIncome,
      transitions,
      registrations,
      availableBalance,
      minWithdraw: settings.minWithdraw,
      referralWinPercent: settings.referralWinPercent,
      referralSignupBonus: settings.referralSignupBonus,
    };
  }

  private async getSettings(force = false): Promise<AffiliateSettings> {
    const now = Date.now();
    if (!force && now - this.settingsLoadedAt < SETTINGS_CACHE_TTL_MS) {
      return this.cachedSettings;
    }

    const settingsDoc = await this.db.collection<Document>("settings").findOne(
      {},
      {
        sort: { id: 1, _id: 1 },
        projection: {
          min_ref_withdraw: 1,
          ref_perc: 1,
          ref_sum: 1,
        },
      },
    );

    const parsedMinWithdraw = toFiniteNumber(settingsDoc?.min_ref_withdraw);
    const parsedPercent = toFiniteNumber(settingsDoc?.ref_perc);
    const parsedSignupBonus = toFiniteNumber(settingsDoc?.ref_sum);

    const minWithdraw =
      Number.isFinite(parsedMinWithdraw) && parsedMinWithdraw > 0
        ? normalizeMoney(parsedMinWithdraw)
        : DEFAULT_MIN_AFFILIATE_WITHDRAW;
    const referralWinPercent =
      Number.isFinite(parsedPercent) && parsedPercent > 0
        ? Number(parsedPercent.toFixed(4))
        : DEFAULT_REFERRAL_WIN_PERCENT;
    const referralSignupBonus =
      Number.isFinite(parsedSignupBonus) && parsedSignupBonus > 0
        ? normalizeMoney(parsedSignupBonus)
        : DEFAULT_REFERRAL_SIGNUP_BONUS;

    this.cachedSettings = {
      minWithdraw,
      referralWinPercent,
      referralSignupBonus,
    };
    this.settingsLoadedAt = now;
    return this.cachedSettings;
  }

  private async ensureRefCode(user: UserDoc): Promise<string> {
    const existing = pickFirstString(user.affiliateCode);
    if (existing) {
      return normalizeRefCode(existing);
    }

    const legacyUniqueId = pickFirstString(user.unique_id);
    if (legacyUniqueId) {
      const normalized = normalizeRefCode(legacyUniqueId);
      await usersCollection(this.db).updateOne(
        { _id: user._id },
        {
          $set: {
            affiliateCode: normalized,
            updatedAt: new Date(),
          },
        },
      );
      return normalized;
    }

    const fallbackCode = buildFallbackRefCode(user._id);
    await usersCollection(this.db).updateOne(
      { _id: user._id },
      {
        $set: {
          affiliateCode: fallbackCode,
          updatedAt: new Date(),
        },
      },
    );
    return fallbackCode;
  }

  private async resolveReferrerByCode(rawRefCode: string): Promise<UserDoc | null> {
    const refCode = normalizeRefCode(rawRefCode);
    if (!refCode) {
      return null;
    }
    const codeMatcher = caseInsensitiveEq(refCode);

    const referrer = await usersCollection(this.db).findOne({
      $or: [
        { affiliateCode: codeMatcher },
        { unique_id: codeMatcher },
        { referralCode: codeMatcher },
      ],
    });

    if (referrer) {
      return referrer;
    }

    return null;
  }

  private async resolveReferrerForWinner(winner: UserDoc): Promise<UserDoc | null> {
    const directRef = pickFirstString(winner.referredBy, winner.ref_id);
    if (!directRef) {
      return null;
    }

    const codeMatcher = caseInsensitiveEq(normalizeRefCode(directRef));
    const byCode = await usersCollection(this.db).findOne({
      _id: { $ne: winner._id },
      $or: [
        { affiliateCode: codeMatcher },
        { unique_id: codeMatcher },
        { referralCode: codeMatcher },
      ],
    });
    if (byCode) {
      return byCode;
    }

    if (ObjectId.isValid(directRef)) {
      const byId = await usersCollection(this.db).findOne({
        _id: new ObjectId(directRef),
      });
      if (byId && !byId._id.equals(winner._id)) {
        return byId;
      }
    }

    return null;
  }
}

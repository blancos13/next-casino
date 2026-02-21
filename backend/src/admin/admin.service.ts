import { Decimal128, ObjectId, type Collection, type Db, type Document, type Filter } from "mongodb";
import type { AppMetrics } from "../common/request-context";
import { AppError } from "../common/errors";
import { atomicFromDecimal, decimalFromAtomic, formatMoney, moneyToAtomic } from "../common/money";
import { walletLedgerCollection } from "../wallet/wallet-ledger.model";
import { walletProviderCurrencyCatalogCollection } from "../wallet/wallet-provider-currency.model";
import {
  walletProviderSettingsCollection,
  type WalletProviderFlowConfig,
  type WalletProviderSelection,
} from "../wallet/wallet-provider-settings.model";
import type { OxaPayCurrencyOption } from "../wallet/oxapay.client";
import type { WalletService } from "../wallet/wallet.service";
import type { Env } from "../config/env";

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ADMIN_SETTINGS_KEYS = [
  "domain",
  "sitename",
  "title",
  "description",
  "keywords",
  "vk_url",
  "vk_support_link",
  "vk_support_url",
  "vk_service_key",
  "chat_dep",
  "oxapay_api_base",
  "oxapay_merchant_api_key",
  "oxapay_invoice_currency",
  "oxapay_invoice_lifetime_min",
  "oxapay_static_auto_withdrawal",
  "oxapay_callback_url",
  "oxapay_return_url",
  "oxapay_sandbox",
  "oxapay_default_currencies",
  "oxapay_default_currency_networks",
  "oxapay_timeout_ms",
  "wallet_coins_per_usd",
  "profit_koef",
  "jackpot_commission",
  "wheel_timer",
  "wheel_min_bet",
  "wheel_max_bet",
  "crash_min_bet",
  "crash_max_bet",
  "crash_timer",
  "battle_timer",
  "battle_min_bet",
  "battle_max_bet",
  "battle_commission",
  "dice_min_bet",
  "dice_max_bet",
  "flip_commission",
  "flip_min_bet",
  "flip_max_bet",
  "exchange_min",
  "exchange_curs",
  "ref_perc",
  "ref_sum",
  "min_ref_withdraw",
  "min_dep",
  "max_dep",
  "min_dep_withdraw",
  "bonus_group_time",
  "max_active_ref",
] as const;

export type AdminUsersListInput = {
  page?: number;
  pageSize?: number;
  query?: string;
};

export type AdminUserListItem = {
  id: string;
  username: string;
  avatar: string;
  balance: string;
  bonus: string;
  role: "admin" | "moder" | "youtuber" | "user";
  ip: string;
  ban: boolean;
};

export type AdminUsersListResult = {
  items: AdminUserListItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
};

export type AdminUserFinancialStat = {
  win: string;
  lose: string;
};

export type AdminUserDetail = {
  id: string;
  username: string;
  avatar: string;
  email: string;
  ip: string;
  balance: string;
  bonus: string;
  role: "admin" | "moder" | "youtuber" | "user";
  ban: boolean;
  banReason: string;
  chatBanUntil: number | null;
  chatBanReason: string;
  payments: {
    deposit: string;
    withdraw: string;
    exchanges: string;
  };
  stats: {
    jackpot: AdminUserFinancialStat;
    wheel: AdminUserFinancialStat;
    crash: AdminUserFinancialStat;
    coinflip: AdminUserFinancialStat;
    battle: AdminUserFinancialStat;
    dice: AdminUserFinancialStat;
    total: AdminUserFinancialStat;
  };
  createdAt: number | null;
  updatedAt: number | null;
};

export type AdminUserUpdateInput = {
  userId: string;
  balance: number;
  bonus: number;
  role: "admin" | "moder" | "youtuber" | "user";
  ban: boolean;
  banReason?: string;
  chatBanUntil?: string | number | null;
  chatBanReason?: string;
};

export type AdminBonusItem = {
  id: string;
  type: "group" | "refs";
  sum: string;
  status: boolean;
  bg: string;
  color: string;
};

export type AdminPromoItem = {
  id: string;
  type: "balance" | "bonus";
  code: string;
  limit: boolean;
  amount: string;
  countUse: number;
  currentUses: number;
  active: boolean;
};

export type AdminFilterItem = {
  id: string;
  word: string;
};

export type AdminWithdrawItem = {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  system: string;
  wallet: string;
  value: string;
  status: number;
};

export type AdminSettingsRoom = {
  id: string;
  name: string;
  title: string;
  time: string;
  min: string;
  max: string;
  bets: string;
};

export type AdminWalletProviderSelection = WalletProviderSelection;

export type AdminWalletProviderFlowConfig = WalletProviderFlowConfig;

export type AdminWalletProviderConfig = {
  provider: "oxapay";
  catalog: OxaPayCurrencyOption[];
  deposit: AdminWalletProviderFlowConfig;
  withdraw: AdminWalletProviderFlowConfig;
};

export class AdminService {
  constructor(
    private readonly db: Db,
    private readonly metrics: AppMetrics,
    private readonly walletService: WalletService,
    private readonly env: Env,
  ) {}

  async getOverview(): Promise<Record<string, unknown>> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);
    const rollingMonthStart = new Date(todayStart);
    rollingMonthStart.setDate(rollingMonthStart.getDate() - 29);
    const calendarMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const nonFakeFilter = {
      $or: [{ fake: { $exists: false } }, { fake: { $in: [0, false, null] } }],
    } as Filter<Document>;

    const usersCollection = this.db.collection<Document>("users");
    const chatCollection = this.db.collection<Document>("chat_messages");
    const affiliateEarningsCollection = this.db.collection<Document>("affiliate_earnings");
    const ledgerCollection = walletLedgerCollection(this.db);

    const [usersCount, gameLedgerEntries, depositFacetRows, withdrawRows, gameRows, registrationsRows, latestUsersDocs, richestUsersDocs, latestDepositDocs, latestChatDocs, affiliateExpenseRows] =
      await Promise.all([
        usersCollection.countDocuments(nonFakeFilter),
        ledgerCollection.countDocuments({
          type: { $in: ["game_bet", "game_payout"] },
        }),
        ledgerCollection
          .aggregate([
            {
              $match: {
                type: "deposit",
              },
            },
            {
              $facet: {
                today: [{ $match: { createdAt: { $gte: todayStart } } }, { $group: { _id: null, sum: { $sum: "$amountMain" } } }],
                week: [{ $match: { createdAt: { $gte: weekStart } } }, { $group: { _id: null, sum: { $sum: "$amountMain" } } }],
                month: [{ $match: { createdAt: { $gte: rollingMonthStart } } }, { $group: { _id: null, sum: { $sum: "$amountMain" } } }],
                all: [{ $group: { _id: null, sum: { $sum: "$amountMain" } } }],
                monthSeries: [
                  { $match: { createdAt: { $gte: calendarMonthStart } } },
                  {
                    $group: {
                      _id: { $dateToString: { format: "%d.%m", date: "$createdAt" } },
                      date: { $min: "$createdAt" },
                      sum: { $sum: "$amountMain" },
                    },
                  },
                  { $sort: { date: 1 } },
                ],
              },
            },
          ])
          .toArray(),
        ledgerCollection.aggregate([{ $match: { type: "withdraw" } }, { $group: { _id: null, sum: { $sum: "$amountMain" } } }]).toArray(),
        ledgerCollection
          .aggregate([
            {
              $match: {
                type: { $in: ["game_bet", "game_payout"] },
              },
            },
            {
              $group: {
                _id: {
                  game: "$metadata.game",
                  type: "$type",
                },
                sum: { $sum: "$amountMain" },
              },
            },
          ])
          .toArray(),
        usersCollection
          .aggregate([
            { $match: { $and: [nonFakeFilter, { createdAt: { $gte: calendarMonthStart } }] } },
            {
              $group: {
                _id: { $dateToString: { format: "%d.%m", date: "$createdAt" } },
                date: { $min: "$createdAt" },
                count: { $sum: 1 },
              },
            },
            { $sort: { date: 1 } },
          ])
          .toArray(),
        usersCollection
          .find(nonFakeFilter, {
            projection: {
              username: 1,
              avatar: 1,
              referredBy: 1,
              ref_id: 1,
              createdAt: 1,
            },
          })
          .sort({ _id: -1 })
          .limit(10)
          .toArray(),
        usersCollection
          .find(
            {
              $and: [
                nonFakeFilter,
                {
                  roles: {
                    $not: {
                      $elemMatch: { $in: ["admin", "youtuber"] },
                    },
                  },
                },
              ],
            },
            {
              projection: {
                username: 1,
                avatar: 1,
                balances: 1,
                balance: 1,
              },
            },
          )
          .sort({ "balances.main": -1, balance: -1 })
          .limit(20)
          .toArray(),
        ledgerCollection
          .find(
            {
              type: "deposit",
            },
            {
              projection: {
                userId: 1,
                amountMain: 1,
                createdAt: 1,
              },
            },
          )
          .sort({ createdAt: -1 })
          .limit(10)
          .toArray(),
        chatCollection
          .find(
            {},
            {
              projection: {
                userId: 1,
                username: 1,
                text: 1,
                createdAt: 1,
              },
            },
          )
          .sort({ createdAt: -1 })
          .limit(20)
          .toArray(),
        affiliateEarningsCollection.aggregate([{ $group: { _id: null, sum: { $sum: "$commission" } } }]).toArray(),
      ]);

    const depositFacet = depositFacetRows[0] as Record<string, unknown> | undefined;
    const payToday = this.readFacetSum(depositFacet?.today);
    const payWeek = this.readFacetSum(depositFacet?.week);
    const payMonth = this.readFacetSum(depositFacet?.month);
    const payAll = this.readFacetSum(depositFacet?.all);

    const withdrawRaw = withdrawRows[0] as { sum?: unknown } | undefined;
    const withReq = Math.abs(this.toMoneyNumber(withdrawRaw?.sum) ?? 0);

    let monthRegistrations = registrationsRows.map((row) => ({
      date: this.asText(row._id, ""),
      count: Math.max(0, Math.trunc(this.toMoneyNumber(row.count) ?? 0)),
    }));
    let monthDeposits = (Array.isArray(depositFacet?.monthSeries) ? (depositFacet.monthSeries as Array<Record<string, unknown>>) : []).map((row) => ({
      date: this.asText(row._id, ""),
      sum: this.formatMoneyNumber(this.toMoneyNumber(row.sum) ?? 0),
    }));

    let gameProfit = this.computeGameProfit(gameRows);
    let affiliateExpense = this.toMoneyNumber((affiliateExpenseRows[0] as { sum?: unknown } | undefined)?.sum) ?? 0;

    const depositUserIds = Array.from(
      new Set(
        latestDepositDocs
          .map((entry) => this.asText(entry.userId, ""))
          .filter((value) => ObjectId.isValid(value)),
      ),
    ).map((value) => new ObjectId(value));

    const depositUsers = depositUserIds.length
      ? await usersCollection
          .find(
            {
              _id: { $in: depositUserIds },
            },
            {
              projection: {
                username: 1,
                avatar: 1,
              },
            },
          )
          .toArray()
      : [];
    const depositUserMap = new Map<string, { username: string; avatar: string }>();
    for (const user of depositUsers) {
      const id = user._id instanceof ObjectId ? user._id.toHexString() : "";
      if (!id) {
        continue;
      }
      depositUserMap.set(id, {
        username: this.asText(user.username, "User"),
        avatar: this.asText(user.avatar, "/img/no_avatar.jpg"),
      });
    }

    let latestDeposits = latestDepositDocs.map((entry) => {
      const userId = this.asText(entry.userId, "");
      const user = depositUserMap.get(userId);
      return {
        id: userId,
        username: user?.username ?? "User",
        avatar: user?.avatar ?? "/img/no_avatar.jpg",
        sum: this.formatMoneyNumber(this.toMoneyNumber(entry.amountMain) ?? 0),
        date: this.asTimestampMs(entry.createdAt),
      };
    });

    const latestUsers = latestUsersDocs.map((user) => {
      const id = user._id instanceof ObjectId ? user._id.toHexString() : "";
      return {
        id,
        username: this.asText(user.username, "User"),
        avatar: this.asText(user.avatar, "/img/no_avatar.jpg"),
        refCode: this.asText(user.referredBy, this.asText(user.ref_id, "")),
        createdAt: this.asTimestampMs(user.createdAt),
      };
    });

    const richestUsers = richestUsersDocs.map((user) => {
      const id = user._id instanceof ObjectId ? user._id.toHexString() : "";
      return {
        id,
        username: this.asText(user.username, "User"),
        avatar: this.asText(user.avatar, "/img/no_avatar.jpg"),
        balance: this.readBalance(user, "main"),
      };
    });

    const latestChat = latestChatDocs.map((msg) => ({
      id: msg._id instanceof ObjectId ? msg._id.toHexString() : "",
      userId: this.asText(msg.userId, ""),
      username: this.asText(msg.username, "User"),
      text: this.asText(msg.text, ""),
      createdAt: this.asTimestampMs(msg.createdAt),
    }));

    const hasCurrentData =
      payToday > 0 ||
      payWeek > 0 ||
      payMonth > 0 ||
      payAll > 0 ||
      withReq > 0 ||
      gameLedgerEntries > 0 ||
      monthDeposits.length > 0 ||
      latestDeposits.length > 0 ||
      Object.values(gameProfit).some((value) => value > 0) ||
      affiliateExpense > 0;

    let finalPayToday = payToday;
    let finalPayWeek = payWeek;
    let finalPayMonth = payMonth;
    let finalPayAll = payAll;
    let finalWithReq = withReq;

    if (!hasCurrentData) {
      const legacyOverview = await this.getLegacyOverview({
        todayStart,
        weekStart,
        rollingMonthStart,
        calendarMonthStart,
        nonFakeFilter,
      });

      finalPayToday = legacyOverview.payToday;
      finalPayWeek = legacyOverview.payWeek;
      finalPayMonth = legacyOverview.payMonth;
      finalPayAll = legacyOverview.payAll;
      finalWithReq = legacyOverview.withReq;
      gameProfit = legacyOverview.profit;
      affiliateExpense = legacyOverview.refExpense;

      if (legacyOverview.monthRegistrations.length > 0) {
        monthRegistrations = legacyOverview.monthRegistrations;
      }
      if (legacyOverview.monthDeposits.length > 0) {
        monthDeposits = legacyOverview.monthDeposits;
      }
      if (legacyOverview.latestDeposits.length > 0) {
        latestDeposits = legacyOverview.latestDeposits;
      }
    }

    const profitTotal =
      gameProfit.jackpot +
      gameProfit.coinflip +
      gameProfit.battle +
      gameProfit.wheel +
      gameProfit.dice +
      gameProfit.crash +
      gameProfit.exchange -
      affiliateExpense;

    return {
      users: usersCount,
      gameLedgerEntries,
      metrics: this.metrics,
      kpi: {
        payToday: this.formatMoneyNumber(finalPayToday),
        payWeek: this.formatMoneyNumber(finalPayWeek),
        payMonth: this.formatMoneyNumber(finalPayMonth),
        payAll: this.formatMoneyNumber(finalPayAll),
        withReq: this.formatMoneyNumber(finalWithReq),
        usersCount,
      },
      profit: {
        jackpot: this.formatMoneyNumber(gameProfit.jackpot),
        pvp: this.formatMoneyNumber(gameProfit.coinflip),
        battle: this.formatMoneyNumber(gameProfit.battle),
        wheel: this.formatMoneyNumber(gameProfit.wheel),
        dice: this.formatMoneyNumber(gameProfit.dice),
        crash: this.formatMoneyNumber(gameProfit.crash),
        exchange: this.formatMoneyNumber(gameProfit.exchange),
        total: this.formatMoneyNumber(profitTotal),
        refExpense: this.formatMoneyNumber(affiliateExpense),
      },
      charts: {
        registrations: monthRegistrations,
        deposits: monthDeposits,
      },
      lists: {
        latestDeposits,
        latestUsers,
        richestUsers,
        chat: latestChat,
      },
    };
  }

  async listUsers(input: AdminUsersListInput): Promise<AdminUsersListResult> {
    const page = Number.isFinite(input.page) ? Math.max(1, Math.trunc(input.page as number)) : 1;
    const pageSizeRaw = Number.isFinite(input.pageSize) ? Math.trunc(input.pageSize as number) : 20;
    const pageSize = Math.max(1, Math.min(100, pageSizeRaw));
    const query = typeof input.query === "string" ? input.query.trim() : "";

    const filters: Array<Filter<Document>> = [
      {
        $or: [{ fake: { $exists: false } }, { fake: { $in: [0, false, null] } }],
      } as Filter<Document>,
    ];

    if (query) {
      const rx = new RegExp(escapeRegex(query), "i");
      const queryFilters: Array<Filter<Document>> = [
        { username: rx } as Filter<Document>,
        { ip: rx } as Filter<Document>,
        { email: rx } as Filter<Document>,
        { unique_id: rx } as Filter<Document>,
      ];
      if (ObjectId.isValid(query)) {
        queryFilters.push({ _id: new ObjectId(query) } as Filter<Document>);
      }
      filters.push({ $or: queryFilters } as Filter<Document>);
    }

    const filter = (filters.length === 1 ? filters[0] : { $and: filters }) as Filter<Document>;

    const usersCollection = this.db.collection<Document>("users");
    const [total, docs] = await Promise.all([
      usersCollection.countDocuments(filter),
      usersCollection
        .find(filter)
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
    ]);

    const items = docs.map((doc) => {
      const objectIdValue = doc._id;
      const id =
        objectIdValue instanceof ObjectId
          ? objectIdValue.toHexString()
          : typeof objectIdValue === "string"
            ? objectIdValue
            : "";

      return {
        id,
        username: this.asText(doc.username, id ? `User #${id.slice(-6)}` : "User"),
        avatar: this.asText(doc.avatar, "/img/no_avatar.jpg"),
        balance: this.readBalance(doc, "main"),
        bonus: this.readBalance(doc, "bonus"),
        role: this.resolveRole(doc),
        ip: this.asText(doc.ip, "-"),
        ban: this.asBoolean(doc.ban),
      } satisfies AdminUserListItem;
    });

    return {
      items,
      total,
      page,
      pageSize,
      pages: total === 0 ? 1 : Math.ceil(total / pageSize),
    };
  }

  async getUserDetail(userIdRaw: string): Promise<AdminUserDetail> {
    const userId = this.requireObjectId(userIdRaw);
    const usersCollection = this.db.collection<Document>("users");
    const user = await usersCollection.findOne({ _id: userId });
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found");
    }

    const statsByGame: Record<"jackpot" | "wheel" | "crash" | "coinflip" | "battle" | "dice", { win: number; lose: number }> = {
      jackpot: { win: 0, lose: 0 },
      wheel: { win: 0, lose: 0 },
      crash: { win: 0, lose: 0 },
      coinflip: { win: 0, lose: 0 },
      battle: { win: 0, lose: 0 },
      dice: { win: 0, lose: 0 },
    };
    const payments = {
      deposit: 0,
      withdraw: 0,
      exchanges: 0,
    };

    const ledgers = await walletLedgerCollection(this.db)
      .find(
        { userId: userId.toHexString() },
        {
          projection: {
            type: 1,
            amountMain: 1,
            metadata: 1,
          },
        },
      )
      .toArray();

    for (const entry of ledgers) {
      const amountMain = this.toMoneyNumber(entry.amountMain) ?? 0;
      const amountAbs = Math.abs(amountMain);
      if (entry.type === "deposit") {
        payments.deposit += amountMain > 0 ? amountMain : amountAbs;
        continue;
      }
      if (entry.type === "withdraw") {
        payments.withdraw += amountAbs;
        continue;
      }
      if (entry.type === "exchange") {
        payments.exchanges += amountAbs;
        continue;
      }
      if (entry.type !== "game_bet" && entry.type !== "game_payout") {
        continue;
      }

      const game = this.resolveGameKey(entry.metadata?.game);
      if (!game) {
        continue;
      }

      if (entry.type === "game_bet") {
        statsByGame[game].lose += amountAbs;
      } else {
        statsByGame[game].win += Math.max(0, amountMain);
      }
    }

    const totalWin = Object.values(statsByGame).reduce((sum, item) => sum + item.win, 0);
    const totalLose = Object.values(statsByGame).reduce((sum, item) => sum + item.lose, 0);

    return {
      id: userId.toHexString(),
      username: this.asText(user.username, "User"),
      avatar: this.asText(user.avatar, "/img/no_avatar.jpg"),
      email: this.asText(user.email, ""),
      ip: this.asText(user.ip, "-"),
      balance: this.readBalance(user, "main"),
      bonus: this.readBalance(user, "bonus"),
      role: this.resolveRole(user),
      ban: this.asBoolean(user.ban),
      banReason: this.asText(user.ban_reason, ""),
      chatBanUntil: this.normalizeChatBanUntil(user.banchat),
      chatBanReason: this.asText(user.banchat_reason, ""),
      payments: {
        deposit: this.formatMoneyNumber(payments.deposit),
        withdraw: this.formatMoneyNumber(payments.withdraw),
        exchanges: this.formatMoneyNumber(payments.exchanges),
      },
      stats: {
        jackpot: this.asFinancialStat(statsByGame.jackpot),
        wheel: this.asFinancialStat(statsByGame.wheel),
        crash: this.asFinancialStat(statsByGame.crash),
        coinflip: this.asFinancialStat(statsByGame.coinflip),
        battle: this.asFinancialStat(statsByGame.battle),
        dice: this.asFinancialStat(statsByGame.dice),
        total: this.asFinancialStat({ win: totalWin, lose: totalLose }),
      },
      createdAt: this.asTimestampMs(user.createdAt),
      updatedAt: this.asTimestampMs(user.updatedAt),
    };
  }

  async updateUser(input: AdminUserUpdateInput): Promise<AdminUserDetail> {
    const userId = this.requireObjectId(input.userId);
    const usersCollection = this.db.collection<Document>("users");
    const existing = await usersCollection.findOne(
      { _id: userId },
      {
        projection: {
          stateVersion: 1,
        },
      },
    );
    if (!existing) {
      throw new AppError("NOT_FOUND", "User not found");
    }

    const mainAtomic = moneyToAtomic(input.balance);
    const bonusAtomic = moneyToAtomic(input.bonus);
    const role = input.role;
    const roles = role === "user" ? ["user"] : [role];
    const chatBanUntil = this.normalizeChatBanUntil(input.chatBanUntil);
    const stateVersion = this.asVersion(existing.stateVersion) + 1;

    await usersCollection.updateOne(
      { _id: userId },
      {
        $set: {
          "balances.main": decimalFromAtomic(mainAtomic),
          "balances.bonus": decimalFromAtomic(bonusAtomic),
          balance: input.balance,
          bonus: input.bonus,
          stateVersion,
          roles,
          is_admin: role === "admin",
          is_moder: role === "moder",
          is_youtuber: role === "youtuber",
          ban: input.ban,
          ban_reason: this.asText(input.banReason, ""),
          banchat: chatBanUntil,
          banchat_reason: this.asText(input.chatBanReason, ""),
          updatedAt: new Date(),
        },
      },
    );

    return this.getUserDetail(input.userId);
  }

  async listBonuses(): Promise<{ items: AdminBonusItem[] }> {
    const collection = this.db.collection<Document>("bonuses");
    const docs = await collection.find({}).sort({ id: -1, _id: -1 }).toArray();
    const items = docs.map((doc) => ({
      id: this.buildRecordId(doc),
      type: this.normalizeBonusType(doc.type),
      sum: this.formatMoneyNumber(this.toMoneyNumber(doc.sum) ?? this.toMoneyNumber(doc.amount) ?? 0),
      status: this.asBoolean(doc.status),
      bg: this.asText(doc.bg, "#ffffff"),
      color: this.asText(doc.color, "#000000"),
    }));
    return { items };
  }

  async createBonus(input: {
    sum: number;
    type: "group" | "refs";
    bg: string;
    color: string;
    status: boolean;
  }): Promise<AdminBonusItem> {
    const collection = this.db.collection<Document>("bonuses");
    const now = new Date();
    const legacyId = await this.nextLegacyNumericId(collection);
    const payload: Document = {
      id: legacyId,
      sum: input.sum,
      type: input.type,
      bg: input.bg,
      color: input.color,
      status: input.status ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    };
    const result = await collection.insertOne(payload);
    return {
      id: result.insertedId.toHexString(),
      type: input.type,
      sum: this.formatMoneyNumber(input.sum),
      status: input.status,
      bg: input.bg,
      color: input.color,
    };
  }

  async updateBonus(
    id: string,
    input: {
      sum: number;
      type: "group" | "refs";
      bg: string;
      color: string;
      status: boolean;
    },
  ): Promise<AdminBonusItem> {
    const collection = this.db.collection<Document>("bonuses");
    const update = await collection.findOneAndUpdate(
      this.buildIdFilter(id),
      {
        $set: {
          sum: input.sum,
          type: input.type,
          bg: input.bg,
          color: input.color,
          status: input.status ? 1 : 0,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    if (!update) {
      throw new AppError("NOT_FOUND", "Bonus not found");
    }
    return {
      id: this.buildRecordId(update),
      type: this.normalizeBonusType(update.type),
      sum: this.formatMoneyNumber(this.toMoneyNumber(update.sum) ?? 0),
      status: this.asBoolean(update.status),
      bg: this.asText(update.bg, "#ffffff"),
      color: this.asText(update.color, "#000000"),
    };
  }

  async deleteBonus(id: string): Promise<{ success: true }> {
    const collection = this.db.collection<Document>("bonuses");
    const result = await collection.deleteOne(this.buildIdFilter(id));
    if (result.deletedCount < 1) {
      throw new AppError("NOT_FOUND", "Bonus not found");
    }
    return { success: true };
  }

  async listPromos(): Promise<{ items: AdminPromoItem[] }> {
    const collection = this.db.collection<Document>("promocodes");
    const docs = await collection.find({}).sort({ id: -1, _id: -1 }).toArray();
    const items = docs.map((doc) => {
      const type = this.normalizePromoType(doc.type, doc.rewardType);
      const maxRedemptions = this.toNumericInt(doc.maxRedemptions);
      const currentRedemptions = this.toNumericInt(doc.currentRedemptions);
      const hasLegacyLimit = doc.limit !== undefined ? this.asBoolean(doc.limit) : null;
      const hasLimit = hasLegacyLimit !== null ? hasLegacyLimit : maxRedemptions > 0 && maxRedemptions < 1_000_000_000;
      const countUse = this.toNumericInt(doc.count_use) || maxRedemptions;
      return {
        id: this.buildRecordId(doc),
        type,
        code: this.asText(doc.code, ""),
        limit: hasLimit,
        amount: this.formatMoneyNumber(this.toMoneyNumber(doc.amount) ?? this.toMoneyNumber(doc.rewardAmount) ?? 0),
        countUse,
        currentUses: currentRedemptions,
        active: doc.active === undefined ? true : this.asBoolean(doc.active),
      } satisfies AdminPromoItem;
    });
    return { items };
  }

  async createPromo(input: {
    code: string;
    type: "balance" | "bonus";
    limit: boolean;
    amount: number;
    countUse: number;
  }): Promise<AdminPromoItem> {
    const collection = this.db.collection<Document>("promocodes");
    const code = input.code.trim().toUpperCase();
    if (!code) {
      throw new AppError("VALIDATION_ERROR", "Promo code is required");
    }

    const existing = await collection.findOne({ code: new RegExp(`^${escapeRegex(code)}$`, "i") });
    if (existing) {
      throw new AppError("CONFLICT", "This code already exists");
    }

    const now = new Date();
    const maxRedemptions = input.limit ? Math.max(0, Math.trunc(input.countUse)) : 1_000_000_000;
    const rewardType = input.type === "bonus" ? "bonus" : "main";
    const amountAtomic = moneyToAtomic(input.amount);
    const legacyId = await this.nextLegacyNumericId(collection);

    const payload: Document = {
      id: legacyId,
      code,
      type: input.type,
      rewardType,
      limit: input.limit ? 1 : 0,
      amount: input.amount,
      rewardAmount: decimalFromAtomic(amountAtomic),
      count_use: Math.max(0, Math.trunc(input.countUse)),
      maxRedemptions,
      currentRedemptions: 0,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    const result = await collection.insertOne(payload);
    return {
      id: result.insertedId.toHexString(),
      type: input.type,
      code,
      limit: input.limit,
      amount: this.formatMoneyNumber(input.amount),
      countUse: Math.max(0, Math.trunc(input.countUse)),
      currentUses: 0,
      active: true,
    };
  }

  async updatePromo(
    id: string,
    input: {
      code: string;
      type: "balance" | "bonus";
      limit: boolean;
      amount: number;
      countUse: number;
      active: boolean;
    },
  ): Promise<AdminPromoItem> {
    const collection = this.db.collection<Document>("promocodes");
    const code = input.code.trim().toUpperCase();
    if (!code) {
      throw new AppError("VALIDATION_ERROR", "Promo code is required");
    }

    const sameCode = await collection.findOne({
      code: new RegExp(`^${escapeRegex(code)}$`, "i"),
      ...this.negateIdFilter(id),
    });
    if (sameCode) {
      throw new AppError("CONFLICT", "This code already exists");
    }

    const rewardType = input.type === "bonus" ? "bonus" : "main";
    const maxRedemptions = input.limit ? Math.max(0, Math.trunc(input.countUse)) : 1_000_000_000;
    const amountAtomic = moneyToAtomic(input.amount);

    const updated = await collection.findOneAndUpdate(
      this.buildIdFilter(id),
      {
        $set: {
          code,
          type: input.type,
          rewardType,
          limit: input.limit ? 1 : 0,
          amount: input.amount,
          rewardAmount: decimalFromAtomic(amountAtomic),
          count_use: Math.max(0, Math.trunc(input.countUse)),
          maxRedemptions,
          active: input.active,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      throw new AppError("NOT_FOUND", "Promo code not found");
    }

    return {
      id: this.buildRecordId(updated),
      type: this.normalizePromoType(updated.type, updated.rewardType),
      code: this.asText(updated.code, ""),
      limit: this.asBoolean(updated.limit),
      amount: this.formatMoneyNumber(this.toMoneyNumber(updated.amount) ?? this.toMoneyNumber(updated.rewardAmount) ?? 0),
      countUse: this.toNumericInt(updated.count_use) || this.toNumericInt(updated.maxRedemptions),
      currentUses: this.toNumericInt(updated.currentRedemptions),
      active: updated.active === undefined ? true : this.asBoolean(updated.active),
    };
  }

  async deletePromo(id: string): Promise<{ success: true }> {
    const collection = this.db.collection<Document>("promocodes");
    const result = await collection.deleteOne(this.buildIdFilter(id));
    if (result.deletedCount < 1) {
      throw new AppError("NOT_FOUND", "Promo code not found");
    }
    return { success: true };
  }

  async listFilters(): Promise<{ items: AdminFilterItem[] }> {
    const collection = this.db.collection<Document>("filters");
    const docs = await collection.find({}).sort({ id: -1, _id: -1 }).toArray();
    const items = docs.map((doc) => ({
      id: this.buildRecordId(doc),
      word: this.asText(doc.word, ""),
    }));
    return { items };
  }

  async createFilter(wordRaw: string): Promise<AdminFilterItem> {
    const collection = this.db.collection<Document>("filters");
    const word = wordRaw.trim();
    if (!word) {
      throw new AppError("VALIDATION_ERROR", "Filter cannot be empty");
    }
    const existing = await collection.findOne({ word: new RegExp(`^${escapeRegex(word)}$`, "i") });
    if (existing) {
      throw new AppError("CONFLICT", "This filter already exists");
    }
    const legacyId = await this.nextLegacyNumericId(collection);
    const result = await collection.insertOne({
      id: legacyId,
      word,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return {
      id: result.insertedId.toHexString(),
      word,
    };
  }

  async updateFilter(id: string, wordRaw: string): Promise<AdminFilterItem> {
    const collection = this.db.collection<Document>("filters");
    const word = wordRaw.trim();
    if (!word) {
      throw new AppError("VALIDATION_ERROR", "Filter cannot be empty");
    }
    const existing = await collection.findOne({
      word: new RegExp(`^${escapeRegex(word)}$`, "i"),
      ...this.negateIdFilter(id),
    });
    if (existing) {
      throw new AppError("CONFLICT", "This filter already exists");
    }
    const updated = await collection.findOneAndUpdate(
      this.buildIdFilter(id),
      {
        $set: {
          word,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    if (!updated) {
      throw new AppError("NOT_FOUND", "Filter not found");
    }
    return {
      id: this.buildRecordId(updated),
      word: this.asText(updated.word, ""),
    };
  }

  async deleteFilter(id: string): Promise<{ success: true }> {
    const collection = this.db.collection<Document>("filters");
    const result = await collection.deleteOne(this.buildIdFilter(id));
    if (result.deletedCount < 1) {
      throw new AppError("NOT_FOUND", "Filter not found");
    }
    return { success: true };
  }

  async listWithdraws(): Promise<{ active: AdminWithdrawItem[]; done: AdminWithdrawItem[] }> {
    const collection = this.db.collection<Document>("withdraws");
    const [activeDocs, doneDocs] = await Promise.all([
      collection.find({ status: { $in: [0, "0", false] } }).sort({ id: -1, _id: -1 }).toArray(),
      collection.find({ status: { $in: [1, "1", true] } }).sort({ id: -1, _id: -1 }).toArray(),
    ]);

    if (activeDocs.length === 0 && doneDocs.length === 0) {
      return this.listWithdrawsFromLedger();
    }

    const userKeySet = new Set<string>();
    for (const row of [...activeDocs, ...doneDocs]) {
      const key = this.legacyUserIdKey(row.user_id ?? row.userId);
      if (key) {
        userKeySet.add(key);
      }
    }
    const userMap = await this.loadUsersByLegacyKeys([...userKeySet.values()]);

    const mapRow = (row: Document): AdminWithdrawItem => {
      const userKey = this.legacyUserIdKey(row.user_id ?? row.userId);
      const user = userMap.get(userKey);
      const value = this.readLegacyAmount(row);
      return {
        id: this.buildRecordId(row),
        userId: user?._id ?? userKey,
        username: user?.username ?? this.asText(row.username, "User"),
        avatar: user?.avatar ?? "/img/no_avatar.jpg",
        system: this.asText(row.system, this.asText(row.provider, "-")),
        wallet: this.asText(row.wallet, this.asText(row.address, "-")),
        value: this.formatMoneyNumber(Math.abs(value)),
        status: this.toNumericInt(row.status),
      };
    };

    return {
      active: activeDocs.map(mapRow),
      done: doneDocs.map(mapRow),
    };
  }

  private async listWithdrawsFromLedger(): Promise<{ active: AdminWithdrawItem[]; done: AdminWithdrawItem[] }> {
    const ledgerDocs = await walletLedgerCollection(this.db)
      .find({ type: "withdraw" })
      .sort({ createdAt: -1, _id: -1 })
      .limit(200)
      .toArray();

    const userKeySet = new Set<string>();
    for (const row of ledgerDocs) {
      const key = this.legacyUserIdKey(row.userId);
      if (key) {
        userKeySet.add(key);
      }
    }
    const userMap = await this.loadUsersByLegacyKeys([...userKeySet.values()]);

    const active: AdminWithdrawItem[] = [];
    const done: AdminWithdrawItem[] = [];

    for (const row of ledgerDocs) {
      const userKey = this.legacyUserIdKey(row.userId);
      const user = userMap.get(userKey);
      const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
      const amount = Math.abs(this.toMoneyNumber(row.amountMain) ?? 0);

      const currency = this.asText(metadata.currency, "").toUpperCase();
      const network = this.asText(metadata.network, "");
      const provider = this.asText(metadata.provider, "").toUpperCase();
      const source = this.asText(metadata.source, "");

      let system = "-";
      if (currency) {
        system = network ? `${currency} (${network})` : currency;
      } else if (provider) {
        system = provider;
      } else if (source) {
        system = source;
      }

      const adminStatus = this.asText(metadata.adminStatus, "").trim().toLowerCase();
      const isPendingRequest = source === "withdraw_request" && (adminStatus.length === 0 || adminStatus === "pending");

      const item: AdminWithdrawItem = {
        id: row._id instanceof ObjectId ? row._id.toHexString() : this.asText(row.requestId, ""),
        userId: user?._id ?? userKey,
        username: user?.username ?? "User",
        avatar: user?.avatar ?? "/img/no_avatar.jpg",
        system,
        wallet: this.asText(metadata.address, "-"),
        value: this.formatMoneyNumber(amount),
        status: adminStatus === "returned" ? 2 : 1,
      };

      if (isPendingRequest) {
        active.push(item);
      } else {
        done.push(item);
      }
    }

    return {
      active,
      done,
    };
  }

  async acceptWithdraw(id: string, txHash: string): Promise<{ success: true }> {
    const collection = this.db.collection<Document>("withdraws");
    const current = await collection.findOne(this.buildIdFilter(id));
    if (!current) {
      return this.acceptLedgerWithdraw(id, txHash);
    }
    const status = this.toNumericInt(current.status);
    if (status > 0) {
      throw new AppError("CONFLICT", "This withdraw has already been processed or canceled");
    }
    const normalizedTxHash = txHash.trim();
    await collection.updateOne(
      this.buildIdFilter(id),
      {
        $set: {
          status: 1,
          txHash: normalizedTxHash,
          tx_hash: normalizedTxHash,
          updatedAt: new Date(),
        },
      },
    );
    return { success: true };
  }

  async returnWithdraw(id: string, reason: string): Promise<{ success: true }> {
    const collection = this.db.collection<Document>("withdraws");
    const current = await collection.findOne(this.buildIdFilter(id));
    if (!current) {
      return this.returnLedgerWithdraw(id, reason);
    }
    const status = this.toNumericInt(current.status);
    if (status > 0) {
      throw new AppError("CONFLICT", "This withdraw has already been processed or canceled");
    }

    const amount = Math.abs(this.readLegacyAmount(current));
    if (amount <= 0) {
      throw new AppError("VALIDATION_ERROR", "Withdraw value is invalid");
    }

    const userKey = this.legacyUserIdKey(current.user_id ?? current.userId);
    const user = await this.findUserByLegacyKey(userKey);
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found for withdraw");
    }

    const normalizedReason = reason.trim();

    await this.walletService.applyMutation({
      userId: user._id,
      requestId: `admin:withdraw:return:${id}`,
      ledgerType: "deposit",
      deltaMainAtomic: moneyToAtomic(amount),
      deltaBonusAtomic: 0n,
      metadata: {
        source: "admin_withdraw_return",
        withdrawId: id,
        reason: normalizedReason,
      },
    });

    await collection.updateOne(
      this.buildIdFilter(id),
      {
        $set: {
          status: 2,
          returnReason: normalizedReason,
          adminReturnReason: normalizedReason,
          updatedAt: new Date(),
        },
      },
    );

    return { success: true };
  }

  private async acceptLedgerWithdraw(id: string, txHash: string): Promise<{ success: true }> {
    if (!ObjectId.isValid(id)) {
      throw new AppError("NOT_FOUND", "Withdraw not found");
    }

    const ledger = walletLedgerCollection(this.db);
    const current = await ledger.findOne({
      _id: new ObjectId(id),
      type: "withdraw",
    });
    if (!current) {
      throw new AppError("NOT_FOUND", "Withdraw not found");
    }

    const metadata = current.metadata && typeof current.metadata === "object" ? (current.metadata as Record<string, unknown>) : {};
    const source = this.asText(metadata.source, "");
    const adminStatus = this.asText(metadata.adminStatus, "").trim().toLowerCase();

    if (source !== "withdraw_request") {
      throw new AppError("CONFLICT", "This withdraw cannot be moderated from admin queue");
    }
    if (adminStatus === "accepted" || adminStatus === "returned") {
      throw new AppError("CONFLICT", "This withdraw has already been processed");
    }
    const normalizedTxHash = txHash.trim();

    await ledger.updateOne(
      { _id: current._id },
      {
        $set: {
          "metadata.adminStatus": "accepted",
          "metadata.adminReviewedAt": new Date().toISOString(),
          "metadata.adminTxHash": normalizedTxHash,
        },
      },
    );

    return { success: true };
  }

  private async returnLedgerWithdraw(id: string, reason: string): Promise<{ success: true }> {
    if (!ObjectId.isValid(id)) {
      throw new AppError("NOT_FOUND", "Withdraw not found");
    }

    const ledger = walletLedgerCollection(this.db);
    const current = await ledger.findOne({
      _id: new ObjectId(id),
      type: "withdraw",
    });
    if (!current) {
      throw new AppError("NOT_FOUND", "Withdraw not found");
    }

    const metadata = current.metadata && typeof current.metadata === "object" ? (current.metadata as Record<string, unknown>) : {};
    const source = this.asText(metadata.source, "");
    const adminStatus = this.asText(metadata.adminStatus, "").trim().toLowerCase();

    if (source !== "withdraw_request") {
      throw new AppError("CONFLICT", "This withdraw cannot be moderated from admin queue");
    }
    if (adminStatus === "accepted" || adminStatus === "returned") {
      throw new AppError("CONFLICT", "This withdraw has already been processed");
    }

    const amount = Math.abs(this.toMoneyNumber(current.amountMain) ?? 0);
    if (amount <= 0) {
      throw new AppError("VALIDATION_ERROR", "Withdraw value is invalid");
    }

    const userKey = this.legacyUserIdKey(current.userId);
    const user = await this.findUserByLegacyKey(userKey);
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found for withdraw");
    }

    const normalizedReason = reason.trim();

    await this.walletService.applyMutation({
      userId: user._id,
      requestId: `admin:withdraw:return:ledger:${id}`,
      ledgerType: "deposit",
      deltaMainAtomic: moneyToAtomic(amount),
      deltaBonusAtomic: 0n,
      metadata: {
        source: "admin_withdraw_return",
        withdrawLedgerId: id,
        reason: normalizedReason,
      },
    });

    await ledger.updateOne(
      { _id: current._id },
      {
        $set: {
          "metadata.adminStatus": "returned",
          "metadata.adminReviewedAt": new Date().toISOString(),
          "metadata.adminReturnReason": normalizedReason,
        },
      },
    );

    return { success: true };
  }

  async getSettings(): Promise<{ settings: Record<string, string>; rooms: AdminSettingsRoom[] }> {
    const settingsCollection = this.db.collection<Document>("settings");
    const roomsCollection = this.db.collection<Document>("rooms");
    const now = new Date();

    const [settingsDoc, roomDocs] = await Promise.all([
      settingsCollection.findOne({}, { sort: { id: 1, _id: 1 } }),
      roomsCollection.find({}).sort({ id: 1, _id: 1 }).toArray(),
    ]);

    const hasStoredValue = (row: Document | null | undefined, key: string): boolean => {
      if (!row) {
        return false;
      }
      if (!Object.prototype.hasOwnProperty.call(row, key)) {
        return false;
      }
      const value = row[key];
      return value !== null && value !== undefined;
    };

    const settingDefaults = this.buildSettingsDefaults();
    const settings: Record<string, string> = {};
    const settingsSeedPayload: Record<string, unknown> = {};
    let shouldSeedSettings = false;
    for (const key of ADMIN_SETTINGS_KEYS) {
      const hasStored = hasStoredValue(settingsDoc, key);
      const stored = hasStored ? this.valueToString((settingsDoc as Document)[key]) : "";
      const fallback = settingDefaults[key] ?? "";
      const storedTrimmed = stored.trim();
      const fallbackTrimmed = fallback.trim();
      const hasLegacyTemplateValue = storedTrimmed.length > 0 && this.isLegacyTemplateSettingValue(key, storedTrimmed);
      const isReferralSetting = key === "ref_perc" || key === "ref_sum" || key === "min_ref_withdraw";
      const storedNumber = Number.parseFloat(storedTrimmed);
      const hasLegacyZeroReferralValue =
        isReferralSetting && Number.isFinite(storedNumber) && storedNumber <= 0;
      const useFallback =
        !hasStored || storedTrimmed.length === 0 || hasLegacyTemplateValue || hasLegacyZeroReferralValue;
      const resolved = useFallback ? fallback : stored;
      settings[key] = resolved;
      if (useFallback) {
        if (fallbackTrimmed.length > 0 || (hasStored && storedTrimmed.length > 0)) {
          settingsSeedPayload[key] = this.normalizeLooseValue(resolved);
          shouldSeedSettings = true;
        }
      }
    }

    if (shouldSeedSettings) {
      settingsSeedPayload.updatedAt = now;
      if (settingsDoc) {
        await settingsCollection.updateOne({ _id: settingsDoc._id }, { $set: settingsSeedPayload });
      } else {
        await settingsCollection.insertOne({
          id: 1,
          ...settingsSeedPayload,
          createdAt: now,
        });
      }
    }

    const roomDefaults = this.buildRoomDefaults();
    const roomDocByName = new Map<string, Document>();
    for (const row of roomDocs) {
      const name = this.asText(row.name, "").toLowerCase();
      if (!name) {
        continue;
      }
      roomDocByName.set(name, row);
    }

    const rooms: AdminSettingsRoom[] = [];
    const roomsToSeed: Array<{
      name: string;
      title: string;
      time: string;
      min: string;
      max: string;
      bets: string;
    }> = [];

    for (let index = 0; index < roomDefaults.length; index += 1) {
      const fallback = roomDefaults[index];
      const row = roomDocByName.get(fallback.name);
      if (!row) {
        rooms.push({
          id: `${index + 1}`,
          name: fallback.name,
          title: fallback.title,
          time: fallback.time,
          min: fallback.min,
          max: fallback.max,
          bets: fallback.bets,
        });
        roomsToSeed.push({ ...fallback });
        continue;
      }

      const hasTitle = hasStoredValue(row, "title");
      const hasTime = hasStoredValue(row, "time");
      const hasMin = hasStoredValue(row, "min");
      const hasMax = hasStoredValue(row, "max");
      const hasBets = hasStoredValue(row, "bets");

      const storedTitle = hasTitle ? this.asText(row.title, "") : "";
      const storedTime = hasTime ? this.valueToString(row.time) : "";
      const storedMin = hasMin ? this.valueToString(row.min) : "";
      const storedMax = hasMax ? this.valueToString(row.max) : "";
      const storedBets = hasBets ? this.valueToString(row.bets) : "";

      const useFallbackTitle = !hasTitle || storedTitle.trim().length === 0;
      const useFallbackTime = !hasTime || storedTime.trim().length === 0;
      const useFallbackMin = !hasMin || storedMin.trim().length === 0;
      const useFallbackMax = !hasMax || storedMax.trim().length === 0;
      const useFallbackBets = !hasBets || storedBets.trim().length === 0;

      const room = {
        id: this.buildRecordId(row) || `${index + 1}`,
        name: fallback.name,
        title: useFallbackTitle ? fallback.title : storedTitle,
        time: useFallbackTime ? fallback.time : storedTime,
        min: useFallbackMin ? fallback.min : storedMin,
        max: useFallbackMax ? fallback.max : storedMax,
        bets: useFallbackBets ? fallback.bets : storedBets,
      };
      rooms.push(room);

      if (useFallbackTitle || useFallbackTime || useFallbackMin || useFallbackMax || useFallbackBets) {
        roomsToSeed.push({
          name: room.name,
          title: room.title,
          time: room.time,
          min: room.min,
          max: room.max,
          bets: room.bets,
        });
      }

      roomDocByName.delete(fallback.name);
    }

    let extraIndex = rooms.length;
    for (const row of roomDocByName.values()) {
      extraIndex += 1;
      const name = this.asText(row.name, `room_${extraIndex}`);
      rooms.push({
        id: this.buildRecordId(row) || `${extraIndex}`,
        name,
        title: this.asText(row.title, name),
        time: this.valueToString(row.time),
        min: this.valueToString(row.min),
        max: this.valueToString(row.max),
        bets: this.valueToString(row.bets),
      });
    }

    if (roomsToSeed.length > 0) {
      for (const room of roomsToSeed) {
        await roomsCollection.updateOne(
          { name: room.name },
          {
            $set: {
              name: room.name,
              title: room.title,
              time: this.normalizeLooseValue(room.time),
              min: this.normalizeLooseValue(room.min),
              max: this.normalizeLooseValue(room.max),
              bets: this.normalizeLooseValue(room.bets),
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      }
    }

    return { settings, rooms };
  }

  async getPublicSiteSettings(input?: {
    host?: string;
  }): Promise<{
    domain: string;
    sitename: string;
    title: string;
    description: string;
    keywords: string;
  }> {
    const { settings } = await this.getSettings();

    const normalizeDomain = (value: string): string => {
      const trimmed = value.trim();
      if (!trimmed) {
        return "";
      }
      const firstHost = trimmed.split(",")[0]?.trim() ?? "";
      return firstHost.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
    };

    const resolvedDomain = normalizeDomain(settings.domain ?? "") || normalizeDomain(this.asText(input?.host, "")) || "localhost:3000";
    const resolvedSitename = this.asText(settings.sitename, "win2x");
    const resolvedTitle = this.asText(settings.title, `${resolvedSitename} - crypto casino`);
    const resolvedDescription = this.asText(settings.description, "Win2x crypto casino platform.");
    const resolvedKeywords = this.asText(settings.keywords, "win2x, crypto casino");

    return {
      domain: resolvedDomain,
      sitename: resolvedSitename,
      title: resolvedTitle,
      description: resolvedDescription,
      keywords: resolvedKeywords,
    };
  }

  async saveSettings(input: {
    settings: Record<string, unknown>;
    rooms: Array<{
      id?: string;
      name: string;
      title?: string;
      time?: string | number;
      min?: string | number;
      max?: string | number;
      bets?: string | number;
    }>;
  }): Promise<{ settings: Record<string, string>; rooms: AdminSettingsRoom[] }> {
    const settingsCollection = this.db.collection<Document>("settings");
    const roomsCollection = this.db.collection<Document>("rooms");
    const now = new Date();

    const settingsPayload: Record<string, unknown> = {};
    for (const key of ADMIN_SETTINGS_KEYS) {
      if (Object.prototype.hasOwnProperty.call(input.settings, key)) {
        settingsPayload[key] = this.normalizeLooseValue(input.settings[key]);
      }
    }
    settingsPayload.updatedAt = now;

    const existingSettings = await settingsCollection.findOne({}, { sort: { id: 1, _id: 1 } });
    if (existingSettings) {
      await settingsCollection.updateOne(
        { _id: existingSettings._id },
        { $set: settingsPayload },
      );
    } else {
      await settingsCollection.insertOne({
        id: 1,
        ...settingsPayload,
        createdAt: now,
      });
    }

    for (const room of input.rooms) {
      const name = this.asText(room.name, "");
      if (!name) {
        continue;
      }
      const updatePayload: Document = {
        name,
        title: this.asText(room.title, name),
        time: this.normalizeLooseValue(room.time),
        min: this.normalizeLooseValue(room.min),
        max: this.normalizeLooseValue(room.max),
        bets: this.normalizeLooseValue(room.bets),
        updatedAt: now,
      };

      const idFilter = room.id ? this.buildIdFilter(room.id) : null;
      if (idFilter) {
        await roomsCollection.updateOne(idFilter, { $set: updatePayload }, { upsert: true });
      } else {
        await roomsCollection.updateOne({ name }, { $set: updatePayload }, { upsert: true });
      }
    }

    return this.getSettings();
  }

  async getWalletProviderConfig(): Promise<AdminWalletProviderConfig> {
    const now = new Date();
    const [settingsRow, catalogRow] = await Promise.all([
      walletProviderSettingsCollection(this.db).findOne({ provider: "oxapay" }),
      walletProviderCurrencyCatalogCollection(this.db).findOne({ provider: "oxapay" }),
    ]);

    const catalog = this.normalizeProviderCatalog(catalogRow?.currencies);
    const deposit = this.normalizeWalletProviderFlow(settingsRow?.deposit);
    const withdraw = this.normalizeWalletProviderFlow(settingsRow?.withdraw);

    if (!settingsRow) {
      await walletProviderSettingsCollection(this.db).updateOne(
        { provider: "oxapay" },
        {
          $setOnInsert: {
            provider: "oxapay",
            deposit,
            withdraw,
            createdAt: now,
          },
          $set: {
            updatedAt: now,
          },
        },
        { upsert: true },
      );
    }

    return {
      provider: "oxapay",
      catalog,
      deposit,
      withdraw,
    };
  }

  async saveWalletProviderConfig(input: {
    provider?: "oxapay";
    deposit: WalletProviderFlowConfig;
    withdraw: WalletProviderFlowConfig;
  }): Promise<AdminWalletProviderConfig> {
    const provider = input.provider ?? "oxapay";
    if (provider !== "oxapay") {
      throw new AppError("VALIDATION_ERROR", "Unsupported provider");
    }

    const now = new Date();
    const deposit = this.normalizeWalletProviderFlow(input.deposit);
    const withdraw = this.normalizeWalletProviderFlow(input.withdraw);

    await walletProviderSettingsCollection(this.db).updateOne(
      { provider: "oxapay" },
      {
        $setOnInsert: {
          provider: "oxapay",
          createdAt: now,
        },
        $set: {
          deposit,
          withdraw,
          updatedAt: now,
        },
      },
      { upsert: true },
    );

    return this.getWalletProviderConfig();
  }

  private normalizeProviderCatalog(raw: unknown): OxaPayCurrencyOption[] {
    const rows = Array.isArray(raw) ? raw : [];
    const toNumeric = (value: unknown): number | undefined => {
      const parsed = this.toMoneyNumber(value);
      return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
    };
    const dedupe = new Map<string, OxaPayCurrencyOption>();
    for (const row of rows) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const source = row as Record<string, unknown>;
      const code = this.asText(source.code, "").trim().toUpperCase();
      if (!code) {
        continue;
      }
      const networksRaw = Array.isArray(source.networks) ? source.networks : [];
      const networkMap = new Map<string, OxaPayCurrencyOption["networks"][number]>();
      for (const networkRaw of networksRaw) {
        if (!networkRaw || typeof networkRaw !== "object") {
          continue;
        }
        const networkSource = networkRaw as Record<string, unknown>;
        const id = this.asText(networkSource.id, "").trim();
        if (!id) {
          continue;
        }
        const aliasesRaw = Array.isArray(networkSource.aliases) ? networkSource.aliases : [];
        const aliases = Array.from(
          new Set(
            aliasesRaw
              .map((alias) => (typeof alias === "string" ? alias.trim() : ""))
              .filter((alias) => alias.length > 0),
          ),
        );
        networkMap.set(id, {
          id,
          name: this.asText(networkSource.name, `${id} Network`),
          requestNetwork: this.asText(networkSource.requestNetwork, id),
          aliases,
          status: networkSource.status === false ? false : true,
          requiredConfirmations: toNumeric(networkSource.requiredConfirmations),
          withdrawFee: toNumeric(networkSource.withdrawFee),
          withdrawMin: toNumeric(networkSource.withdrawMin),
          withdrawMax: toNumeric(networkSource.withdrawMax),
          depositMin: toNumeric(networkSource.depositMin),
          depositMax: toNumeric(networkSource.depositMax),
          staticFixedFee: toNumeric(networkSource.staticFixedFee),
        });
      }
      const networks = Array.from(networkMap.values()).sort((left, right) => left.id.localeCompare(right.id));
      dedupe.set(code, {
        code,
        name: this.asText(source.name, code),
        status: source.status === false ? false : true,
        networks,
      });
    }
    return Array.from(dedupe.values()).sort((left, right) => left.code.localeCompare(right.code));
  }
  private normalizeWalletProviderFlow(raw: unknown): WalletProviderFlowConfig {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const enabled = source.enabled === false || source.enabled === 0 || source.enabled === "0" ? false : true;
    const selectionsRaw = Array.isArray(source.selections) ? source.selections : [];
    const dedupe = new Map<string, WalletProviderSelection>();
    for (const selectionRaw of selectionsRaw) {
      if (!selectionRaw || typeof selectionRaw !== "object") {
        continue;
      }
      const selection = selectionRaw as Record<string, unknown>;
      const code = this.asText(selection.code, "").trim().toUpperCase();
      if (!code) {
        continue;
      }
      const networksRaw = Array.isArray(selection.networks) ? selection.networks : [];
      const networks = Array.from(
        new Set(
          networksRaw
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
  private buildSettingsDefaults(): Record<string, string> {
    return {
      domain: this.env.ADMIN_DOMAIN,
      sitename: this.env.ADMIN_SITENAME || "win2x",
      title: this.env.ADMIN_TITLE || "win2x - crypto casino",
      description: this.env.ADMIN_DESCRIPTION || "Win2x crypto casino platform.",
      keywords: this.env.ADMIN_KEYWORDS || "win2x, crypto casino",
      vk_url: this.env.ADMIN_VK_URL,
      vk_support_link: this.env.ADMIN_VK_SUPPORT_LINK,
      vk_support_url: this.env.ADMIN_VK_SUPPORT_URL,
      vk_service_key: this.env.ADMIN_VK_SERVICE_KEY,
      chat_dep: `${this.env.ADMIN_CHAT_DEP}`,
      oxapay_api_base: this.env.OXAPAY_API_BASE,
      oxapay_merchant_api_key: this.env.OXAPAY_MERCHANT_API_KEY,
      oxapay_invoice_currency: this.env.OXAPAY_INVOICE_CURRENCY,
      oxapay_invoice_lifetime_min: `${this.env.OXAPAY_INVOICE_LIFETIME_MIN}`,
      oxapay_static_auto_withdrawal: this.env.OXAPAY_STATIC_AUTO_WITHDRAWAL ? "1" : "0",
      oxapay_callback_url: this.env.OXAPAY_CALLBACK_URL,
      oxapay_return_url: this.env.OXAPAY_RETURN_URL,
      oxapay_sandbox: this.env.OXAPAY_SANDBOX ? "1" : "0",
      oxapay_default_currencies: this.env.OXAPAY_DEFAULT_CURRENCIES,
      oxapay_default_currency_networks: this.env.OXAPAY_DEFAULT_CURRENCY_NETWORKS,
      oxapay_timeout_ms: `${this.env.OXAPAY_TIMEOUT_MS}`,
      wallet_coins_per_usd: `${this.env.WALLET_COINS_PER_USD}`,
      profit_koef: `${this.env.ADMIN_PROFIT_KOEF}`,
      jackpot_commission: `${this.env.ADMIN_JACKPOT_COMMISSION}`,
      wheel_timer: `${this.env.ADMIN_WHEEL_TIMER}`,
      wheel_min_bet: `${this.env.ADMIN_WHEEL_MIN_BET}`,
      wheel_max_bet: `${this.env.ADMIN_WHEEL_MAX_BET}`,
      crash_min_bet: `${this.env.ADMIN_CRASH_MIN_BET}`,
      crash_max_bet: `${this.env.ADMIN_CRASH_MAX_BET}`,
      crash_timer: `${this.env.ADMIN_CRASH_TIMER}`,
      battle_timer: `${this.env.ADMIN_BATTLE_TIMER}`,
      battle_min_bet: `${this.env.ADMIN_BATTLE_MIN_BET}`,
      battle_max_bet: `${this.env.ADMIN_BATTLE_MAX_BET}`,
      battle_commission: `${this.env.ADMIN_BATTLE_COMMISSION}`,
      dice_min_bet: `${this.env.ADMIN_DICE_MIN_BET}`,
      dice_max_bet: `${this.env.ADMIN_DICE_MAX_BET}`,
      flip_commission: `${this.env.ADMIN_FLIP_COMMISSION}`,
      flip_min_bet: `${this.env.ADMIN_FLIP_MIN_BET}`,
      flip_max_bet: `${this.env.ADMIN_FLIP_MAX_BET}`,
      exchange_min: `${this.env.ADMIN_EXCHANGE_MIN}`,
      exchange_curs: `${this.env.ADMIN_EXCHANGE_CURS}`,
      ref_perc: `${this.env.ADMIN_REF_PERC}`,
      ref_sum: `${this.env.ADMIN_REF_SUM}`,
      min_ref_withdraw: `${this.env.ADMIN_MIN_REF_WITHDRAW}`,
      min_dep: `${this.env.ADMIN_MIN_DEP}`,
      max_dep: `${this.env.ADMIN_MAX_DEP}`,
      min_dep_withdraw: `${this.env.ADMIN_MIN_DEP_WITHDRAW}`,
      bonus_group_time: `${this.env.ADMIN_BONUS_GROUP_TIME}`,
      max_active_ref: `${this.env.ADMIN_MAX_ACTIVE_REF}`,
    };
  }

  private buildRoomDefaults(): Array<{ name: string; title: string; time: string; min: string; max: string; bets: string }> {
    return [
      {
        name: "easy",
        title: "Easy",
        time: `${this.env.ADMIN_ROOM_EASY_TIME}`,
        min: `${this.env.ADMIN_ROOM_EASY_MIN}`,
        max: `${this.env.ADMIN_ROOM_EASY_MAX}`,
        bets: `${this.env.ADMIN_ROOM_EASY_BETS}`,
      },
      {
        name: "medium",
        title: "Medium",
        time: `${this.env.ADMIN_ROOM_MEDIUM_TIME}`,
        min: `${this.env.ADMIN_ROOM_MEDIUM_MIN}`,
        max: `${this.env.ADMIN_ROOM_MEDIUM_MAX}`,
        bets: `${this.env.ADMIN_ROOM_MEDIUM_BETS}`,
      },
      {
        name: "hard",
        title: "Hard",
        time: `${this.env.ADMIN_ROOM_HARD_TIME}`,
        min: `${this.env.ADMIN_ROOM_HARD_MIN}`,
        max: `${this.env.ADMIN_ROOM_HARD_MAX}`,
        bets: `${this.env.ADMIN_ROOM_HARD_BETS}`,
      },
    ];
  }

  private async getLegacyOverview(input: {
    todayStart: Date;
    weekStart: Date;
    rollingMonthStart: Date;
    calendarMonthStart: Date;
    nonFakeFilter: Filter<Document>;
  }): Promise<{
    payToday: number;
    payWeek: number;
    payMonth: number;
    payAll: number;
    withReq: number;
    profit: {
      jackpot: number;
      coinflip: number;
      battle: number;
      wheel: number;
      dice: number;
      crash: number;
      exchange: number;
    };
    refExpense: number;
    monthDeposits: Array<{ date: string; sum: string }>;
    monthRegistrations: Array<{ date: string; count: number }>;
    latestDeposits: Array<{ id: string; username: string; avatar: string; sum: string; date: number | null }>;
  }> {
    const usersCollection = this.db.collection<Document>("users");
    const depositsCollection = this.db.collection<Document>("deposits");
    const withdrawsCollection = this.db.collection<Document>("withdraws");
    const profitCollections = [this.db.collection<Document>("profits"), this.db.collection<Document>("profit")];

    const approvedDepositFilter = { status: { $in: [1, "1", true] } } as Filter<Document>;
    const pendingWithdrawFilter = { status: { $in: [0, "0", false] } } as Filter<Document>;

    const [payAllAggRows, withdrawRows, depositWindowDocs, latestDepositDocs, registrationDocs] = await Promise.all([
      depositsCollection
        .aggregate([
          { $match: approvedDepositFilter },
          {
            $group: {
              _id: null,
              sum: {
                $sum: {
                  $ifNull: ["$amount", 0],
                },
              },
            },
          },
        ])
        .toArray(),
      withdrawsCollection
        .find(pendingWithdrawFilter, {
          projection: {
            value: 1,
            amount: 1,
          },
        })
        .toArray(),
      depositsCollection
        .find(
          {
            ...approvedDepositFilter,
            $or: [
              { updatedAt: { $gte: input.rollingMonthStart } },
              { updated_at: { $gte: input.rollingMonthStart } },
              { createdAt: { $gte: input.rollingMonthStart } },
              { created_at: { $gte: input.rollingMonthStart } },
            ],
          } as Filter<Document>,
          {
            projection: {
              amount: 1,
              value: 1,
              sum: 1,
              userId: 1,
              user_id: 1,
              updatedAt: 1,
              updated_at: 1,
              createdAt: 1,
              created_at: 1,
            },
          },
        )
        .toArray(),
      depositsCollection
        .find(approvedDepositFilter, {
          projection: {
            amount: 1,
            value: 1,
            sum: 1,
            userId: 1,
            user_id: 1,
            updatedAt: 1,
            updated_at: 1,
            createdAt: 1,
            created_at: 1,
          },
        })
        .sort({ _id: -1 })
        .limit(10)
        .toArray(),
      usersCollection
        .find(
          {
            $and: [
              input.nonFakeFilter,
              {
                $or: [
                  { createdAt: { $gte: input.calendarMonthStart } },
                  { created_at: { $gte: input.calendarMonthStart } },
                ],
              } as Filter<Document>,
            ],
          } as Filter<Document>,
          {
            projection: {
              createdAt: 1,
              created_at: 1,
            },
          },
        )
        .toArray(),
    ]);

    let payAll = this.toMoneyNumber((payAllAggRows[0] as { sum?: unknown } | undefined)?.sum) ?? 0;
    if (payAll <= 0) {
      const allDepositsFallback = await depositsCollection.find(approvedDepositFilter, { projection: { amount: 1, value: 1, sum: 1 } }).toArray();
      payAll = allDepositsFallback.reduce((sum, doc) => sum + this.readLegacyAmount(doc), 0);
    }

    let payToday = 0;
    let payWeek = 0;
    let payMonth = 0;
    const monthDepositSeries = new Map<string, { dateMs: number; sum: number }>();

    for (const doc of depositWindowDocs) {
      const amount = this.readLegacyAmount(doc);
      if (amount <= 0) {
        continue;
      }
      const dateMs = this.pickLegacyDateMs(doc);
      if (dateMs === null) {
        continue;
      }

      if (dateMs >= input.todayStart.getTime()) {
        payToday += amount;
      }
      if (dateMs >= input.weekStart.getTime()) {
        payWeek += amount;
      }
      if (dateMs >= input.rollingMonthStart.getTime()) {
        payMonth += amount;
      }
      if (dateMs >= input.calendarMonthStart.getTime()) {
        const key = this.toDayMonthKey(dateMs);
        const current = monthDepositSeries.get(key);
        if (current) {
          current.sum += amount;
        } else {
          monthDepositSeries.set(key, { dateMs, sum: amount });
        }
      }
    }

    const monthDeposits = [...monthDepositSeries.entries()]
      .sort((left, right) => left[1].dateMs - right[1].dateMs)
      .map(([date, data]) => ({
        date,
        sum: this.formatMoneyNumber(data.sum),
      }));

    const monthRegistrationSeries = new Map<string, { dateMs: number; count: number }>();
    for (const doc of registrationDocs) {
      const dateMs = this.pickLegacyDateMs(doc, ["createdAt", "created_at"]);
      if (dateMs === null || dateMs < input.calendarMonthStart.getTime()) {
        continue;
      }
      const key = this.toDayMonthKey(dateMs);
      const current = monthRegistrationSeries.get(key);
      if (current) {
        current.count += 1;
      } else {
        monthRegistrationSeries.set(key, { dateMs, count: 1 });
      }
    }
    const monthRegistrations = [...monthRegistrationSeries.entries()]
      .sort((left, right) => left[1].dateMs - right[1].dateMs)
      .map(([date, data]) => ({
        date,
        count: data.count,
      }));

    const withReq = withdrawRows.reduce((sum, row) => sum + Math.abs(this.readLegacyAmount(row)), 0);

    let profitRows: Document[] = [];
    for (const collection of profitCollections) {
      const rows = await collection
        .find(
          {
            $or: [
              { createdAt: { $gte: input.todayStart } },
              { created_at: { $gte: input.todayStart } },
            ],
          } as Filter<Document>,
          {
            projection: {
              game: 1,
              sum: 1,
              value: 1,
              amount: 1,
              createdAt: 1,
              created_at: 1,
            },
          },
        )
        .toArray();
      if (rows.length > 0) {
        profitRows = rows;
        break;
      }
    }

    const profit = {
      jackpot: 0,
      coinflip: 0,
      battle: 0,
      wheel: 0,
      dice: 0,
      crash: 0,
      exchange: 0,
    };
    let refExpense = 0;
    for (const row of profitRows) {
      const dateMs = this.pickLegacyDateMs(row, ["createdAt", "created_at"]);
      if (dateMs === null || dateMs < input.todayStart.getTime()) {
        continue;
      }
      const amount = this.readLegacyAmount(row);
      const game = this.normalizeLegacyProfitGame(row.game);
      if (!game) {
        continue;
      }
      if (game === "ref") {
        refExpense += amount;
      } else if (game in profit) {
        const key = game as keyof typeof profit;
        profit[key] += amount;
      }
    }

    const rawLatestDepositUserIds = latestDepositDocs
      .map((row) => this.legacyUserIdKey(row.userId ?? row.user_id))
      .filter((value) => value.length > 0);

    const objectUserIds = rawLatestDepositUserIds.filter((value) => ObjectId.isValid(value)).map((value) => new ObjectId(value));
    const simpleIdValues = rawLatestDepositUserIds
      .filter((value) => !ObjectId.isValid(value))
      .map((value) => {
        const numeric = Number.parseInt(value, 10);
        return Number.isFinite(numeric) ? numeric : value;
      });

    const userLookups: Array<Filter<Document>> = [];
    if (objectUserIds.length > 0) {
      userLookups.push({ _id: { $in: objectUserIds } } as Filter<Document>);
    }
    if (simpleIdValues.length > 0) {
      userLookups.push({ id: { $in: simpleIdValues } } as Filter<Document>);
    }

    const depositUsers = userLookups.length
      ? await usersCollection
          .find(
            { $or: userLookups } as Filter<Document>,
            {
              projection: {
                id: 1,
                username: 1,
                avatar: 1,
              },
            },
          )
          .toArray()
      : [];

    const depositUserMap = new Map<string, { username: string; avatar: string }>();
    for (const user of depositUsers) {
      const objectId = user._id instanceof ObjectId ? user._id.toHexString() : "";
      const legacyId = this.legacyUserIdKey(user.id);
      const payload = {
        username: this.asText(user.username, "User"),
        avatar: this.asText(user.avatar, "/img/no_avatar.jpg"),
      };
      if (objectId) {
        depositUserMap.set(objectId, payload);
      }
      if (legacyId) {
        depositUserMap.set(legacyId, payload);
      }
    }

    const latestDeposits = latestDepositDocs.map((row) => {
      const userId = this.legacyUserIdKey(row.userId ?? row.user_id);
      const user = depositUserMap.get(userId);
      return {
        id: userId,
        username: user?.username ?? "User",
        avatar: user?.avatar ?? "/img/no_avatar.jpg",
        sum: this.formatMoneyNumber(this.readLegacyAmount(row)),
        date: this.pickLegacyDateMs(row),
      };
    });

    return {
      payToday,
      payWeek,
      payMonth,
      payAll,
      withReq,
      profit,
      refExpense,
      monthDeposits,
      monthRegistrations,
      latestDeposits,
    };
  }

  private readLegacyAmount(value: unknown): number {
    if (!value || typeof value !== "object") {
      return 0;
    }
    const row = value as Record<string, unknown>;
    const candidates = [row.amount, row.value, row.sum];
    for (const candidate of candidates) {
      const parsed = this.toMoneyNumber(candidate);
      if (parsed !== null && Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  private pickLegacyDateMs(value: unknown, order?: string[]): number | null {
    if (!value || typeof value !== "object") {
      return null;
    }
    const row = value as Record<string, unknown>;
    const keys = order ?? ["updatedAt", "updated_at", "createdAt", "created_at", "date"];
    for (const key of keys) {
      const timestamp = this.asTimestampMs(row[key]);
      if (timestamp !== null) {
        return timestamp;
      }
    }
    return null;
  }

  private legacyUserIdKey(value: unknown): string {
    if (value instanceof ObjectId) {
      return value.toHexString();
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return `${Math.trunc(value)}`;
    }
    return "";
  }

  private toDayMonthKey(timestampMs: number): string {
    const date = new Date(timestampMs);
    const day = `${date.getDate()}`.padStart(2, "0");
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    return `${day}.${month}`;
  }

  private normalizeLegacyProfitGame(value: unknown): "jackpot" | "coinflip" | "battle" | "wheel" | "dice" | "crash" | "exchange" | "ref" | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "jackpot") {
      return "jackpot";
    }
    if (normalized === "pvp" || normalized === "coinflip") {
      return "coinflip";
    }
    if (normalized === "battle") {
      return "battle";
    }
    if (normalized === "wheel") {
      return "wheel";
    }
    if (normalized === "dice") {
      return "dice";
    }
    if (normalized === "crash") {
      return "crash";
    }
    if (normalized === "exchange" || normalized === "exchanges") {
      return "exchange";
    }
    if (normalized === "ref") {
      return "ref";
    }
    return null;
  }

  private async nextLegacyNumericId(collection: Collection<Document>): Promise<number> {
    const latest = await collection.findOne({}, { sort: { id: -1, _id: -1 }, projection: { id: 1 } });
    const current = this.toNumericInt(latest?.id);
    return current > 0 ? current + 1 : 1;
  }

  private buildRecordId(doc: Document): string {
    const legacyId = doc.id;
    if (typeof legacyId === "string" && legacyId.trim().length > 0) {
      return legacyId.trim();
    }
    if (typeof legacyId === "number" && Number.isFinite(legacyId)) {
      return `${Math.trunc(legacyId)}`;
    }
    if (doc._id instanceof ObjectId) {
      return doc._id.toHexString();
    }
    if (typeof doc._id === "string" && doc._id.trim().length > 0) {
      return doc._id.trim();
    }
    return "";
  }

  private buildIdFilter(id: string): Filter<Document> {
    const candidates: Array<Filter<Document>> = [];
    const trimmed = id.trim();
    if (!trimmed) {
      return { _id: new ObjectId() } as Filter<Document>;
    }
    if (ObjectId.isValid(trimmed)) {
      candidates.push({ _id: new ObjectId(trimmed) } as Filter<Document>);
    }
    const numeric = Number.parseInt(trimmed, 10);
    if (Number.isFinite(numeric)) {
      candidates.push({ id: numeric } as Filter<Document>);
    }
    candidates.push({ _id: trimmed } as Filter<Document>);
    return candidates.length === 1 ? candidates[0] : ({ $or: candidates } as Filter<Document>);
  }

  private negateIdFilter(id: string): Filter<Document> {
    const trimmed = id.trim();
    const clauses: Array<Filter<Document>> = [];
    if (ObjectId.isValid(trimmed)) {
      clauses.push({ _id: { $ne: new ObjectId(trimmed) } } as Filter<Document>);
    }
    const numeric = Number.parseInt(trimmed, 10);
    if (Number.isFinite(numeric)) {
      clauses.push({ id: { $ne: numeric } } as Filter<Document>);
    }
    clauses.push({ _id: { $ne: trimmed } } as Filter<Document>);
    return clauses.length === 1 ? clauses[0] : ({ $and: clauses } as Filter<Document>);
  }

  private normalizeBonusType(value: unknown): "group" | "refs" {
    const normalized = this.asText(value, "group").toLowerCase();
    return normalized === "refs" ? "refs" : "group";
  }

  private normalizePromoType(primary: unknown, rewardType: unknown): "balance" | "bonus" {
    const normalizedPrimary = this.asText(primary, "").toLowerCase();
    if (normalizedPrimary === "bonus") {
      return "bonus";
    }
    if (normalizedPrimary === "balance") {
      return "balance";
    }
    const normalizedReward = this.asText(rewardType, "").toLowerCase();
    if (normalizedReward === "bonus") {
      return "bonus";
    }
    return "balance";
  }

  private isLegacyTemplateSettingValue(key: string, value: string): boolean {
    const normalized = value.trim();
    if (!normalized) {
      return false;
    }

    const lower = normalized.toLowerCase();
    if (key === "domain") {
      return lower === "domain.ru";
    }
    if (key === "sitename") {
      return lower === "sitename.ru";
    }
    if (key === "title") {
      return lower === "sitename.ru - short description";
    }
    if (key === "description") {
      return lower === "the description for the site...";
    }
    if (key === "keywords") {
      return lower === "website, name, domain, etc...";
    }
    if (key === "vk_url" || key === "vk_support_link" || key === "vk_support_url") {
      return lower === "https://facebook.com/...";
    }
    if (key === "vk_service_key") {
      return lower === "service_key";
    }
    return false;
  }

  private toNumericInt(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return 0;
  }

  private valueToString(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (value instanceof Decimal128) {
      return value.toString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return `${value}`;
    }
    if (typeof value === "boolean") {
      return value ? "1" : "0";
    }
    if (typeof value === "string") {
      return value;
    }
    return "";
  }

  private normalizeLooseValue(value: unknown): unknown {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return "";
      }
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      return trimmed;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    return "";
  }

  private async loadUsersByLegacyKeys(keys: string[]): Promise<Map<string, { _id: string; username: string; avatar: string }>> {
    const map = new Map<string, { _id: string; username: string; avatar: string }>();
    if (keys.length === 0) {
      return map;
    }

    const objectIds = keys.filter((key) => ObjectId.isValid(key)).map((key) => new ObjectId(key));
    const numericIds = keys
      .filter((key) => !ObjectId.isValid(key))
      .map((key) => Number.parseInt(key, 10))
      .filter((value) => Number.isFinite(value));

    const filters: Array<Filter<Document>> = [];
    if (objectIds.length > 0) {
      filters.push({ _id: { $in: objectIds } } as Filter<Document>);
    }
    if (numericIds.length > 0) {
      filters.push({ id: { $in: numericIds } } as Filter<Document>);
    }
    if (filters.length === 0) {
      return map;
    }

    const docs = await this.db
      .collection<Document>("users")
      .find({ $or: filters } as Filter<Document>, {
        projection: {
          id: 1,
          username: 1,
          avatar: 1,
        },
      })
      .toArray();

    for (const doc of docs) {
      const objectKey = doc._id instanceof ObjectId ? doc._id.toHexString() : "";
      const legacyKey = this.legacyUserIdKey(doc.id);
      const payload = {
        _id: objectKey || legacyKey,
        username: this.asText(doc.username, "User"),
        avatar: this.asText(doc.avatar, "/img/no_avatar.jpg"),
      };
      if (objectKey) {
        map.set(objectKey, payload);
      }
      if (legacyKey) {
        map.set(legacyKey, payload);
      }
    }

    return map;
  }

  private async findUserByLegacyKey(
    key: string,
  ): Promise<{ _id: string; username: string; avatar: string } | null> {
    if (!key) {
      return null;
    }
    const users = this.db.collection<Document>("users");
    let user: Document | null = null;
    if (ObjectId.isValid(key)) {
      user = await users.findOne({ _id: new ObjectId(key) });
    } else {
      const numeric = Number.parseInt(key, 10);
      if (Number.isFinite(numeric)) {
        user = await users.findOne({ id: numeric } as Filter<Document>);
      }
    }
    if (!user || !(user._id instanceof ObjectId)) {
      return null;
    }
    return {
      _id: user._id.toHexString(),
      username: this.asText(user.username, "User"),
      avatar: this.asText(user.avatar, "/img/no_avatar.jpg"),
    };
  }

  private readBalance(doc: Document, kind: "main" | "bonus"): string {
    const balancesRaw = doc.balances;
    if (balancesRaw && typeof balancesRaw === "object") {
      const value = this.toMoneyString((balancesRaw as Document)[kind]);
      if (value !== null) {
        return value;
      }
    }

    const legacyField = kind === "main" ? "balance" : "bonus";
    const legacyValue = this.toMoneyString(doc[legacyField]);
    return legacyValue ?? "0.00";
  }

  private toMoneyString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof Decimal128) {
      return formatMoney(atomicFromDecimal(value));
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value.toFixed(2);
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed.toFixed(2);
      }
      return null;
    }
    if (typeof value === "object") {
      const nested = this.toMoneyString((value as Document).USD);
      if (nested !== null) {
        return nested;
      }
    }
    return null;
  }

  private resolveRole(doc: Document): "admin" | "moder" | "youtuber" | "user" {
    const rolesRaw = doc.roles;
    if (Array.isArray(rolesRaw)) {
      const roles = rolesRaw
        .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
        .filter((item) => item.length > 0);
      if (roles.includes("admin")) {
        return "admin";
      }
      if (roles.includes("moder") || roles.includes("moderator")) {
        return "moder";
      }
      if (roles.includes("youtuber")) {
        return "youtuber";
      }
    }

    if (this.asBoolean(doc.is_admin)) {
      return "admin";
    }
    if (this.asBoolean(doc.is_moder)) {
      return "moder";
    }
    if (this.asBoolean(doc.is_youtuber)) {
      return "youtuber";
    }
    return "user";
  }

  private asBoolean(value: unknown): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return normalized === "1" || normalized === "true" || normalized === "yes";
    }
    return false;
  }

  private asText(value: unknown, fallback: string): string {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return fallback;
  }

  private resolveGameKey(value: unknown): "jackpot" | "wheel" | "crash" | "coinflip" | "battle" | "dice" | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    if (
      normalized === "jackpot" ||
      normalized === "wheel" ||
      normalized === "crash" ||
      normalized === "coinflip" ||
      normalized === "battle" ||
      normalized === "dice"
    ) {
      return normalized;
    }
    return null;
  }

  private toMoneyNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (value instanceof Decimal128) {
      return Number(formatMoney(atomicFromDecimal(value), 6));
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
      return null;
    }
    return null;
  }

  private formatMoneyNumber(value: number): string {
    return Number.isFinite(value) ? value.toFixed(2) : "0.00";
  }

  private asFinancialStat(value: { win: number; lose: number }): AdminUserFinancialStat {
    return {
      win: this.formatMoneyNumber(value.win),
      lose: this.formatMoneyNumber(value.lose),
    };
  }

  private requireObjectId(value: string): ObjectId {
    if (!ObjectId.isValid(value)) {
      throw new AppError("VALIDATION_ERROR", "Invalid user id");
    }
    return new ObjectId(value);
  }

  private asTimestampMs(value: unknown): number | null {
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      if (value > 1_000_000_000_000) {
        return Math.trunc(value);
      }
      return Math.trunc(value * 1000);
    }
    if (typeof value === "string") {
      const numeric = Number.parseFloat(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        if (numeric > 1_000_000_000_000) {
          return Math.trunc(numeric);
        }
        return Math.trunc(numeric * 1000);
      }
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return Math.trunc(parsed);
      }
    }
    return null;
  }

  private normalizeChatBanUntil(value: unknown): number | null {
    const ms = this.asTimestampMs(value);
    if (ms === null) {
      return null;
    }
    return Math.max(0, Math.trunc(ms / 1000));
  }

  private asVersion(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }
    return 0;
  }

  private readFacetSum(value: unknown): number {
    if (!Array.isArray(value) || value.length === 0) {
      return 0;
    }
    const first = value[0];
    if (!first || typeof first !== "object") {
      return 0;
    }
    return this.toMoneyNumber((first as Record<string, unknown>).sum) ?? 0;
  }

  private computeGameProfit(rows: Array<Record<string, unknown>>): {
    jackpot: number;
    coinflip: number;
    battle: number;
    wheel: number;
    dice: number;
    crash: number;
    exchange: number;
  } {
    const betTotals: Record<"jackpot" | "coinflip" | "battle" | "wheel" | "dice" | "crash", number> = {
      jackpot: 0,
      coinflip: 0,
      battle: 0,
      wheel: 0,
      dice: 0,
      crash: 0,
    };
    const payoutTotals: Record<"jackpot" | "coinflip" | "battle" | "wheel" | "dice" | "crash", number> = {
      jackpot: 0,
      coinflip: 0,
      battle: 0,
      wheel: 0,
      dice: 0,
      crash: 0,
    };

    for (const row of rows) {
      const keyRaw = row._id;
      const key = keyRaw && typeof keyRaw === "object" ? (keyRaw as Record<string, unknown>) : {};
      const game = this.resolveGameKey(key.game);
      if (!game) {
        continue;
      }
      const type = this.asText(key.type, "");
      const sum = this.toMoneyNumber(row.sum) ?? 0;
      if (type === "game_bet") {
        betTotals[game] += Math.abs(sum);
      } else if (type === "game_payout") {
        payoutTotals[game] += Math.max(0, sum);
      }
    }

    return {
      jackpot: betTotals.jackpot - payoutTotals.jackpot,
      coinflip: betTotals.coinflip - payoutTotals.coinflip,
      battle: betTotals.battle - payoutTotals.battle,
      wheel: betTotals.wheel - payoutTotals.wheel,
      dice: betTotals.dice - payoutTotals.dice,
      crash: betTotals.crash - payoutTotals.crash,
      exchange: 0,
    };
  }
}

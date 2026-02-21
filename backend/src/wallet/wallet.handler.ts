import { AppError } from "../common/errors";
import type { CommandContext } from "../common/request-context";
import type { WsRouter } from "../infra/ws/router";
import { walletAmountSchema, walletExchangeSchema, walletStaticAddressSchema, walletWithdrawSchema } from "./wallet.schema";
import type { WalletService } from "./wallet.service";

export const registerWalletHandlers = (router: WsRouter, walletService: WalletService): void => {
  const createStaticAddressHandler = async (ctx: CommandContext) => {
    const user = ctx.requireAuth();
    const data =
      ctx.request.data && typeof ctx.request.data === "object"
        ? (ctx.request.data as Record<string, unknown>)
        : {};
    const normalized = {
      ...data,
      toCurrency: data.toCurrency ?? data.payCurrency,
      network: data.network ?? data.payNetwork,
    };
    const parsed = walletStaticAddressSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid static address payload", {
        details: parsed.error.flatten() as Record<string, unknown>,
      });
    }
    const result = await walletService.getOrCreateStaticAddress(
      user.userId,
      parsed.data.provider,
      parsed.data.toCurrency,
      parsed.data.network,
      ctx.request.requestId,
    );
    return { data: result };
  };

  router.register("wallet.deposit.methods", {
    authRequired: true,
    mutating: false,
    handler: async () => {
      const methods = await walletService.getDepositMethods();
      return { data: methods };
    },
  });

  router.register("wallet.withdraw.methods", {
    authRequired: true,
    mutating: false,
    handler: async () => {
      const methods = await walletService.getWithdrawMethods();
      return { data: methods };
    },
  });

  router.register("wallet.deposit.staticAddress", {
    authRequired: true,
    mutating: true,
    handler: createStaticAddressHandler,
  });

  router.register("wallet.deposit.invoice", {
    authRequired: true,
    mutating: true,
    handler: createStaticAddressHandler,
  });

  router.register("wallet.balance.get", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const balance = await walletService.getBalance(user.userId);
      return { data: balance };
    },
  });

  router.register("wallet.deposit.request", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = walletAmountSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid deposit payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const result = await walletService.deposit(user.userId, parsed.data.amount, ctx.request.requestId);
      return { data: result };
    },
  });

  router.register("wallet.withdraw.request", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = walletWithdrawSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid withdraw payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const result = await walletService.requestWithdraw({
        userId: user.userId,
        amount: parsed.data.amount,
        provider: parsed.data.provider,
        currency: parsed.data.currency,
        network: parsed.data.network,
        address: parsed.data.address,
        requestId: ctx.request.requestId,
      });
      return { data: result };
    },
  });

  router.register("wallet.exchange", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = walletExchangeSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid exchange payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const result = await walletService.exchange(
        user.userId,
        parsed.data.from,
        parsed.data.to,
        parsed.data.amount,
        ctx.request.requestId,
      );
      return { data: result };
    },
  });
};

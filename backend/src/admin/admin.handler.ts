import { z } from "zod";
import { AppError } from "../common/errors";
import type { CommandContext } from "../common/request-context";
import type { WsRouter } from "../infra/ws/router";
import type { AdminService } from "./admin.service";

const usersListSchema = z.object({
  page: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  query: z.string().max(64).optional(),
});

const userDetailSchema = z.object({
  userId: z.string().min(1),
});

const userUpdateSchema = z.object({
  userId: z.string().min(1),
  balance: z.number().min(0).max(1_000_000_000),
  bonus: z.number().min(0).max(1_000_000_000),
  role: z.enum(["admin", "moder", "youtuber", "user"]),
  ban: z.boolean(),
  banReason: z.string().max(512).optional(),
  chatBanUntil: z.union([z.string(), z.number(), z.null()]).optional(),
  chatBanReason: z.string().max(512).optional(),
});

const idPayloadSchema = z.object({
  id: z.string().min(1),
});

const withdrawAcceptPayloadSchema = z.object({
  id: z.string().min(1),
  txHash: z.string().trim().min(1).max(512),
});

const withdrawReturnPayloadSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(1).max(512),
});

const bonusPayloadSchema = z.object({
  sum: z.number().min(0).max(1_000_000_000),
  type: z.enum(["group", "refs"]),
  bg: z.string().min(1).max(64),
  color: z.string().min(1).max(64),
  status: z.boolean(),
});

const bonusUpdatePayloadSchema = bonusPayloadSchema.extend({
  id: z.string().min(1),
});

const promoPayloadSchema = z.object({
  code: z.string().min(1).max(64),
  type: z.enum(["balance", "bonus"]),
  limit: z.boolean(),
  amount: z.number().min(0).max(1_000_000_000),
  countUse: z.number().int().min(0).max(1_000_000_000),
});

const promoUpdatePayloadSchema = promoPayloadSchema.extend({
  id: z.string().min(1),
  active: z.boolean().optional(),
});

const filterPayloadSchema = z.object({
  word: z.string().min(1).max(255),
});

const filterUpdatePayloadSchema = filterPayloadSchema.extend({
  id: z.string().min(1),
});

const settingsRoomSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(64),
  title: z.string().max(128).optional(),
  time: z.union([z.string(), z.number()]).optional(),
  min: z.union([z.string(), z.number()]).optional(),
  max: z.union([z.string(), z.number()]).optional(),
  bets: z.union([z.string(), z.number()]).optional(),
});

const settingsSavePayloadSchema = z.object({
  settings: z.record(z.unknown()).default({}),
  rooms: z.array(settingsRoomSchema).default([]),
});
const walletProviderSelectionSchema = z.object({
  code: z.string().trim().min(1).max(24),
  networks: z.array(z.string().trim().min(1).max(80)).default([]),
});
const walletProviderFlowSchema = z.object({
  enabled: z.boolean(),
  selections: z.array(walletProviderSelectionSchema).default([]),
});
const walletProviderConfigSaveSchema = z.object({
  provider: z.literal("oxapay").optional(),
  deposit: walletProviderFlowSchema,
  withdraw: walletProviderFlowSchema,
});

const ensureAdmin = (ctx: CommandContext): void => {
  const user = ctx.requireAuth();
  if (!user.roles.includes("admin")) {
    throw new AppError("FORBIDDEN", "Admin role required");
  }
};

export const registerAdminHandlers = (router: WsRouter, adminService: AdminService): void => {
  router.register("admin.overview", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const overview = await adminService.getOverview();
      return { data: overview };
    },
  });

  router.register("admin.users.list", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = usersListSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid admin users list payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const result = await adminService.listUsers(parsed.data);
      return { data: result };
    },
  });

  router.register("admin.user.get", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = userDetailSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid admin user detail payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const result = await adminService.getUserDetail(parsed.data.userId);
      return { data: result };
    },
  });

  router.register("admin.user.update", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = userUpdateSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid admin user update payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const result = await adminService.updateUser(parsed.data);
      return { data: result };
    },
  });

  router.register("admin.bonus.list", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      return { data: await adminService.listBonuses() };
    },
  });

  router.register("admin.bonus.create", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = bonusPayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid bonus payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.createBonus(parsed.data) };
    },
  });

  router.register("admin.bonus.update", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = bonusUpdatePayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid bonus update payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const { id, ...payload } = parsed.data;
      return { data: await adminService.updateBonus(id, payload) };
    },
  });

  router.register("admin.bonus.delete", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = idPayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid bonus delete payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.deleteBonus(parsed.data.id) };
    },
  });

  router.register("admin.promo.list", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      return { data: await adminService.listPromos() };
    },
  });

  router.register("admin.promo.create", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = promoPayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid promo payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.createPromo(parsed.data) };
    },
  });

  router.register("admin.promo.update", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = promoUpdatePayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid promo update payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const { id, active = true, ...payload } = parsed.data;
      return { data: await adminService.updatePromo(id, { ...payload, active }) };
    },
  });

  router.register("admin.promo.delete", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = idPayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid promo delete payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.deletePromo(parsed.data.id) };
    },
  });

  router.register("admin.filter.list", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      return { data: await adminService.listFilters() };
    },
  });

  router.register("admin.filter.create", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = filterPayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid filter payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.createFilter(parsed.data.word) };
    },
  });

  router.register("admin.filter.update", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = filterUpdatePayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid filter update payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.updateFilter(parsed.data.id, parsed.data.word) };
    },
  });

  router.register("admin.filter.delete", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = idPayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid filter delete payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.deleteFilter(parsed.data.id) };
    },
  });

  router.register("admin.withdraws.list", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      return { data: await adminService.listWithdraws() };
    },
  });

  router.register("admin.withdraw.accept", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = withdrawAcceptPayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid withdraw accept payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.acceptWithdraw(parsed.data.id, parsed.data.txHash) };
    },
  });

  router.register("admin.withdraw.return", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = withdrawReturnPayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid withdraw return payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.returnWithdraw(parsed.data.id, parsed.data.reason) };
    },
  });

  router.register("admin.settings.get", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      return { data: await adminService.getSettings() };
    },
  });

  router.register("admin.settings.save", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = settingsSavePayloadSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid settings payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.saveSettings(parsed.data) };
    },
  });
  router.register("admin.wallet.providerConfig.get", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      return { data: await adminService.getWalletProviderConfig() };
    },
  });
  router.register("admin.wallet.providerConfig.save", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      ensureAdmin(ctx);
      const parsed = walletProviderConfigSaveSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid wallet provider config payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      return { data: await adminService.saveWalletProviderConfig(parsed.data) };
    },
  });
};

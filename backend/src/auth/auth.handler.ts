import { AppError } from "../common/errors";
import type { WsRouter } from "../infra/ws/router";
import { loginSchema, refreshSchema, registerSchema, revokeSessionSchema } from "./auth.schema";
import type { AuthService } from "./auth.service";

export const registerAuthHandlers = (router: WsRouter, authService: AuthService): void => {
  router.register("auth.register", {
    mutating: true,
    handler: async (ctx) => {
      const parsed = registerSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid register payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const result = await authService.register(parsed.data);
      ctx.client.authUser = result.user;
      ctx.client.authUserId = result.user.userId;
      ctx.client.subscriptions.add(result.user.userId);
      return { data: result };
    },
  });

  router.register("auth.login", {
    mutating: true,
    handler: async (ctx) => {
      const parsed = loginSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid login payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const result = await authService.login(parsed.data);
      ctx.client.authUser = result.user;
      ctx.client.authUserId = result.user.userId;
      ctx.client.subscriptions.add(result.user.userId);
      return { data: result };
    },
  });

  router.register("auth.refresh", {
    mutating: true,
    handler: async (ctx) => {
      const parsed = refreshSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid refresh payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const result = await authService.refresh(parsed.data);
      ctx.client.authUser = result.user;
      ctx.client.authUserId = result.user.userId;
      ctx.client.subscriptions.add(result.user.userId);
      return { data: result };
    },
  });

  router.register("auth.logout", {
    mutating: true,
    authRequired: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      await authService.logout(user);
      ctx.client.authUser = null;
      ctx.client.subscriptions.delete(user.userId);
      ctx.client.authUserId = null;
      return { data: { success: true } };
    },
  });

  router.register("auth.me", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const me = await authService.me(user);
      return { data: me };
    },
  });

  router.register("auth.sessions.list", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const sessions = await authService.listSessions(user);
      return { data: sessions };
    },
  });

  router.register("auth.sessions.revoke", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = revokeSessionSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid revoke payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      await authService.revokeSession(user, parsed.data);
      return { data: { success: true } };
    },
  });
};

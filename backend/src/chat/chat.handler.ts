import { AppError } from "../common/errors";
import type { WsRouter } from "../infra/ws/router";
import type { ChatService } from "./chat.service";

export const registerChatHandlers = (router: WsRouter, chatService: ChatService): void => {
  router.register("chat.online", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => ({
      data: {
        count: ctx.metrics.activeConnections,
      },
    }),
  });

  router.register("chat.subscribe", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      ctx.client.subscriptions.add("chat");
      return { data: { subscribed: true } };
    },
  });

  router.register("chat.history", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      const limitRaw = (ctx.request.data as { limit?: unknown })?.limit;
      const limit = typeof limitRaw === "number" ? limitRaw : 50;
      const history = await chatService.history(limit);
      return { data: history };
    },
  });

  router.register("chat.userCard", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      const userId = (ctx.request.data as { userId?: unknown })?.userId;
      if (typeof userId !== "string" || userId.trim().length === 0) {
        throw new AppError("VALIDATION_ERROR", "userId is required");
      }
      const card = await chatService.getUserCard(userId);
      return { data: card };
    },
  });
  router.register("chat.send", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const message = await chatService.send(user.userId, user.username, ctx.request.data);
      return { data: message };
    },
  });

  router.register("chat.clear", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      if (!user.roles.includes("admin")) {
        throw new AppError("FORBIDDEN", "Admin role required");
      }
      await chatService.clear();
      return { data: { success: true } };
    },
  });

  router.register("chat.delete", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      if (!user.roles.includes("admin")) {
        throw new AppError("FORBIDDEN", "Admin role required");
      }
      const messageId = (ctx.request.data as { messageId?: unknown })?.messageId;
      if (typeof messageId !== "string" || !/^[a-fA-F0-9]{24}$/.test(messageId)) {
        throw new AppError("VALIDATION_ERROR", "messageId is required");
      }
      await chatService.deleteMessage(messageId);
      return { data: { success: true } };
    },
  });

  router.register("chat.ban", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      if (!user.roles.includes("admin")) {
        throw new AppError("FORBIDDEN", "Admin role required");
      }
      const payload = ctx.request.data as { userId?: unknown; durationSec?: unknown };
      if (typeof payload.userId !== "string" || payload.userId.length === 0) {
        throw new AppError("VALIDATION_ERROR", "userId is required");
      }
      const durationSec = typeof payload.durationSec === "number" && payload.durationSec > 0 ? payload.durationSec : 300;
      const result = await chatService.banUser(payload.userId, durationSec);
      return { data: result };
    },
  });
};

import { AppError } from "../common/errors";
import type { WsRouter } from "../infra/ws/router";
import type { AffiliateService } from "./affiliate.service";

export const registerAffiliateHandlers = (
  router: WsRouter,
  affiliateService: AffiliateService,
): void => {
  router.register("affiliate.stats", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const data = await affiliateService.getStats(user.userId);
      return { data };
    },
  });

  router.register("affiliate.claim", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const data = await affiliateService.claim(user.userId, ctx.request.requestId);
      return { data };
    },
  });

  router.register("affiliate.visit", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      const payload = ctx.request.data;
      if (!payload || typeof payload !== "object") {
        throw new AppError("VALIDATION_ERROR", "Invalid affiliate visit payload");
      }
      const data = payload as { refCode?: unknown; visitorId?: unknown };
      if (typeof data.refCode !== "string" || typeof data.visitorId !== "string") {
        throw new AppError("VALIDATION_ERROR", "Invalid affiliate visit payload");
      }
      const tracked = await affiliateService.trackVisit({
        refCode: data.refCode,
        visitorId: data.visitorId,
      });
      return { data: tracked };
    },
  });
};

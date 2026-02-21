import type { WsRouter } from "../infra/ws/router";
import type { BonusService } from "./bonus.service";

export const registerBonusHandlers = (router: WsRouter, bonusService: BonusService): void => {
  router.register("bonus.getWheel", {
    authRequired: false,
    mutating: false,
    handler: async () => {
      return { data: bonusService.getWheel() };
    },
  });

  router.register("bonus.spin", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const result = await bonusService.spin(user.userId, ctx.request.requestId);
      return { data: result };
    },
  });
};


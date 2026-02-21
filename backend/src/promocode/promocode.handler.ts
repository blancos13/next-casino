import { AppError } from "../common/errors";
import type { WsRouter } from "../infra/ws/router";
import { promoRedeemSchema } from "./promocode.schema";
import type { PromoCodeService } from "./promocode.service";

export const registerPromoHandlers = (router: WsRouter, promoService: PromoCodeService): void => {
  router.register("promo.redeem", {
    authRequired: true,
    mutating: true,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const parsed = promoRedeemSchema.safeParse(ctx.request.data);
      if (!parsed.success) {
        throw new AppError("VALIDATION_ERROR", "Invalid promo payload", {
          details: parsed.error.flatten() as Record<string, unknown>,
        });
      }
      const result = await promoService.redeem(user.userId, parsed.data.code, ctx.request.requestId);
      return { data: result };
    },
  });
};

import type { WsRouter } from "../infra/ws/router";
import type { ProfileService } from "./profile.service";

export const registerProfileHandlers = (router: WsRouter, profileService: ProfileService): void => {
  router.register("user.profile.get", {
    authRequired: true,
    mutating: false,
    handler: async (ctx) => {
      const user = ctx.requireAuth();
      const profile = await profileService.getProfile(user.userId);
      return { data: profile };
    },
  });
};


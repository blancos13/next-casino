import { z } from "zod";

export const promoRedeemSchema = z.object({
  code: z.string().min(2).max(32),
});


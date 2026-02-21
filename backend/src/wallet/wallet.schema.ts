import { z } from "zod";

export const walletAmountSchema = z.object({
  amount: z.number().positive().max(1000000),
});

export const walletExchangeSchema = z.object({
  from: z.enum(["main", "bonus"]),
  to: z.enum(["main", "bonus"]),
  amount: z.number().positive().max(1000000),
});

export const walletWithdrawSchema = z.object({
  amount: z.number().positive().max(1000000),
  provider: z.literal("oxapay").default("oxapay"),
  currency: z.string().trim().toUpperCase().min(2).max(16),
  network: z.string().trim().min(2).max(64),
  address: z.string().trim().min(6).max(256),
});

export const walletStaticAddressSchema = z.object({
  provider: z.literal("oxapay").default("oxapay"),
  toCurrency: z.string().trim().toUpperCase().min(2).max(16).default("USDT"),
  network: z.string().trim().min(2).max(64).default("Tron"),
});

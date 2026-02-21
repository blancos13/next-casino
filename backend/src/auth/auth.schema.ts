import { z } from "zod";

export const registerSchema = z.object({
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128),
  refCode: z.string().min(2).max(64).optional(),
});

export const loginSchema = z.object({
  username: z.string().min(3).max(24),
  password: z.string().min(8).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const revokeSessionSchema = z.object({
  sessionId: z.string().min(1),
});

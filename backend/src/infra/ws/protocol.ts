import { z } from "zod";
import { AppError } from "../../common/errors";

const wsAuthSchema = z.object({
  accessToken: z.string().min(1),
});

const wsRequestSchema = z.object({
  type: z.string().min(1),
  requestId: z.string().min(1).max(128).optional(),
  ts: z.number().int().optional(),
  auth: wsAuthSchema.optional(),
  data: z.unknown(),
});

export type WsAuth = z.infer<typeof wsAuthSchema>;

export type ValidWsRequest = z.infer<typeof wsRequestSchema> & {
  ts: number;
};

export type WsRequest<T> = {
  type: string;
  requestId: string;
  ts: number;
  auth?: WsAuth;
  data: T;
};

export type WsResponseError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type WsResponse<T> = {
  type: string;
  requestId: string;
  ok: boolean;
  serverTs: number;
  data?: T;
  error?: WsResponseError;
  eventId?: string;
  stateVersion?: number;
};

export const parseWsRequest = (raw: string): ValidWsRequest => {
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(raw);
  } catch (error) {
    throw new AppError("VALIDATION_ERROR", "Invalid JSON payload", { cause: error });
  }
  const parsed = wsRequestSchema.safeParse(parsedRaw);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid WS request", {
      details: parsed.error.flatten(),
    });
  }
  return {
    ...parsed.data,
    ts: parsed.data.ts ?? Date.now(),
  };
};

export const makeSuccessResponse = <T>(params: {
  type: string;
  requestId: string;
  data?: T;
  eventId?: string;
  stateVersion?: number;
}): WsResponse<T> => ({
  type: params.type,
  requestId: params.requestId,
  ok: true,
  serverTs: Date.now(),
  data: params.data,
  eventId: params.eventId,
  stateVersion: params.stateVersion,
});

export const makeErrorResponse = (params: {
  type: string;
  requestId: string;
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}): WsResponse<never> => ({
  type: params.type,
  requestId: params.requestId,
  ok: false,
  serverTs: Date.now(),
  error: {
    code: params.code,
    message: params.message,
    retryable: params.retryable,
    details: params.details,
  },
});


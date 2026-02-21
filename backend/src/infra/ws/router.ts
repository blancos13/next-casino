import { randomUUID } from "crypto";
import { AppError, isAppError } from "../../common/errors";
import type { AppContext, AuthUser, CommandContext } from "../../common/request-context";
import type { WsServerClient } from "./server";
import {
  makeErrorResponse,
  makeSuccessResponse,
  parseWsRequest,
  type ValidWsRequest,
  type WsResponse,
} from "./protocol";

type RouteHandlerResult = {
  responseType?: string;
  data?: unknown;
  eventId?: string;
  stateVersion?: number;
};

type RouteHandler = (ctx: CommandContext) => Promise<RouteHandlerResult | void>;

type RouteDefinition = {
  authRequired?: boolean;
  mutating?: boolean;
  handler: RouteHandler;
};

export class WsRouter {
  private readonly routes = new Map<string, RouteDefinition>();
  private readonly aliases = new Map<string, string>();

  register(type: string, definition: RouteDefinition): void {
    this.routes.set(type, definition);
  }

  registerAlias(aliasType: string, targetType: string): void {
    this.aliases.set(aliasType, targetType);
  }

  async handleRawMessage(context: AppContext, client: WsServerClient, raw: string): Promise<WsResponse<unknown>> {
    context.metrics.totalRequests += 1;
    const startedAt = Date.now();

    let request: ValidWsRequest;
    try {
      request = parseWsRequest(raw);
    } catch (error) {
      return this.errorFromUnknown({
        requestType: "request.error",
        requestId: randomUUID(),
        error,
      });
    }

    const resolvedType = this.aliases.get(request.type) ?? request.type;
    const normalizedRequest: ValidWsRequest = {
      ...request,
      type: resolvedType,
    };

    const route = this.routes.get(normalizedRequest.type);
    if (!route) {
      return makeErrorResponse({
        type: `${normalizedRequest.type}.result`,
        requestId: request.requestId ?? randomUUID(),
        code: "NOT_FOUND",
        message: `Unknown command type: ${normalizedRequest.type}`,
        retryable: false,
      });
    }

    let authUser: AuthUser | null = client.authUser;
    const accessToken = normalizedRequest.auth?.accessToken;
    if (accessToken) {
      try {
        const resolvedUser = await this.resolveAuth(context, accessToken);
        authUser = resolvedUser;
        if (!resolvedUser) {
          client.authUser = null;
          client.authUserId = null;
        }
      } catch (error) {
        context.metrics.totalErrors += 1;
        return this.errorFromUnknown({
          requestType: `${normalizedRequest.type}.result`,
          requestId: request.requestId ?? randomUUID(),
          error,
        });
      }
    }
    if (route.authRequired && !authUser) {
      return makeErrorResponse({
        type: `${normalizedRequest.type}.result`,
        requestId: request.requestId ?? randomUUID(),
        code: "UNAUTHORIZED",
        message: "Authentication required",
        retryable: false,
      });
    }

    if (authUser) {
      client.authUser = authUser;
      client.authUserId = authUser.userId;
      client.subscriptions.add(authUser.userId);
    }

    if (route.mutating && !request.requestId) {
      return makeErrorResponse({
        type: `${normalizedRequest.type}.result`,
        requestId: randomUUID(),
        code: "VALIDATION_ERROR",
        message: "requestId is required for mutating commands",
        retryable: false,
      });
    }

    const requestId = request.requestId ?? randomUUID();
    const idempotencyUserId = authUser?.userId ?? `anon:${client.id}`;

    if (route.mutating && request.requestId) {
      const beginState = await context.requestLedger.begin(
        idempotencyUserId,
        normalizedRequest.requestId!,
        normalizedRequest.type,
      );
      if (beginState.kind === "processing") {
        context.metrics.requestInProgress += 1;
        return makeErrorResponse({
          type: `${normalizedRequest.type}.result`,
          requestId,
          code: "REQUEST_IN_PROGRESS",
          message: "Request with same requestId is currently processing",
          retryable: true,
        });
      }
      if (beginState.kind === "completed") {
        return beginState.response;
      }
    }

    const commandContext: CommandContext = {
      ...context,
      client,
      request: normalizedRequest,
      authUser,
      requireAuth: () => {
        if (!authUser) {
          throw new AppError("UNAUTHORIZED", "Authentication required");
        }
        return authUser;
      },
    };

    try {
      const result = await route.handler(commandContext);
      const response = makeSuccessResponse({
        type: result?.responseType ?? `${normalizedRequest.type}.result`,
        requestId,
        data: result?.data,
        eventId: result?.eventId,
        stateVersion: result?.stateVersion,
      });
      if (route.mutating && normalizedRequest.requestId) {
        await context.requestLedger.complete(idempotencyUserId, normalizedRequest.requestId!, response);
      }
      context.logger.info(
        {
          module: "ws.router",
          type: normalizedRequest.type,
          requestId,
          userId: authUser?.userId ?? null,
          latencyMs: Date.now() - startedAt,
        },
        "WS command completed",
      );
      return response;
    } catch (error) {
      context.metrics.totalErrors += 1;
      if (isAppError(error) && error.code === "LOCK_TIMEOUT") {
        context.metrics.lockTimeouts += 1;
      }
      if (route.mutating && normalizedRequest.requestId) {
        await context.requestLedger.fail(idempotencyUserId, normalizedRequest.requestId!);
      }
      const logPayload = {
        module: "ws.router",
        type: normalizedRequest.type,
        requestId,
        userId: authUser?.userId ?? null,
        latencyMs: Date.now() - startedAt,
        err: error,
      };
      if (
        isAppError(error) &&
        ["CONFLICT", "VALIDATION_ERROR", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND"].includes(error.code)
      ) {
        context.logger.warn(logPayload, "WS command rejected");
      } else {
        context.logger.error(logPayload, "WS command failed");
      }
      return this.errorFromUnknown({
        requestType: `${normalizedRequest.type}.result`,
        requestId,
        error,
      });
    }
  }

  private async resolveAuth(context: AppContext, token: string): Promise<AuthUser | null> {
    try {
      return await context.services.authService.resolveAccessToken(token);
    } catch (error) {
      if (isAppError(error) && error.code === "UNAUTHORIZED") {
        return null;
      }
      throw error;
    }
  }

  private errorFromUnknown(input: {
    requestType: string;
    requestId: string;
    error: unknown;
  }): WsResponse<never> {
    if (isAppError(input.error)) {
      return makeErrorResponse({
        type: input.requestType,
        requestId: input.requestId,
        code: input.error.code,
        message: input.error.message,
        retryable: input.error.retryable,
        details: input.error.details,
      });
    }
    return makeErrorResponse({
      type: input.requestType,
      requestId: input.requestId,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      retryable: false,
      details:
        input.error instanceof Error
          ? {
              name: input.error.name,
            }
          : undefined,
    });
  }
}

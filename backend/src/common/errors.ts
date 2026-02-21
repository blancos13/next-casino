export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INSUFFICIENT_BALANCE"
  | "LOCK_TIMEOUT"
  | "REQUEST_IN_PROGRESS"
  | "DUPLICATE_REQUEST"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;


import { AppError } from "./errors";

export const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) {
    throw new AppError("VALIDATION_ERROR", message);
  }
};

export const asString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("VALIDATION_ERROR", `${field} must be a non-empty string`);
  }
  return value.trim();
};

export const asNumber = (value: unknown, field: string): number => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new AppError("VALIDATION_ERROR", `${field} must be a valid number`);
  }
  return value;
};


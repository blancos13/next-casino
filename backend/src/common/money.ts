import { Decimal128 } from "mongodb";
import { AppError } from "./errors";

const SCALE = 1_000_000n;

export const moneyToAtomic = (value: number): bigint => {
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError("VALIDATION_ERROR", "Invalid money amount");
  }
  return BigInt(Math.round(value * Number(SCALE)));
};

export const atomicToMoney = (value: bigint): number => Number(value) / Number(SCALE);

export const decimalFromAtomic = (value: bigint): Decimal128 => {
  const sign = value < 0n ? "-" : "";
  const raw = (value < 0n ? -value : value).toString().padStart(7, "0");
  const integerPart = raw.slice(0, -6) || "0";
  const fracPart = raw.slice(-6);
  return Decimal128.fromString(`${sign}${integerPart}.${fracPart}`);
};

export const atomicFromDecimal = (value: Decimal128 | null | undefined): bigint => {
  if (!value) {
    return 0n;
  }
  const text = value.toString();
  const negative = text.startsWith("-");
  const clean = negative ? text.slice(1) : text;
  const [intPart, fracPart = ""] = clean.split(".");
  const normalizedFrac = `${fracPart}000000`.slice(0, 6);
  const whole = BigInt(intPart || "0") * SCALE;
  const frac = BigInt(normalizedFrac);
  const result = whole + frac;
  return negative ? -result : result;
};

export const formatMoney = (value: bigint, fractionDigits = 2): string => {
  return atomicToMoney(value).toFixed(fractionDigits);
};


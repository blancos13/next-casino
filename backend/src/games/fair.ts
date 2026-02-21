import type { Db, Document } from "mongodb";
import { AppError } from "../common/errors";
import type { WsRouter } from "../infra/ws/router";

type FairResult = {
  game: "jackpot" | "wheel" | "crash" | "coinflip" | "battle" | "dice";
  hash: string;
  round: string | number;
  number: string | number;
};

const wheelNumberByColor: Record<string, number> = {
  black: 2,
  red: 3,
  green: 5,
  yellow: 50,
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const asString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  return "";
};

const normalizeHash = (value: string): string => value.trim().toLowerCase();

const normalizeCompactHash = (value: string): string => value.trim().toLowerCase().replace(/-/g, "");

const dashedUuidFromCompact = (value: string): string | null => {
  if (!/^[a-f0-9]{32}$/i.test(value)) {
    return null;
  }
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};

const resolveRound = (primary: unknown, fallback: unknown): string | number => {
  const primaryNumber = asNumber(primary);
  if (primaryNumber !== null) {
    return Number.isInteger(primaryNumber) ? primaryNumber : Number(primaryNumber.toFixed(4));
  }
  const primaryString = asString(primary).trim();
  if (primaryString) {
    return primaryString;
  }
  const fallbackNumber = asNumber(fallback);
  if (fallbackNumber !== null) {
    return Number.isInteger(fallbackNumber) ? fallbackNumber : Number(fallbackNumber.toFixed(4));
  }
  const fallbackString = asString(fallback).trim();
  if (fallbackString) {
    return fallbackString;
  }
  return "-";
};

const resolveFairResult = async (db: Db, hashInput: string): Promise<FairResult> => {
  const hash = normalizeHash(hashInput);
  const compactHash = normalizeCompactHash(hashInput);

  const jackpot = await db.collection<Document>("jackpot_rounds").findOne(
    { hash },
    { projection: { hash: 1, gameId: 1, roundId: 1, winner: 1 } },
  );
  if (jackpot) {
    const winner = jackpot.winner && typeof jackpot.winner === "object" ? (jackpot.winner as Document) : null;
    const ticket = winner ? asNumber(winner.ticket) : null;
    if (ticket !== null) {
      return {
        game: "jackpot",
        hash,
        round: resolveRound(jackpot.gameId, jackpot.roundId),
        number: Number.isInteger(ticket) ? ticket : Number(ticket.toFixed(4)),
      };
    }
  }

  const wheel = await db.collection<Document>("wheel_rounds").findOne(
    { hash },
    { projection: { hash: 1, roundId: 1, resultColor: 1 } },
  );
  if (wheel) {
    const color = asString(wheel.resultColor).toLowerCase();
    const payout = wheelNumberByColor[color];
    if (typeof payout === "number") {
      return {
        game: "wheel",
        hash,
        round: resolveRound(wheel.roundId, wheel._id),
        number: payout,
      };
    }
  }

  const crash = await db.collection<Document>("crash_rounds").findOne(
    { hash },
    { projection: { hash: 1, roundId: 1, crashPoint: 1 } },
  );
  if (crash) {
    const crashPoint = asNumber(crash.crashPoint);
    if (crashPoint !== null) {
      return {
        game: "crash",
        hash,
        round: resolveRound(crash.roundId, crash._id),
        number: Number(crashPoint.toFixed(2)),
      };
    }
  }

  const coinflipCandidates = new Set<string>();
  if (hash) {
    coinflipCandidates.add(hash);
  }
  if (compactHash) {
    coinflipCandidates.add(compactHash);
  }
  const dashedUuid = dashedUuidFromCompact(compactHash);
  if (dashedUuid) {
    coinflipCandidates.add(dashedUuid);
  }

  const coinflip = await db.collection<Document>("coinflip_games").findOne(
    { gameId: { $in: [...coinflipCandidates] } },
    { projection: { gameId: 1, winnerTicket: 1 } },
  );
  if (coinflip) {
    const winnerTicket = asNumber(coinflip.winnerTicket);
    if (winnerTicket !== null) {
      return {
        game: "coinflip",
        hash,
        round: resolveRound(coinflip.gameId, coinflip._id),
        number: Number.isInteger(winnerTicket) ? winnerTicket : Number(winnerTicket.toFixed(4)),
      };
    }
  }

  const battle = await db.collection<Document>("battle_rounds").findOne(
    { hash },
    { projection: { hash: 1, gameId: 1, roundId: 1, winnerTicket: 1 } },
  );
  if (battle) {
    const winnerTicket = asNumber(battle.winnerTicket);
    if (winnerTicket !== null) {
      return {
        game: "battle",
        hash,
        round: resolveRound(battle.gameId, battle.roundId),
        number: Number.isInteger(winnerTicket) ? winnerTicket : Number(winnerTicket.toFixed(4)),
      };
    }
  }

  const dice = await db.collection<Document>("dice_games").findOne(
    { serverSeedHash: hash },
    { projection: { serverSeedHash: 1, betId: 1, _id: 1, roll: 1 } },
  );
  if (dice) {
    const roll = asNumber(dice.roll);
    if (roll !== null) {
      return {
        game: "dice",
        hash,
        round: resolveRound(dice.betId, dice._id),
        number: Number(roll.toFixed(2)),
      };
    }
  }

  throw new AppError("NOT_FOUND", "Unknown hash or round still pending!");
};

export const registerFairHandlers = (router: WsRouter, db: Db): void => {
  router.register("fair.check", {
    authRequired: false,
    mutating: false,
    handler: async (ctx) => {
      const payload = ctx.request.data as { hash?: unknown };
      const hash = typeof payload.hash === "string" ? payload.hash.trim() : "";
      if (!hash) {
        throw new AppError("VALIDATION_ERROR", "Field cannot be empty!");
      }
      const result = await resolveFairResult(db, hash);
      return {
        data: {
          success: true,
          type: "success",
          msg: "Hash found!",
          game: result.game,
          round: result.round,
          number: result.number,
          hash: result.hash,
        },
      };
    },
  });
};


import { z } from "zod";
import { Decimal128, ObjectId, type Db } from "mongodb";
import type { OutboxService } from "../infra/events/outbox";
import { AppError } from "../common/errors";
import { chatMessageCollection } from "./chat-message.model";
import { walletLedgerCollection } from "../wallet/wallet-ledger.model";
import { usersCollection } from "../user/user.model";
import type { ChatMessage, ChatUserCard } from "./chat.types";

const sendSchema = z.object({
  text: z.string().trim().min(1).max(240),
});

export class ChatService {
  private readonly bans = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly outbox: OutboxService,
  ) {}

  async send(userId: string, username: string, raw: unknown): Promise<ChatMessage> {
    const bannedUntil = this.bans.get(userId) ?? 0;
    if (bannedUntil > Date.now()) {
      throw new AppError("FORBIDDEN", "User is chat banned", {
        details: {
          bannedUntil,
        },
      });
    }

    const parsed = sendSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError("VALIDATION_ERROR", "Invalid chat message payload", {
        details: parsed.error.flatten() as Record<string, unknown>,
      });
    }

    const messageText = parsed.data.text;
    const inserted = await chatMessageCollection(this.db).insertOne({
      userId,
      username,
      text: messageText,
      createdAt: new Date(),
    });

    const message: ChatMessage = {
      id: inserted.insertedId.toHexString(),
      userId,
      username,
      text: messageText,
      createdAt: Date.now(),
    };

    await this.outbox.append({
      type: "chat.message",
      aggregateType: "chat",
      aggregateId: message.id,
      version: message.createdAt,
      payload: message,
    });

    return message;
  }

  async history(limit = 50): Promise<ChatMessage[]> {
    const docs = await chatMessageCollection(this.db)
      .find({})
      .sort({ createdAt: -1 })
      .limit(Math.max(1, Math.min(200, limit)))
      .toArray();
    return docs.reverse().map((doc) => ({
      id: doc._id.toHexString(),
      userId: doc.userId,
      username: doc.username,
      text: doc.text,
      createdAt: doc.createdAt.getTime(),
    }));
  }
  async getUserCard(userId: string): Promise<ChatUserCard> {
    const normalizedUserId = userId.trim();
    if (!ObjectId.isValid(normalizedUserId)) {
      throw new AppError("VALIDATION_ERROR", "Invalid user id");
    }
    const user = await usersCollection(this.db).findOne({ _id: new ObjectId(normalizedUserId) });
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found");
    }
    const [betRows, payoutRows] = await Promise.all([
      walletLedgerCollection(this.db)
        .aggregate<{ _id: null; amount: unknown; count: number }>([
          {
            $match: {
              userId: normalizedUserId,
              type: "game_bet",
            },
          },
          {
            $group: {
              _id: null,
              amount: { $sum: "$amountMain" },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      walletLedgerCollection(this.db)
        .aggregate<{ _id: null; wins: number }>([
          {
            $match: {
              userId: normalizedUserId,
              type: "game_payout",
              amountMain: { $gt: Decimal128.fromString("0") },
            },
          },
          {
            $group: {
              _id: null,
              wins: { $sum: 1 },
            },
          },
        ])
        .toArray(),
    ]);
    const betAmountRaw = Math.abs(this.toNumber(betRows[0]?.amount));
    const totalGames = Math.max(0, Math.trunc(betRows[0]?.count ?? 0));
    const wins = Math.max(0, Math.trunc(payoutRows[0]?.wins ?? 0));
    const lose = Math.max(0, totalGames - wins);
    const userWithAvatar = user as typeof user & { avatar?: unknown };
    return {
      userId: normalizedUserId,
      username: typeof user.username === "string" && user.username.trim().length > 0 ? user.username : "Player",
      avatar:
        typeof userWithAvatar.avatar === "string" && userWithAvatar.avatar.trim().length > 0
          ? userWithAvatar.avatar
          : "/img/no_avatar.jpg",
      betAmount: betAmountRaw.toFixed(2),
      totalGames,
      wins,
      lose,
    };
  }

  async clear(): Promise<void> {
    await chatMessageCollection(this.db).deleteMany({});
    await this.outbox.append({
      type: "chat.cleared",
      aggregateType: "chat",
      aggregateId: "global",
      version: Date.now(),
      payload: {},
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    await chatMessageCollection(this.db).deleteOne({ _id: new ObjectId(messageId) });
    await this.outbox.append({
      type: "chat.deleted",
      aggregateType: "chat",
      aggregateId: messageId,
      version: Date.now(),
      payload: { messageId },
    });
  }

  async banUser(userId: string, durationSec: number): Promise<{ bannedUntil: number }> {
    const bannedUntil = Date.now() + durationSec * 1000;
    this.bans.set(userId, bannedUntil);
    await this.outbox.append({
      type: "chat.ban",
      aggregateType: "chat",
      aggregateId: userId,
      version: bannedUntil,
      payload: {
        userId,
        bannedUntil,
      },
    });
    return { bannedUntil };
  }
  private toNumber(value: unknown): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value instanceof Decimal128) {
      const parsed = Number(value.toString());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (value && typeof value === "object" && typeof (value as { toString?: unknown }).toString === "function") {
      const parsed = Number((value as { toString: () => string }).toString());
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }
}

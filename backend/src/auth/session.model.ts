import type { Collection, Db, ObjectId } from "mongodb";

export type SessionDoc = {
  _id: ObjectId;
  userId: string;
  refreshTokenHash: string;
  userAgent?: string;
  ip?: string;
  revoked: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export const sessionsCollection = (db: Db): Collection<SessionDoc> => db.collection<SessionDoc>("sessions");


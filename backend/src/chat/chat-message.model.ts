import type { Collection, Db, ObjectId } from "mongodb";

export type ChatMessageDoc = {
  _id: ObjectId;
  userId: string;
  username: string;
  text: string;
  createdAt: Date;
};

export const chatMessageCollection = (db: Db): Collection<ChatMessageDoc> =>
  db.collection<ChatMessageDoc>("chat_messages");


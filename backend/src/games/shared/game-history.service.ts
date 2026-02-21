import type { Db, ClientSession } from "mongodb";

export class GameHistoryService {
  constructor(private readonly db: Db) {}

  async append(
    collectionName: string,
    payload: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<string> {
    const result = await this.db.collection(collectionName).insertOne(
      {
        ...payload,
        createdAt: new Date(),
      },
      { session },
    );
    return result.insertedId.toString();
  }

  async latest(collectionName: string, limit = 20): Promise<Record<string, unknown>[]> {
    return this.db.collection(collectionName).find({}).sort({ createdAt: -1 }).limit(limit).toArray();
  }
}


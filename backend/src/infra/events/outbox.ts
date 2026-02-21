import { randomUUID } from "crypto";
import type {
  ChangeStream,
  Collection,
  Db,
  ClientSession,
  InsertOneResult,
} from "mongodb";
import type { Logger } from "pino";
import type { StreamEvent } from "./event-bus";
import { EventBus } from "./event-bus";

type OutboxDoc = {
  _id: string;
  eventId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  version: number;
  userId?: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export class OutboxService {
  private readonly collection: Collection<OutboxDoc>;
  private stream: ChangeStream<OutboxDoc> | null = null;

  constructor(
    db: Db,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {
    this.collection = db.collection<OutboxDoc>("event_outbox");
  }

  async append(
    event: Omit<StreamEvent, "eventId" | "createdAt"> & { eventId?: string },
    session?: ClientSession,
  ): Promise<InsertOneResult<OutboxDoc>> {
    const doc: OutboxDoc = {
      _id: randomUUID(),
      eventId: event.eventId ?? randomUUID(),
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      version: event.version,
      userId: event.userId,
      payload: event.payload,
      createdAt: new Date(),
    };
    return this.collection.insertOne(doc, { session });
  }

  async start(): Promise<void> {
    const pipeline = [{ $match: { operationType: "insert" } }];
    this.stream = this.collection.watch(pipeline, {
      fullDocument: "updateLookup",
    });

    this.stream.on("change", (change) => {
      const outbox = change.fullDocument;
      if (!outbox) {
        return;
      }
      this.eventBus.publish({
        eventId: outbox.eventId,
        type: outbox.type,
        aggregateType: outbox.aggregateType,
        aggregateId: outbox.aggregateId,
        version: outbox.version,
        userId: outbox.userId,
        payload: outbox.payload,
        createdAt: outbox.createdAt,
      });
    });

    this.stream.on("error", (error) => {
      this.logger.error({ err: error }, "Outbox change stream error");
    });

    this.stream.on("end", () => {
      this.logger.warn({ module: "outbox" }, "Outbox change stream ended");
    });
  }

  async stop(): Promise<void> {
    await this.stream?.close();
    this.stream = null;
  }
}

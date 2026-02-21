import { randomUUID } from "crypto";
import type { Logger } from "pino";

export type StreamEvent = {
  eventId?: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  version: number;
  userId?: string;
  payload: Record<string, unknown>;
  createdAt?: Date;
};

type Subscriber = (event: StreamEvent) => void;

export class EventBus {
  private readonly subscribers = new Set<Subscriber>();
  private readonly dedupeQueue: string[] = [];
  private readonly dedupeSet = new Set<string>();

  constructor(
    private readonly logger: Logger,
    private readonly dedupeSize: number,
  ) {}

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  publish(event: StreamEvent): void {
    const eventId = event.eventId ?? randomUUID();
    if (this.dedupeSet.has(eventId)) {
      return;
    }
    this.track(eventId);

    const normalized: StreamEvent = {
      ...event,
      eventId,
      createdAt: event.createdAt ?? new Date(),
    };

    for (const subscriber of this.subscribers) {
      try {
        subscriber(normalized);
      } catch (error) {
        this.logger.error({ err: error, eventId, type: event.type }, "Event subscriber failure");
      }
    }
  }

  private track(eventId: string): void {
    this.dedupeSet.add(eventId);
    this.dedupeQueue.push(eventId);
    if (this.dedupeQueue.length > this.dedupeSize) {
      const evicted = this.dedupeQueue.shift();
      if (evicted) {
        this.dedupeSet.delete(evicted);
      }
    }
  }
}


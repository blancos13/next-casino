"use client";

import type { ChatMessage } from "../types";
import { getCasinoBridge, toWsError } from "./casino-bridge";

type ChatStoreState = {
  messages: ChatMessage[];
  status: string;
  onlineCount: number;
};

const DEFAULT_STATE: ChatStoreState = {
  messages: [],
  status: "",
  onlineCount: 0,
};

const toneColor = {
  default: "default" as const,
  loss: "loss" as const,
  win: "win" as const,
};

const formatTime = (createdAt: number): string => {
  const date = new Date(createdAt);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const mapBackendMessage = (payload: unknown): ChatMessage | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as {
    id?: unknown;
    _id?: unknown;
    userId?: unknown;
    avatar?: unknown;
    username?: unknown;
    user?: unknown;
    text?: unknown;
    createdAt?: unknown;
  };

  const messageId =
    typeof data.id === "string"
      ? data.id
      : typeof data._id === "string"
        ? data._id
        : data._id && typeof data._id === "object" && "$oid" in data._id
          ? String((data._id as { $oid: unknown }).$oid)
          : "";

  if (!messageId) {
    return null;
  }

  const username =
    (typeof data.username === "string" && data.username) ||
    (typeof data.user === "string" && data.user) ||
    "Player";

  const text = typeof data.text === "string" ? data.text : "";
  if (!text) {
    return null;
  }

  const createdAt = typeof data.createdAt === "number" ? data.createdAt : Date.now();

  return {
    id: messageId,
    userId: typeof data.userId === "string" ? data.userId : undefined,
    avatar: typeof data.avatar === "string" && data.avatar.trim().length > 0 ? data.avatar : undefined,
    user: username,
    message: text,
    tone: toneColor.default,
    time: formatTime(createdAt),
  };
};

const parseOnlineCount = (payload: unknown): number | null => {
  if (typeof payload === "number" && Number.isFinite(payload)) {
    return Math.max(0, Math.floor(payload));
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const count = (payload as { count?: unknown }).count;
  if (typeof count === "number" && Number.isFinite(count)) {
    return Math.max(0, Math.floor(count));
  }
  return null;
};

class ChatStore {
  private readonly bridge = getCasinoBridge();
  private readonly listeners = new Set<() => void>();
  private readonly knownMessageIds = new Set<string>();
  private initialized = false;
  private state: ChatStoreState = DEFAULT_STATE;

  getSnapshot = (): ChatStoreState => this.state;

  getServerSnapshot = (): ChatStoreState => DEFAULT_STATE;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.initialized) {
      this.initialized = true;
      this.bootstrap();
    }
    return () => {
      this.listeners.delete(listener);
    };
  };

  async sendMessage(text: string): Promise<void> {
    const value = text.trim();
    if (!value) {
      return;
    }

    try {
      await this.bridge.ensureReady();
      await this.bridge.sendChat(value);
      this.patch({ status: "" });
    } catch (error) {
      const wsError = toWsError(error);
      this.patch({ status: wsError.message });
    }
  }

  private patch(patch: Partial<ChatStoreState>): void {
    let hasChanges = false;
    for (const key of Object.keys(patch) as Array<keyof ChatStoreState>) {
      if (!Object.is(this.state[key], patch[key])) {
        hasChanges = true;
        break;
      }
    }

    if (!hasChanges) {
      return;
    }

    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private appendMessage(nextMessage: ChatMessage): void {
    if (this.knownMessageIds.has(nextMessage.id)) {
      return;
    }
    this.knownMessageIds.add(nextMessage.id);
    this.patch({
      messages: [...this.state.messages, nextMessage],
    });
  }

  private setHistory(messages: ChatMessage[]): void {
    const nextIds = new Set<string>();
    const uniqueMessages: ChatMessage[] = [];
    for (const message of messages) {
      if (nextIds.has(message.id)) {
        continue;
      }
      nextIds.add(message.id);
      uniqueMessages.push(message);
    }
    this.knownMessageIds.clear();
    for (const messageId of nextIds) {
      this.knownMessageIds.add(messageId);
    }
    this.patch({ messages: uniqueMessages });
  }

  private bootstrap(): void {
    this.bridge.subscribeEvent("chat.online", (payload) => {
      const onlineCount = parseOnlineCount(payload);
      if (onlineCount === null) {
        return;
      }
      this.patch({ onlineCount });
    });

    this.bridge.subscribeEvent("chat.message", (payload) => {
      const nextMessage = mapBackendMessage(payload);
      if (!nextMessage) {
        return;
      }
      this.appendMessage(nextMessage);
    });

    this.bridge.subscribeEvent("chat.deleted", (payload) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const messageId = (payload as { messageId?: unknown }).messageId;
      if (typeof messageId !== "string") {
        return;
      }
      this.knownMessageIds.delete(messageId);
      this.patch({
        messages: this.state.messages.filter((item) => item.id !== messageId),
      });
    });

    this.bridge.subscribeEvent("chat.cleared", () => {
      this.knownMessageIds.clear();
      this.patch({ messages: [] });
    });

    this.bridge
      .ensureReady()
      .then(async () => {
        const onlineRaw = await this.bridge.getChatOnlineCount();
        const onlineCount = parseOnlineCount(onlineRaw);
        if (onlineCount !== null) {
          this.patch({ onlineCount });
        }
      })
      .then(() => this.bridge.getChatHistory(50))
      .then((historyRaw) => {
        if (!Array.isArray(historyRaw)) {
          return;
        }
        const mapped = historyRaw
          .map((item) => mapBackendMessage(item))
          .filter((item): item is ChatMessage => item !== null);
        this.setHistory(mapped);
      })
      .catch((error) => {
        const wsError = toWsError(error);
        this.patch({ status: wsError.message });
      });
  }
}

type GlobalWithChatStore = typeof globalThis & {
  __win2xChatStore?: ChatStore;
};

export const getChatStore = (): ChatStore => {
  const globalScope = globalThis as GlobalWithChatStore;
  if (!globalScope.__win2xChatStore) {
    globalScope.__win2xChatStore = new ChatStore();
  }
  return globalScope.__win2xChatStore;
};

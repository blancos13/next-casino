"use client";

export type ToastType = "success" | "error" | "warning" | "info";

export type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
};

type ToastStoreState = {
  items: ToastItem[];
};

const DEFAULT_STATE: ToastStoreState = {
  items: [],
};

const makeToastId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

class ToastStore {
  private readonly listeners = new Set<() => void>();
  private readonly dismissTimers = new Map<string, number>();
  private state: ToastStoreState = DEFAULT_STATE;

  getSnapshot = (): ToastStoreState => this.state;

  getServerSnapshot = (): ToastStoreState => DEFAULT_STATE;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  push(type: ToastType, message: string): void {
    const text = message.trim();
    if (!text) {
      return;
    }
    for (const timer of this.dismissTimers.values()) {
      window.clearTimeout(timer);
    }
    this.dismissTimers.clear();
    const id = makeToastId();
    const item: ToastItem = { id, type, message: text };
    this.patch({ items: [item] });
    const timer = window.setTimeout(() => {
      this.dismiss(id);
    }, 3000);
    this.dismissTimers.set(id, timer);
  }

  dismiss(id: string): void {
    const timer = this.dismissTimers.get(id);
    if (timer) {
      window.clearTimeout(timer);
      this.dismissTimers.delete(id);
    }
    this.patch({
      items: this.state.items.filter((item) => item.id !== id),
    });
  }

  private patch(patch: Partial<ToastStoreState>): void {
    let hasChanges = false;
    for (const key of Object.keys(patch) as Array<keyof ToastStoreState>) {
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
}

let singleton: ToastStore | null = null;

export const getToastStore = (): ToastStore => {
  if (!singleton) {
    singleton = new ToastStore();
  }
  return singleton;
};

export const pushToast = (type: ToastType, message: string): void => {
  if (typeof window === "undefined") {
    return;
  }
  getToastStore().push(type, message);
};

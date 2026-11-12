export const DESKTOP_NOTIFICATION_STORAGE_KEY = "accountant-util.desktop-notification-keys.v1";

export interface NotificationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface DesktopNotificationPayload {
  title: string;
  body: string;
}

export type NotificationSender = (payload: DesktopNotificationPayload) => void;

/**
 * Sends each reminder key once and remembers successful sends.
 *
 * The storage is optional so the queue remains usable on unsupported platforms
 * and easy to test. A failed OS send never consumes the key, allowing a retry.
 */
export class NotificationDeduper {
  private readonly notified: Set<string>;

  constructor(
    private readonly storage?: NotificationStorage,
    private readonly storageKey = DESKTOP_NOTIFICATION_STORAGE_KEY
  ) {
    this.notified = new Set(loadKeys(storage, storageKey));
  }

  send<T>(
    items: readonly T[],
    keyOf: (item: T) => string,
    describe: (item: T) => string,
    sender: NotificationSender
  ): number {
    let sent = 0;

    for (const item of items) {
      const key = keyOf(item);
      if (this.notified.has(key)) continue;

      this.notified.add(key);
      try {
        sender({ title: "Accountant Util", body: describe(item) });
        this.persist();
        sent += 1;
      } catch {
        // The OS rejected the toast; leave the item eligible for a retry.
        this.notified.delete(key);
      }
    }

    return sent;
  }

  reset(): void {
    this.notified.clear();
    try {
      if (this.storage?.removeItem) this.storage.removeItem(this.storageKey);
      else this.storage?.setItem(this.storageKey, "[]");
    } catch {
      // Storage can be unavailable or blocked; in-memory reset still works.
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(this.storageKey, JSON.stringify([...this.notified]));
    } catch {
      // Notification delivery must not fail just because persistence is blocked.
    }
  }
}

function loadKeys(storage: NotificationStorage | undefined, storageKey: string): string[] {
  if (!storage) return [];

  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

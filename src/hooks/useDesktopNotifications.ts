import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  NotificationDeduper,
  type NotificationStorage,
} from "../domain/notificationQueue";

/**
 * Desktop notifications that mirror the in-app reminder list.
 *
 * Each due/overdue assignment is announced once per period: the key is derived
 * from the assignment and its due date, so re-renders or app restarts inside the
 * same period do not re-notify. A fresh key is used only once the due date
 * changes.
 */
export function useDesktopNotifications(enabled: boolean) {
  const [permission, setPermission] = useState<"granted" | "denied" | "default">("default");
  const notified = useRef<NotificationDeduper | null>(null);
  if (notified.current === null) {
    notified.current = new NotificationDeduper(getNotificationStorage());
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const granted = await isPermissionGranted();
        if (!cancelled) setPermission(granted ? "granted" : "default");
      } catch {
        // Plugin unavailable (e.g. unsupported platform) - stay silent.
        if (!cancelled) setPermission("denied");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const askForPermission = useCallback(async () => {
    try {
      const result = await requestPermission();
      setPermission(result);
      return result === "granted";
    } catch {
      setPermission("denied");
      return false;
    }
  }, []);

  /**
   * @param items Assignments that are currently due or overdue.
   * @param describe Builds the message for one item.
   */
  const notify = useCallback(
    <T,>(items: T[], keyOf: (item: T) => string, describe: (item: T) => string) => {
      if (!enabled || permission !== "granted" || items.length === 0) return;

      notified.current?.send(
        items,
        keyOf,
        describe,
        (payload) => sendNotification(payload)
      );
    },
    [enabled, permission]
  );

  const reset = useCallback(() => {
    notified.current?.reset();
  }, []);

  return { permission, askForPermission, notify, reset };
}

function getNotificationStorage(): NotificationStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

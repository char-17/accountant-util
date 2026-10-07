import { useCallback, useEffect, useRef, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

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
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
      setPermission(result as "granted" | "denied" | "default");
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
    async <T,>(items: T[], keyOf: (item: T) => string, describe: (item: T) => string) => {
      if (!enabled || permission !== "granted" || items.length === 0) return;

      for (const item of items) {
        const key = keyOf(item);
        if (notified.current.has(key)) continue;
        notified.current.add(key);
        try {
          sendNotification({ title: "Accountant Util", body: describe(item) });
        } catch {
          // If the OS rejects it, drop the key so it can retry next time.
          notified.current.delete(key);
        }
      }
    },
    [enabled, permission]
  );

  const reset = useCallback(() => {
    notified.current.clear();
  }, []);

  return { permission, askForPermission, notify, reset };
}

import { useState, useCallback, useRef, useEffect } from "react";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

/**
 * Central feedback for every user action. Wraps an async operation so success
 * and failure are always reported, and nothing fails silently.
 */
export function useToasts(timeoutMs = 3500) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, kind, message }]);
      timers.current.push(setTimeout(() => dismiss(id), timeoutMs));
    },
    [dismiss, timeoutMs]
  );

  const success = useCallback((m: string) => push("success", m), [push]);
  const error = useCallback((m: string) => push("error", m), [push]);
  const info = useCallback((m: string) => push("info", m), [push]);

  /**
   * Runs an async action, showing the success message on completion and the
   * failure message if it throws. Rethrows nothing: callers get feedback
   * through the toast instead of an unhandled rejection.
   */
  const run = useCallback(
    async <T,>(
      action: () => Promise<T>,
      messages: { success: string; failure?: string }
    ): Promise<T | undefined> => {
      try {
        const result = await action();
        success(messages.success);
        return result;
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        error(messages.failure ? `${messages.failure}: ${raw}` : raw);
        return undefined;
      }
    },
    [success, error]
  );

  return { toasts, push, success, error, info, run, dismiss };
}

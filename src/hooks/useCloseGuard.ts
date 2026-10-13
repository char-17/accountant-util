import { useEffect, useRef } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";

/**
 * Asks before the window closes.
 *
 * The app holds unsaved state - the month being worked on, half-typed notes on a
 * client - and the window's X is one click away from all of it. So the close is
 * held, a question is asked, and only a yes lets it through.
 *
 * Two things make this safe to ship:
 *
 *  - It fails open. If the window API or the dialog is unavailable for any
 *    reason, the close proceeds. The opposite choice - failing closed - would
 *    mean a bug here makes the application impossible to quit, which is a far
 *    worse failure than the one being guarded against.
 *
 *  - The approval is remembered for one close. Once the user has said yes,
 *    `close()` raises the event again, and this time it returns without
 *    preventing, so the window actually goes. Without that the second event
 *    would ask the same question forever.
 */
export function useCloseGuard(
  message = "Θέλετε να κλείσετε το πρόγραμμα; Οι αλλαγές που δεν έχουν αποθηκευτεί θα χαθούν.",
  title = "Έξοδος από το Accountant Util"
): void {
  // Not state: nothing renders from it, and a re-render must not re-arm the
  // guard or re-register the listener.
  const approved = useRef(false);

  useEffect(() => {
    let dispose: (() => void) | undefined;

    void (async () => {
      try {
        // Imported lazily: outside a Tauri window there is no current window to
        // get, and a static import would make this module unimportable in the
        // test harness.
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
          if (approved.current) return;

          event.preventDefault();
          try {
            const answer = await confirm(message, {
              title,
              kind: "warning",
              okLabel: "Κλείσιμο",
              cancelLabel: "Άκυρο",
            });
            if (answer) {
              approved.current = true;
              await getCurrentWindow().close();
            }
          } catch {
            // The dialog could not be shown. Letting the window close is the
            // lesser failure; see the note above.
            approved.current = true;
            await getCurrentWindow().close();
          }
        });
        dispose = unlisten;
      } catch {
        // No Tauri window here - the browser preview, or a test. Nothing to
        // guard, and nothing to break.
      }
    })();

    return () => dispose?.();
  }, [message, title]);
}

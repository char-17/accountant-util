import { useCallback, useEffect, useRef, useState } from "react";
import { toMessage } from "../utils/errors";

/**
 * The slice of the Tauri window API this component uses.
 *
 * Taken as a prop so the behaviour can be exercised in a test, where there is no
 * window and no Tauri IPC to talk to. Left out, it is resolved from the real API
 * on mount.
 */
export interface ClosableWindow {
  onCloseRequested: (
    handler: (event: { preventDefault: () => void }) => void
  ) => Promise<() => void>;
  close: () => Promise<void>;
}

interface CloseGuardProps {
  /** Only for tests; the app leaves it unset. */
  win?: ClosableWindow | null;
  message?: string;
  title?: string;
}

/**
 * Asks before the window closes.
 *
 * The X button is one click away from the month in progress and anything
 * half-typed on a client, so the close is held and a question is asked. Only a
 * yes lets it through.
 *
 * The question is drawn in-app, on the same modal the delete confirmations use,
 * rather than through the native dialog plugin. The native one needed two presses
 * of Cancel to go away on Windows: the close that opened it was still being
 * processed, so the dialog came up again behind the first one. An in-app modal
 * has no such ordering problem, it looks like the rest of the application's
 * questions, and it can be tested - none of which is true of the native call.
 *
 * Two things keep it safe:
 *
 *  - It fails open. If the window API is unavailable for any reason the close
 *    proceeds. Failing closed would mean a bug here makes the application
 *    impossible to quit, which is worse than the mistake being guarded against.
 *
 *  - The approval is remembered for exactly one close. Calling close() raises
 *    the event again; without that the second event would ask the same question
 *    forever and the window would never go.
 */
export function CloseGuard({
  win,
  message = "Θέλετε να κλείσετε το πρόγραμμα; Οι αλλαγές που δεν έχουν αποθηκευτεί θα χαθούν.",
  title = "Έξοδος από το Accountant Util",
}: CloseGuardProps) {
  const [isAsking, setIsAsking] = useState(false);
  const [closeError, setCloseError] = useState("");
  // Not state: nothing renders from it, and a re-render must not re-arm the
  // guard or re-register the listener.
  const approved = useRef(false);
  const windowRef = useRef<ClosableWindow | null>(null);

  const closeNow = useCallback(async () => {
    const target = windowRef.current;
    // Taken down first: the window is about to disappear, but if the close is
    // refused for any reason the user should not be left staring at a modal
    // whose only remaining answer is the one they just pressed.
    setIsAsking(false);
    if (!target) return;
    try {
      approved.current = true;
      await target.close();
    } catch (err) {
      // The window did not go. Re-arm and say why: left armed, the next click on
      // X would close the application without asking, which is the one outcome
      // this component exists to prevent - and it would happen silently.
      approved.current = false;
      setCloseError(toMessage(err));
      setIsAsking(true);
    }
  }, []);

  useEffect(() => {
    let dispose: (() => void) | undefined;

    void (async () => {
      let target = win ?? null;
      if (win === undefined) {
        try {
          // Imported lazily: outside a Tauri window there is nothing to get, and
          // a static import would make this module unimportable in the harness.
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          target = getCurrentWindow() as unknown as ClosableWindow;
        } catch {
          return;
        }
      }
      if (!target) return;
      windowRef.current = target;

      try {
        dispose = await target.onCloseRequested((event) => {
          if (approved.current) return;
          // Synchronous, before anything else: the window stops closing here,
          // and the question is asked afterwards.
          event.preventDefault();
          setCloseError("");
          setIsAsking(true);
        });
      } catch {
        windowRef.current = null;
      }
    })();

    return () => dispose?.();
  }, [win]);

  // Escape is the same answer as Cancel: a modal you cannot back out of with the
  // keyboard is a modal people close with Alt+F4.
  useEffect(() => {
    if (!isAsking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsAsking(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isAsking]);

  if (!isAsking) return null;

  return (
    <div className="modal-backdrop" onClick={() => setIsAsking(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <p>{message}</p>
        {closeError && <div className="error-banner">{closeError}</div>}
        <div className="form-actions">
          <button className="btn-primary" onClick={closeNow}>
            Κλείσιμο
          </button>
          <button className="btn-secondary" onClick={() => setIsAsking(false)}>
            Άκυρο
          </button>
        </div>
      </div>
    </div>
  );
}

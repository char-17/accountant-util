import { useEffect } from "react";
import type { AutoUpdate } from "../hooks/useAutoUpdate";

/**
 * The update offered to the accountant.
 *
 * Three states this has to handle that the plugin does not decide for it:
 *
 *  - **A missing content length.** Not every server sends one. Showing 0% of
 *    0 forever is worse than showing nothing, so the bar turns indeterminate
 *    and the text reports bytes instead.
 *
 *  - **Escape and the backdrop are disabled while installing.** Once the
 *    installer has the executable, the window is about to go on its own.
 *    Letting the dialog be dismissed mid-install leaves the user watching an
 *    application that has already stopped responding, with no idea why.
 *
 *  - **The install is asked about before it starts.** On Windows the updater
 *    exits the process itself - through `std::process::exit(0)`, not through
 *    the window's close request - so the CloseGuard never sees it and there is
 *    no second question later. This dialog is where the one question is asked,
 *    in the same in-app modal the exit question uses, with the same two
 *    buttons. Answering no stops the update and says why; answering yes hands
 *    the installer over, which is the point of no return.
 */
interface UpdateDialogProps {
  update: AutoUpdate;
  /** Called only when the update landed but the application is still running,
   *  so the caller can say a restart is still owed. A restart that worked
   *  never returns, and a failure goes to the dialog's own error banner. */
  onInstalled?: () => void;
}

/** The question, in the wording family of the exit question (CloseGuard). */
const ASK_TITLE = "Ενημέρωση του Accountant Util";
const ASK_MESSAGE =
  "Η ενημέρωση χρειάζεται να κλείσει το πρόγραμμα για να συνεχιστεί. " +
  "Οι αλλαγές που δεν έχουν αποθηκευτεί θα χαθούν. Θέλετε να συνεχίσετε;";

export function UpdateDialog({ update, onInstalled }: UpdateDialogProps) {
  const {
    phase,
    update: available,
    error,
    downloaded,
    total,
    ask,
    decline,
    install,
    dismiss,
  } = update;

  const installing = phase === "installing";
  const asking = phase === "asking";
  const declined = phase === "declined";
  const percent = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  const handleInstall = async () => {
    const result = await install();
    if (result.status === "installed_restart_manually") onInstalled?.();
  };

  // Escape is the same answer as the button it sits next to: in the question it
  // is "no", everywhere else it is "close". Never during an install - the
  // process is on its way out and there is nothing left to answer.
  useEffect(() => {
    if (!available || installing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (asking) decline();
      else dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [available, installing, asking, decline, dismiss]);

  if (!available) return null;

  // RFC 3339 from the server; the plugin hands it over as a Date.
  const releasedOn = available.date
    ? new Date(available.date).toLocaleDateString("el-GR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div
      className="modal-backdrop"
      onClick={
        installing
          ? undefined
          : asking
            ? decline
            : dismiss
      }
    >
      <div
        className="modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Διαθέσιμη ενημέρωση"
        onClick={(e) => e.stopPropagation()}
      >
        {asking ? (
          <>
            <h3>{ASK_TITLE}</h3>
            <p>{ASK_MESSAGE}</p>
            <div className="form-actions">
              <button className="btn-primary" onClick={() => void handleInstall()}>
                Κλείσιμο και ενημέρωση
              </button>
              <button className="btn-secondary" onClick={decline}>
                Άκυρο
              </button>
            </div>
          </>
        ) : declined ? (
          <>
            <h3>Η ενημέρωση δεν συνεχίστηκε</h3>
            <div className="error-banner">{error}</div>
            <div className="form-actions">
              <button className="btn-primary" onClick={dismiss}>
                ΟΚ
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>Υπάρχει νέα έκδοση</h3>

            <p className="update-version">
              Έκδοση <strong>{available.version}</strong>
              {releasedOn && <span className="update-date"> · {releasedOn}</span>}
            </p>

            {available.body && <p className="update-notes">{available.body}</p>}

            {/* The install replaces the executable, so the application closes
                itself once the download finishes. Saying so beforehand is the
                difference between an expected restart and a crash. */}
            <div className="modal-warning">
              Η ενημέρωση θα κλείσει το πρόγραμμα και θα το εγκαταστήσει. Ανοίξτε το
              ξανά όταν τελειώσει.
            </div>

            {installing && (
              <div className="update-progress">
                <div
                  className={total && total > 0 ? "update-progress-track" : "update-progress-track indeterminate"}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  {...(percent !== null ? { "aria-valuenow": percent } : {})}
                >
                  <div
                    className="update-progress-fill"
                    style={percent !== null ? { width: `${percent}%` } : undefined}
                  />
                </div>
                <span className="update-progress-text">
                  {percent !== null
                    ? `${percent}%`
                    : `${Math.round(downloaded / 1024)} KB`}
                </span>
              </div>
            )}

            {error && <div className="error-banner">{error}</div>}

            <div className="form-actions">
              <button className="btn-primary" onClick={ask} disabled={installing}>
                {installing ? "Εγκατάσταση..." : "Εγκατάσταση"}
              </button>
              {!installing && (
                <button className="btn-secondary" onClick={() => dismiss()}>
                  Αργότερα
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

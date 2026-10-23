import { useEffect } from "react";
import type { AutoUpdate } from "../hooks/useAutoUpdate";

/**
 * The update offered to the accountant.
 *
 * Two states this has to handle that the plugin does not decide for it:
 *
 *  - **A missing content length.** Not every server sends one. Showing 0% of
 *    0 forever is worse than showing nothing, so the bar turns indeterminate
 *    and the text reports bytes instead.
 *
 *  - **Escape and the backdrop are disabled while installing.** Once the
 *    installer has the executable, the window is about to go on its own.
 *    Letting the dialog be dismissed mid-install leaves the user watching an
 *    application that has already stopped responding, with no idea why.
 */
interface UpdateDialogProps {
  update: AutoUpdate;
  /** Called only when the update landed but the application is still running,
   *  so the caller can say a restart is still owed. A restart that worked
   *  never returns, and a failure goes to the dialog's own error banner. */
  onInstalled?: () => void;
}

export function UpdateDialog({ update, onInstalled }: UpdateDialogProps) {
  const { phase, update: available, error, downloaded, total, install, dismiss } = update;

  const installing = phase === "installing";
  const percent = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  const handleInstall = async () => {
    const result = await install();
    if (result.status === "installed_restart_manually") onInstalled?.();
  };

  useEffect(() => {
    if (!available || installing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [available, installing, dismiss]);

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
      onClick={installing ? undefined : () => dismiss()}
    >
      <div
        className="modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Διαθέσιμη ενημέρωση"
        onClick={(e) => e.stopPropagation()}
      >
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
          <button className="btn-primary" onClick={() => void handleInstall()} disabled={installing}>
            {installing ? "Εγκατάσταση..." : "Εγκατάσταση"}
          </button>
          {!installing && (
            <button className="btn-secondary" onClick={() => dismiss()}>
              Αργότερα
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

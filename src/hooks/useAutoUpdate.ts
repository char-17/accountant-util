import { useCallback, useRef, useState } from "react";
import { toMessage } from "../utils/errors";

/** As the updater plugin delivers it. `contentLength` is null when the server
 *  did not send one, which is common - the progress bar then runs indeterminate
 *  rather than lying about a total it does not have. */
export type UpdateProgressEvent =
  | { event: "Started"; data: { contentLength?: number | null } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

/** The slice of an `Update` handle this hook uses. Structural, so a test can
 *  pass a plain object instead of a real plugin instance. */
export interface UpdateHandle {
  version: string;
  date?: Date | string | null;
  body?: string | null;
  downloadAndInstall: (onProgress?: (event: UpdateProgressEvent) => void) => Promise<void>;
}

/** The slice of the updater plugin the hook calls. */
export interface UpdaterApi {
  check: (options?: { timeout?: number }) => Promise<UpdateHandle | null>;
}

/**
 * Where the offer is.
 *
 * `asking` and `declined` exist because of what the installer does on Windows:
 * it is handed the executable and the application exits through
 * `std::process::exit(0)` - not through the window's close request, so the
 * CloseGuard never sees it and never asks its question. The consent has to be
 * taken here, before the install starts, or the accountant watches the program
 * disappear with no question having been asked of them.
 */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "ready"
  /** The question about closing is on screen. Nothing has been downloaded. */
  | "asking"
  | "installing"
  /** The question was answered with no. The update did not run. */
  | "declined";

/**
 * What one install concluded.
 *
 * There is deliberately no "restarting" branch: a restart that works never
 * returns to this code, so anything returned here means the application is
 * still running.
 */
export type InstallResult =
  /** Installed, but the application is still up: a restart is owed. */
  | { status: "installed_restart_manually" }
  | { status: "failed"; message: string };

/**
 * What one check concluded.
 *
 * Returned rather than read back from the hook's own state: the caller that
 * asks for a check and immediately looks at `error` would see the value from
 * before it, because the state update has not been applied yet. Every branch
 * is here so nothing has to be guessed from state that is a render behind.
 */
export type CheckResult =
  | { status: "update"; update: UpdateHandle }
  | { status: "up_to_date" }
  /** The plugin is not present - a dev server, or the jsdom tests. */
  | { status: "unavailable" }
  /** A check is already running; this one was not started. */
  | { status: "busy" }
  | { status: "error"; message: string };

export interface AutoUpdate {
  phase: UpdatePhase;
  update: UpdateHandle | null;
  /** Null unless a check or an install actually failed. */
  error: string | null;
  downloaded: number;
  /** Null when the server sent no length, or before the download started. */
  total: number | null;
  check: (options?: { manual?: boolean }) => Promise<CheckResult>;
  /** Puts the pre-install question on screen. The install refuses to run
   *  until it has been answered, so this is the only way in. */
  ask: () => void;
  /** The answer that stops the update. The application stays open, and the
   *  dialog says why nothing was installed. */
  decline: () => void;
  /** Runs the install. Only reachable from `asking` - see the guard inside. */
  install: () => Promise<InstallResult>;
  dismiss: () => void;
  /** True once the plugin resolved, so callers can hide an entry that would
   *  only ever fail - a dev server and the jsdom tests have no updater. */
  available: boolean;
}

/**
 * Why nothing was installed, in the words the accountant sees.
 *
 * Shown when the answer to the closing question is no. The application stays
 * open and the current version keeps working, which is the honest state of
 * affairs: the update is not pending, it simply did not happen.
 */
const DECLINED_MESSAGE =
  "Η ενημέρωση σταμάτησε επειδή το πρόγραμμα έμενε ανοιχτό. Η τρέχουσα έκδοση " +
  "παραμένει σε χρήση — δοκιμάστε ξανά αργότερα.";

/** What the install says when it is called without the question being answered. */
const UNASKED_MESSAGE =
  "Η εγκατάσταση δεν ξεκίνησε: πρέπει πρώτα να απαντηθεί το ερώτημα για το κλείσιμο.";

/**
 * Checks for a newer version and installs it.
 *
 * Four things shape this, none of them visible from the plugin's API:
 *
 *  - **A failed check must not nag.** The auto-check at startup runs against
 *    the network; on a machine with no connection, or while GitHub is down,
 *    opening the application must not produce an error dialog. The caller asks
 *    for `manual` when the accountant clicked something, and only then is a
 *    failure worth showing.
 *
 *  - **The install ends the process on Windows.** The updater hands the work to
 *    the NSIS installer, which cannot replace a running executable, so the app
 *    is exited as part of `downloadAndInstall`. The relaunch call that follows
 *    is therefore usually a no-op on the platform this ships on, and is wrapped
 *    so a rejection there is not mistaken for a failed install.
 *
 *  - **That exit does not ask.** It goes through `std::process::exit(0)`
 *    (tauri-plugin-updater, `install_inner`), never through the window's close
 *    request, so CloseGuard does not see it. The question therefore has to be
 *    asked here, before the install starts, and `install` refuses to run until
 *    it has been answered.
 *
 *  - **The plugin is absent outside an installed build.** In `npm run dev` and
 *    in the jsdom tests there is no updater to talk to. Resolving that once and
 *    remembering it keeps the startup check from throwing on every launch.
 */
export function useAutoUpdate(deps?: {
  /** Only for tests; the app resolves the real plugin lazily. */
  updater?: UpdaterApi | null;
  relaunch?: () => Promise<void>;
}): AutoUpdate {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [update, setUpdate] = useState<UpdateHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [available, setAvailable] = useState(false);

  // A check in flight must not be started twice: two auto-checks racing would
  // both report, and the second would replace a handle the user already said
  // yes to with a fresh one that has not been downloaded.
  const inFlight = useRef(false);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  /** Resolves the real plugin on first use, or null outside an install. */
  const resolveUpdater = useCallback(async (): Promise<UpdaterApi | null> => {
    const injected = depsRef.current?.updater;
    if (injected !== undefined) return injected;
    try {
      const mod = await import("@tauri-apps/plugin-updater");
      return mod as unknown as UpdaterApi;
    } catch {
      return null;
    }
  }, []);

  const check = useCallback(
    async (options?: { manual?: boolean }): Promise<CheckResult> => {
      const manual = options?.manual ?? false;
      if (inFlight.current) return { status: "busy" };

      setPhase("checking");
      setError(null);

      const updater = await resolveUpdater();
      if (!updater) {
        // No plugin: not a failure the user caused, so only the click that
        // asked for it gets an answer.
        setPhase("idle");
        if (manual) setError("Ο έλεγχος ενημερώσεων δεν είναι διαθέσιμος σε αυτή την έκδοση.");
        return { status: "unavailable" };
      }
      setAvailable(true);

      inFlight.current = true;
      try {
        const found = await updater.check();
        if (found) {
          setUpdate(found);
          setPhase("ready");
          return { status: "update", update: found };
        }
        setPhase("idle");
        return { status: "up_to_date" };
      } catch (err) {
        const message = toMessage(err);
        setPhase("idle");
        setError(message);
        return { status: "error", message };
      } finally {
        inFlight.current = false;
      }
    },
    [resolveUpdater]
  );

  const dismiss = useCallback(() => {
    setUpdate(null);
    setError(null);
    setPhase("idle");
    setDownloaded(0);
    setTotal(null);
  }, []);

  /**
   * Brings up the question about closing.
   *
   * Only from `ready`: asking when there is nothing to install would put a
   * question about an update that does not exist in front of the accountant.
   * From any other phase the click is ignored rather than re-armed - a second
   * click while the question is already up must not stack a second one.
   */
  const ask = useCallback(() => {
    setPhase((current) => (current === "ready" ? "asking" : current));
  }, []);

  /** The no answer: the update stops here, and says so. */
  const decline = useCallback(() => {
    setPhase("declined");
    setError(DECLINED_MESSAGE);
  }, []);

  const install = useCallback(async (): Promise<InstallResult> => {
    const current = update;
    if (!current) {
      return { status: "failed", message: "Δεν υπάρχει ενημέρωση προς εγκατάσταση." };
    }

    // The question comes first, every time. The installer exits the process
    // itself and never raises a close request, so nothing downstream gets a
    // second chance to ask - this guard is the only thing standing between an
    // unasked question and an application that closes without one.
    if (phase !== "asking") {
      return { status: "failed", message: UNASKED_MESSAGE };
    }

    setPhase("installing");
    setError(null);
    setDownloaded(0);
    setTotal(null);

    try {
      await current.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength ?? null);
        } else if (event.event === "Progress") {
          setDownloaded((prev) => prev + event.data.chunkLength);
        }
      });
    } catch (err) {
      const message = toMessage(err);
      setPhase("ready");
      setError(message);
      return { status: "failed", message };
    }

    // A restart that works never returns to this line, so everything below runs
    // only where the application is still alive. Neither outcome here is a
    // failure: on Windows the process is already gone inside
    // downloadAndInstall, and a relaunch that rejects on the way out must not
    // report a failed update immediately after a successful one.
    try {
      const relaunch =
        depsRef.current?.relaunch ?? (await import("@tauri-apps/plugin-process")).relaunch;
      await relaunch();
    } catch {
      // The process is on its way out, or relaunch is unavailable.
    }

    // Still here means no restart happened. Leaving the dialog up would wedge
    // the application rather than merely annoy: it is in "installing", so the
    // install button is disabled and Escape does nothing, and there would be
    // no way out but killing the process. The offer is withdrawn instead and
    // the caller is told what is left to do.
    dismiss();
    return { status: "installed_restart_manually" };
  }, [update, phase, dismiss]);

  return { phase, update, error, downloaded, total, check, ask, decline, install, dismiss, available };
}

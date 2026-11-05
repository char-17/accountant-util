import { useEffect } from "react";
import type Database from "@tauri-apps/plugin-sql";
import { AUTO_BACKUP_HOUR } from "../domain/appConfig";
import { planAutoBackup, tomorrowAt } from "../domain/autoBackup";
import { prepareBackupArea } from "../persistence/backupArea";

/**
 * Runs the automatic backup at 3 PM, or as soon as the program is next opened
 * if that moment passed while it was closed.
 *
 * The whole schedule is a loop over `tick`: read how old the newest automatic
 * backup is, and either wait for the moment or take one. Reading the age from
 * the file itself rather than from remembered state is what makes the two
 * halves of the rule the same rule - "closed at 3 PM" and "not opened since"
 * both leave `lastAutoMs` earlier than today's 3 PM, and are answered
 * identically. It also means a hand-deleted backup is noticed on the next
 * launch instead of being reported as done.
 *
 * **It is silent when it works.** A toast at 3 PM every working day is noise
 * the accountant learns to dismiss unread, and the one message that matters is
 * the failure. That is the same reasoning as `migration.rs`, where a failure
 * nobody reports leaves the user staring at an apparently empty application -
 * so errors are surfaced, and successes are left alone.
 *
 * Each scheduled moment gets one attempt. After a failure `lastAutoMs` has not
 * moved, so `planAutoBackup` would still call the moment overdue and a retry
 * would follow immediately, then again: a busy loop aimed at a disk that is
 * already refusing. Tomorrow is scheduled instead, and a restart reads the
 * real file age and tries again, which is where a second attempt belongs.
 *
 * `runBackup` and `reportFailure` have to be stable references. Both are -
 * `useCallback` over `[db]`, and `toasts.error` likewise - because a fresh
 * function on every render would clear the timer each time and the schedule
 * would never fire at all.
 */
export function useAutoBackup(
  db: Database | null,
  runBackup: () => Promise<string>,
  reportFailure: (message: string) => void
): void {
  useEffect(() => {
    if (!db) return;

    let timer: number | undefined;
    let cancelled = false;

    const describe = (err: unknown): string => {
      const reason = err instanceof Error ? err.message : String(err);
      return `Το αυτόματο αντίγραφο ασφαλείας δεν ολοκληρώθηκε: ${reason}`;
    };

    /** Resolves after the next attempt has been scheduled, or not at all. */
    const tick = async (): Promise<void> => {
      if (cancelled) return;

      let lastAutoMs: number | null;
      try {
        lastAutoMs = (await prepareBackupArea()).lastAutoMs;
      } catch (err) {
        // Without the folders there is nothing to schedule against, and no
        // moment worth retrying at - the same call would fail the same way.
        // Reported once, rather than on a timer forever.
        if (!cancelled) reportFailure(describe(err));
        return;
      }
      if (cancelled) return;

      const plan = planAutoBackup(Date.now(), lastAutoMs, AUTO_BACKUP_HOUR);

      if (!plan.dueNow) {
        // `Math.max(0, ...)` for a clock read backwards between the decision
        // and the assignment: a negative delay fires immediately, which is the
        // correct answer anyway.
        timer = window.setTimeout(() => void tick(), Math.max(0, plan.nextAt - Date.now()));
        return;
      }

      try {
        await runBackup();
      } catch (err) {
        if (!cancelled) reportFailure(describe(err));
      }
      if (cancelled) return;

      timer = window.setTimeout(
        () => void tick(),
        Math.max(0, tomorrowAt(Date.now(), AUTO_BACKUP_HOUR) - Date.now())
      );
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [db, runBackup, reportFailure]);
}

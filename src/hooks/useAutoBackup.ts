import { useEffect } from "react";
import type Database from "@tauri-apps/plugin-sql";
import { AUTO_BACKUP_HOUR } from "../domain/appConfig";
import { planAutoBackup, tomorrowAt } from "../domain/autoBackup";
import { prepareBackupArea, type BackupArea } from "../persistence/backupArea";
import { toMessage } from "../utils/errors";
import { logEvent } from "../utils/logging";
import type { AutoBackupStage, RunAutoBackup } from "./useBackup";

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
  runBackup: RunAutoBackup,
  reportFailure: (message: string) => void,
  onAreaReady: (area: BackupArea) => void
): void {
  useEffect(() => {
    if (!db) return;

    let timer: number | undefined;
    let cancelled = false;

    // Each timeout re-reads the file age, including when Windows wakes late.
    const scheduleAt = (at: number): string => {
      if (cancelled) return "none";
      timer = window.setTimeout(() => void tick("timer"), Math.max(0, at - Date.now()));
      return new Date(at).toISOString();
    };

    const tick = async (trigger: "startup" | "timer"): Promise<void> => {
      if (cancelled) return;
      const context = `backup.auto operation=${crypto.randomUUID()} trigger=${trigger}`;
      void logEvent("info", `${context} event=check hourLocal=${AUTO_BACKUP_HOUR}`);
      let area: BackupArea;
      try {
        area = await prepareBackupArea("automatic");
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        void logEvent("error", `${context} event=failure stage=schedule stopped=true last=unknown next=none reason=${reason}`);
        if (!cancelled) reportFailure(`Το αυτόματο αντίγραφο ασφαλείας δεν ολοκληρώθηκε: ${toMessage(err)}`);
        return;
      }
      if (cancelled) {
        void logEvent("info", `${context} event=cancelled stage=schedule next=none`);
        return;
      }
      onAreaReady(area);
      const last = area.lastAutoMs === null ? "none" : new Date(area.lastAutoMs).toISOString();
      const plan = planAutoBackup(Date.now(), area.lastAutoMs, AUTO_BACKUP_HOUR);
      if (!plan.dueNow) {
        const next = scheduleAt(plan.nextAt);
        void logEvent("info", `${context} event=wait last=${last} next=${next}`);
        return;
      }

      const startedAt = performance.now();
      const dueAt = new Date(plan.nextAt).toISOString();
      const plannedNext = new Date(tomorrowAt(Date.now(), AUTO_BACKUP_HOUR)).toISOString();
      void logEvent("info", `${context} event=start last=${last} due=${dueAt} next=${plannedNext}`);
      let stage: AutoBackupStage = "snapshot";
      let bytes: number;
      try {
        bytes = await runBackup(area, (current) => { stage = current; });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const next = scheduleAt(tomorrowAt(Date.now(), AUTO_BACKUP_HOUR));
        const durationMs = Math.round(performance.now() - startedAt);
        void logEvent("error", `${context} event=failure stage=${stage} durationMs=${durationMs} next=${next} reason=${reason}`);
        if (!cancelled) reportFailure(`Το αυτόματο αντίγραφο ασφαλείας δεν ολοκληρώθηκε: ${toMessage(err)}`);
        return;
      }
      const next = scheduleAt(tomorrowAt(Date.now(), AUTO_BACKUP_HOUR));
      const durationMs = Math.round(performance.now() - startedAt);
      void logEvent("info", `${context} event=success durationMs=${durationMs} bytes=${bytes} next=${next}`);
    };

    void tick("startup");

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [db, runBackup, reportFailure, onAreaReady]);
}

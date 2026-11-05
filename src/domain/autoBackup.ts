/**
 * When the daily automatic backup should run.
 *
 * The rule the accountant asked for: **at 3 PM every day, and if the program
 * happens to be closed at 3 PM, the next time it opens.** Those are not two
 * features, they are one rule read from two angles, and the file's age settles
 * it: if the newest automatic backup was written before today's 3 PM and 3 PM
 * has passed, the run was missed - whether because the program was closed or
 * because nobody opened it until now.
 *
 * The age is the mtime of the file on disk rather than a stored timestamp, so
 * the schedule and what is actually in the folder cannot drift apart. Deleting
 * the backup by hand therefore makes the next launch take one again, which is
 * the behaviour worth having.
 *
 * Everything here is pure: `now` and the age are arguments, not reads. The
 * clock is consulted once, by the caller, and the decisions are testable
 * without waiting for the time to change.
 */

/** What to do, and when the next thing should happen. */
export interface AutoBackupPlan {
  /** True when a backup is owed right now rather than later. */
  dueNow: boolean;
  /**
   * The moment the plan is reacting to: today's scheduled time when the run is
   * overdue, otherwise the next time one is wanted. Read alongside `dueNow` -
   * when it is true, this is what has been waited for.
   */
  nextAt: number;
}

/** Today's scheduled moment, at `hour` in local time, as a timestamp. */
function scheduledAt(on: Date, hour: number): number {
  const d = new Date(on);
  // `setHours` rather than an offset from midnight: the hour is wall-clock
  // time, and on the day the clocks change the day is not 24 hours long.
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/**
 * The same hour on the following day.
 *
 * Built with `setDate(+1)` and then `setHours` rather than by adding 24 hours
 * of milliseconds: a day is not always 24 hours long, and the backup is meant
 * for 3 PM on the clock the accountant reads, including across the night the
 * clocks go back.
 */
function nextDayScheduledAt(after: Date, hour: number): number {
  const d = new Date(after);
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}

/**
 * Decides between three states, and only three:
 *
 *  - **Before 3 PM today.** Nothing is owed; wait for today's moment. This
 *    covers a morning launch on a day the program has not run yet, and it is
 *    also what a second launch at 2 PM does after a first one at 10 AM.
 *
 *  - **3 PM has passed and the last backup predates it.** Run now. Either the
 *    program was closed at 3 PM, or it has not been opened since - from the
 *    schedule's point of view those are the same fact, and both are answered
 *    the same way.
 *
 *  - **3 PM has passed and the last backup is from today's 3 PM or later.**
 *    Already done; wait for tomorrow. Without this the program would take a
 *    second backup every time it is opened in the evening, and the folder's
 *    promise of exactly one file would be doing silent work to hide it.
 *
 * A missing backup - `null`, a fresh install - counts as predating anything,
 * so a first launch in the evening backs up immediately rather than sitting
 * unbacked-up until tomorrow afternoon.
 */
export function planAutoBackup(
  nowMs: number,
  lastBackupMs: number | null,
  hour: number
): AutoBackupPlan {
  const today = scheduledAt(new Date(nowMs), hour);

  if (nowMs < today) return { dueNow: false, nextAt: today };

  if (lastBackupMs === null || lastBackupMs < today) return { dueNow: true, nextAt: today };

  return { dueNow: false, nextAt: nextDayScheduledAt(new Date(nowMs), hour) };
}

/**
 * The next 3 PM after `nowMs`, always tomorrow rather than today.
 *
 * Used after an attempt has been made, whether it succeeded or failed. The
 * distinction matters on failure: `lastBackupMs` did not change, so
 * `planAutoBackup` would still call the moment overdue, and a retry would
 * follow immediately - then again, and again, against a disk that is already
 * refusing. One attempt per scheduled moment, and the next one tomorrow. A
 * restart of the program reads the real file age and tries again, which is
 * where a genuine second attempt should come from.
 */
export function tomorrowAt(nowMs: number, hour: number): number {
  return nextDayScheduledAt(new Date(nowMs), hour);
}

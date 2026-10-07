/**
 * Recurrence rules for client task assignments.
 *
 * A task is due on a given day each month, quarterly, or yearly. Deadlines are
 * computed from plain dates so the rules can be unit tested without a database.
 */

export type Periodicity = "monthly" | "quarterly" | "yearly";

export const PERIODICITY_LABELS: Record<Periodicity, string> = {
  monthly: "Μηνιαία",
  quarterly: "Τριμηνιαία",
  yearly: "Ετήσια",
};

export interface Deadline {
  year: number;
  month: number; // 1-12
  /** ISO date (YYYY-MM-DD) the work is due. */
  dueOn: string;
  /** ISO date the reminder should surface. */
  remindOn: string;
  daysUntilDue: number;
  isOverdue: boolean;
}

/** Months that a quarterly task falls due in (0-based quarter start months). */
const QUARTER_START_MONTHS = [0, 3, 6, 9];

function toIso(year: number, month: number, day: number): string {
  // Clamp the day so 31 Jan becomes 28/29 Feb rather than rolling into March.
  const lastDay = new Date(year, month, 0).getDate();
  const clamped = Math.min(Math.max(day, 1), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

function parseIso(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/** Does this task fall due in the given month? `year` is accepted for symmetry. */
export function isDueInMonth(
  periodicity: Periodicity,
  _year: number,
  month: number // 1-12
): boolean {
  switch (periodicity) {
    case "monthly":
      return true;
    case "quarterly":
      return QUARTER_START_MONTHS.some((start) => start === month - 1);
    case "yearly":
      return month === 1; // annual deadline at the start of the year
  }
}

/**
 * The most recent due date at or before `today`, plus its reminder date.
 * Returns null when the assignment had not started yet.
 */
export function currentDeadline(
  assignment: {
    startDate: string;
    periodicity: Periodicity;
    dueDay: number;
    reminderDays: number;
  },
  today: Date
): Deadline | null {
  const todayIso = startOfDay(today);
  const reminderDays = Math.max(0, assignment.reminderDays ?? 0);

  // Walk back from the current month until we find a month this task is due in.
  let { year, month } = { year: today.getFullYear(), month: today.getMonth() + 1 };

  for (let i = 0; i < 400; i++) {
    if (isDueInMonth(assignment.periodicity, year, month)) {
      const dueOn = toIso(year, month, assignment.dueDay);
      // Not yet started if the due date falls before the assignment began.
      if (dueOn < assignment.startDate) {
        month -= 1;
        if (month < 1) { month = 12; year -= 1; }
        continue;
      }

      const dueDate = startOfDay(new Date(dueOn + "T00:00:00"));
      const remindDate = addDays(dueDate, -reminderDays);
      const daysUntilDue = Math.round(
        (dueDate.getTime() - todayIso.getTime()) / 86400000
      );

      return {
        year,
        month,
        dueOn,
        remindOn: toIso(remindDate.getFullYear(), remindDate.getMonth() + 1, remindDate.getDate()),
        daysUntilDue,
        isOverdue: daysUntilDue < 0,
      };
    }
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
  }

  return null;
}

/** The next upcoming due date strictly after `today`. */
export function nextDeadline(
  assignment: {
    startDate: string;
    periodicity: Periodicity;
    dueDay: number;
    reminderDays: number;
  },
  today: Date
): Deadline | null {
  const current = currentDeadline(assignment, today);
  if (!current) return null;
  if (current.daysUntilDue >= 0) return current;

  // Already past due this cycle: advance one period.
  let { year, month } = (() => {
    const d = parseIso(current.dueOn);
    return { year: d.year, month: d.month + 1 };
  })();
  if (month > 12) { month = 1; year += 1; }

  for (let i = 0; i < 12; i++) {
    if (isDueInMonth(assignment.periodicity, year, month)) {
      const dueOn = toIso(year, month, assignment.dueDay);
      if (dueOn < assignment.startDate) {
        month += 1;
        if (month > 12) { month = 1; year += 1; }
        continue;
      }
      const dueDate = startOfDay(new Date(dueOn + "T00:00:00"));
      const remindDate = addDays(dueDate, -Math.max(0, assignment.reminderDays ?? 0));
      const daysUntilDue = Math.round(
        (dueDate.getTime() - startOfDay(today).getTime()) / 86400000
      );
      return {
        year,
        month,
        dueOn,
        remindOn: toIso(remindDate.getFullYear(), remindDate.getMonth() + 1, remindDate.getDate()),
        daysUntilDue,
        isOverdue: false,
      };
    }
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }

  return null;
}

export type ReminderState = "overdue" | "due_soon" | "upcoming" | "later";

/**
 * Classifies a deadline relative to today. `due_soon` starts at the reminder
 * date, i.e. `reminderDays` before the deadline.
 */
export function reminderState(
  deadline: Deadline,
  _today: Date,
  reminderDays: number
): ReminderState {
  if (deadline.daysUntilDue < 0) return "overdue";
  if (deadline.daysUntilDue <= Math.max(0, reminderDays)) return "due_soon";
  if (deadline.daysUntilDue <= 30) return "upcoming";
  return "later";
}

export function describeDeadline(deadline: Deadline): string {
  if (deadline.daysUntilDue < 0) {
    const n = Math.abs(deadline.daysUntilDue);
    return n === 1 ? "Λήγησε χθες" : `Λήγησε πριν ${n} ημέρες`;
  }
  if (deadline.daysUntilDue === 0) return "Λήγει σήμερα";
  if (deadline.daysUntilDue === 1) return "Λήγει αύριο";
  return `Λήγει σε ${deadline.daysUntilDue} ημέρες`;
}

/**
 * Recurrence rules for client task assignments.
 *
 * A task is due on a given day each month, quarterly, or yearly. Deadlines are
 * computed from plain dates so the rules can be unit tested without a database.
 */

export type Periodicity = "monthly" | "quarterly" | "semiannual" | "yearly";

export const PERIODICITY_LABELS: Record<Periodicity, string> = {
  monthly: "Μηνιαία",
  quarterly: "Τριμηνιαία",
  semiannual: "\u0395\u03be\u03b1\u03bc\u03b7\u03bd\u03b9\u03b1\u03af\u03b1",
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

/** Calendar months in which each schedule has a deadline. */
const DUE_MONTHS: Record<Periodicity, readonly number[]> = {
  monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  quarterly: [1, 4, 7, 10],
  semiannual: [1, 7],
  yearly: [1],
};

function toIso(year: number, month: number, day: number): string {
  // Clamp the day so 31 Jan becomes 28/29 Feb rather than rolling into March.
  const lastDay = new Date(year, month, 0).getDate();
  const clamped = Math.min(Math.max(day, 1), lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function dateIso(d: Date): string {
  return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** Does this task fall due in the given month? `year` is accepted for symmetry. */
export function isDueInMonth(
  periodicity: Periodicity,
  _year: number,
  month: number // 1-12
): boolean {
  return DUE_MONTHS[periodicity].includes(month);
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

      return buildDeadline(year, month, dueOn, reminderDays, todayIso);
    }
    ({ year, month } = previousMonth(year, month));
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
  const todayDate = startOfDay(today);
  const todayIso = dateIso(todayDate);
  const reminderDays = Math.max(0, assignment.reminderDays ?? 0);
  let year = today.getFullYear();
  let month = today.getMonth() + 1;

  // Search forward directly. This also works when the assignment started after
  // the last quarterly, semiannual, or yearly deadline.
  for (let i = 0; i < 400; i++) {
    if (isDueInMonth(assignment.periodicity, year, month)) {
      const dueOn = toIso(year, month, assignment.dueDay);
      if (dueOn >= assignment.startDate && dueOn > todayIso) {
        return buildDeadline(year, month, dueOn, reminderDays, todayDate);
      }
    }
    ({ year, month } = nextMonth(year, month));
  }

  return null;
}

/** The deadline to show in an assignment card, including the first future one. */
export function displayDeadline(
  assignment: {
    startDate: string;
    periodicity: Periodicity;
    dueDay: number;
    reminderDays: number;
  },
  today: Date
): Deadline | null {
  return currentDeadline(assignment, today) ?? nextDeadline(assignment, today);
}

function buildDeadline(
  year: number,
  month: number,
  dueOn: string,
  reminderDays: number,
  today: Date
): Deadline {
  const dueDate = startOfDay(new Date(dueOn + "T00:00:00"));
  const remindDate = addDays(dueDate, -reminderDays);
  const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / 86400000);
  return {
    year,
    month,
    dueOn,
    remindOn: toIso(remindDate.getFullYear(), remindDate.getMonth() + 1, remindDate.getDate()),
    daysUntilDue,
    isOverdue: daysUntilDue < 0,
  };
}

function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
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
    return n === 1 ? "Έληξε χθες" : `Έληξε πριν ${n} ημέρες`;
  }
  if (deadline.daysUntilDue === 0) return "Λήγει σήμερα";
  if (deadline.daysUntilDue === 1) return "Λήγει αύριο";
  return `Λήγει σε ${deadline.daysUntilDue} ημέρες`;
}

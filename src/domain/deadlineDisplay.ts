import { describeDeadline, type Deadline } from "./recurrence";

/**
 * Describes a future deadline using calendar months and leftover days.
 * For example: "Λήγει σε 2 μήνες και 25 μέρες".
 */
export function describeDeadlineWithDistance(deadline: Deadline, today: Date): string {
  if (deadline.daysUntilDue < 0) return describeDeadline(deadline);

  const from = startOfDay(today);
  const to = startOfDay(new Date(`${deadline.dueOn  }T00:00:00`));
  let months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
  let anchor = addCalendarMonths(from, months);
  if (anchor > to) {
    months -= 1;
    anchor = addCalendarMonths(from, months);
  }
  const days = Math.round((to.getTime() - anchor.getTime()) / 86400000);

  if (months === 0) return describeDeadline(deadline);

  const monthWord = months === 1 ? "\u03bc\u03ae\u03bd\u03b1" : "\u03bc\u03ae\u03bd\u03b5\u03c2";
  const dayWord = days === 1 ? "\u03bc\u03ad\u03c1\u03b1" : "\u03bc\u03ad\u03c1\u03b5\u03c2";
  if (days === 0) return `\u039b\u03ae\u03b3\u03b5\u03b9 \u03c3\u03b5 ${months} ${monthWord}`;
  return `\u039b\u03ae\u03b3\u03b5\u03b9 \u03c3\u03b5 ${months} ${monthWord} \u03ba\u03b1\u03b9 ${days} ${dayWord}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addCalendarMonths(from: Date, months: number): Date {
  const targetMonth = from.getMonth() + months;
  const lastDay = new Date(from.getFullYear(), targetMonth + 1, 0).getDate();
  return new Date(from.getFullYear(), targetMonth, Math.min(from.getDate(), lastDay));
}

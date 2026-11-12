import type { ClientTaskAssignment } from "./types";
import {
  currentDeadline,
  describeDeadline,
  nextDeadline,
  reminderState,
  type Deadline,
  type ReminderState,
} from "./recurrence";

/** The assignment fields needed to build a reminder for a person. */
export interface ReminderAssignment extends ClientTaskAssignment {
  clientName: string;
  taskName: string;
}

export interface ReminderCandidate<T extends ReminderAssignment = ReminderAssignment> {
  assignment: T;
  deadline: Deadline;
  state: ReminderState;
  label: string;
  /** Stable for one assignment and one recurring deadline. */
  key: string;
  /** The text used by the Windows notification. */
  body: string;
}

/**
 * Derives the reminders shown in the panel and sent to Windows.
 *
 * Keeping this decision in one place prevents the two surfaces from drifting:
 * inactive assignments, completed work, and the monthly/quarterly/semiannual/yearly
 * deadline rules are all handled identically.
 */
export function getReminderCandidates<T extends ReminderAssignment>(
  assignments: readonly T[],
  completedKeys: ReadonlySet<string>,
  today: Date
): ReminderCandidate<T>[] {
  return assignments.flatMap((assignment) => {
    if (!assignment.isActive) return [];

    const current = currentDeadline(assignment, today);
    const currentMonth = current ? deadlineMonth(current.dueOn) : 0;
    const currentCompleted = current
      ? completedKeys.has(completedKey(assignment, current.year, currentMonth))
      : false;
    const deadline = !current || currentCompleted
      ? nextDeadline(assignment, today)
      : current;
    if (!deadline) return [];

    const state = reminderState(deadline, today, assignment.reminderDays);
    if (state !== "overdue" && state !== "due_soon") return [];

    const month = deadlineMonth(deadline.dueOn);
    if (completedKeys.has(completedKey(assignment, deadline.year, month))) {
      return [];
    }

    const label = describeDeadline(deadline);
    return [{
      assignment,
      deadline,
      state,
      label,
      key: `${assignment.id}:${deadline.dueOn}`,
      body: `${assignment.clientName} — ${assignment.taskName} (${label})`,
    }];
  });
}

function deadlineMonth(dueOn: string): number {
  const match = /^(\d{4})-(\d{2})/.exec(dueOn);
  return match ? Number(match[2]) : 0;
}

function completedKey(assignment: ReminderAssignment, year: number, month: number): string {
  return `${assignment.clientId}:${assignment.taskTypeId}:${year}:${month}`;
}

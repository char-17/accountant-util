import { useMemo } from "react";
import type { ClientTaskWithTask } from "../persistence/assignmentRepo";
import {
  PERIODICITY_LABELS,
  currentDeadline,
  describeDeadline,
  reminderState,
} from "../domain/recurrence";

interface RemindersProps {
  assignments: ClientTaskWithTask[];
  /** Desktop (Windows) notification state. */
  desktopEnabled: boolean;
  onDesktopEnabledChange: (enabled: boolean) => void;
  desktopPermission: "granted" | "denied" | "default";
  onRequestDesktopPermission: () => void;
}

interface ReminderItem {
  assignment: ClientTaskWithTask;
  state: ReturnType<typeof reminderState>;
  label: string;
  dueOn: string;
  daysUntilDue: number;
}

/**
 * Tasks that need attention now: overdue, due soon, or due this month.
 * Sorted by urgency so the most pressing item is first.
 */
export function Reminders({
  assignments,
  desktopEnabled,
  onDesktopEnabledChange,
  desktopPermission,
  onRequestDesktopPermission,
}: RemindersProps) {
  const now = useMemo(() => new Date(), []);

  const items = useMemo<ReminderItem[]>(() => {
    return assignments
      .filter((a) => a.isActive)
      .map((a) => {
        const deadline = currentDeadline(a, now);
        if (!deadline) return null;
        return {
          assignment: a,
          state: reminderState(deadline, now, a.reminderDays),
          label: describeDeadline(deadline),
          dueOn: deadline.dueOn,
          daysUntilDue: deadline.daysUntilDue,
        } satisfies ReminderItem;
      })
      .filter((x): x is ReminderItem => x !== null)
      .filter((x) => x.state === "overdue" || x.state === "due_soon")
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }, [assignments, now]);

  const overdueCount = items.filter((i) => i.state === "overdue").length;

  const desktopControls = (
    <div className="reminder-desktop-controls">
      <label className="reminder-toggle">
        <input
          type="checkbox"
          checked={desktopEnabled}
          onChange={(e) => onDesktopEnabledChange(e.target.checked)}
        />
        <span>Ειδοποιήσεις Windows</span>
      </label>
      {desktopPermission === "default" && (
        <button className="btn-small" onClick={onRequestDesktopPermission}>
          Επίτρεψη ειδοποιήσεων
        </button>
      )}
      {desktopPermission === "denied" && (
        <span className="reminder-permission-note">
          Οι ειδοποιήσεις Windows είναι απενεργοποιημένες στις ρυθμίσεις του συστήματος.
        </span>
      )}
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="reminders">
        <h3>Ειδοποιήσεις</h3>
        <p className="empty-message">Δεν υπάρχουν εκκρεμείς ειδοποιήσεις</p>
        {desktopControls}
      </div>
    );
  }

  return (
    <div className="reminders">
      <h3>
        Ειδοποιήσεις
        {overdueCount > 0 && (
          <span className="reminder-count overdue" aria-label={`${overdueCount} ληγμένες`}>
            {overdueCount}
          </span>
        )}
      </h3>
      {desktopControls}
      <ul className="reminder-list">
        {items.map((item) => (
          <li key={item.assignment.id} className={`reminder-item ${item.state}`}>
            <span
              className="task-color-dot"
              style={{ backgroundColor: item.assignment.taskColor }}
              aria-hidden="true"
            />
            <div className="reminder-body">
              <span className="reminder-client">{item.assignment.clientName}</span>
              <span className="reminder-task">{item.assignment.taskName}</span>
            </div>
            <div className="reminder-meta">
              <span className={`reminder-when ${item.state}`}>{item.label}</span>
              <span className="reminder-period">
                {PERIODICITY_LABELS[item.assignment.periodicity]} · {item.dueOn}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { displayDate } from "../domain/dates";
import { useId, useMemo, useState } from "react";
import type { ClientTaskWithTask } from "../persistence/assignmentRepo";
import { PERIODICITY_LABELS } from "../domain/recurrence";
import { getReminderCandidates, type ReminderCandidate } from "../domain/notifications";

interface RemindersProps {
  /** Fold the entire panel in the compact worklist layout. */
  collapsible?: boolean;
  assignments: ClientTaskWithTask[];
  /**
   * Status rows of the months a reminder can point at. A task the accountant has
   * already completed drops out of the list, because a reminder for finished work
   * is noise, not information.
   */
  completedKeys: Set<string>;
  /** Called with the client whose work should be highlighted in the worklist. */
  onFocusClient: (clientId: number, year: number, month: number) => void;
}

interface ReminderItem {
  assignment: ClientTaskWithTask;
  state: ReminderCandidate["state"];
  label: string;
  dueOn: string;
  year: number;
  month: number;
  daysUntilDue: number;
}

/**
 * Tasks that need attention now: overdue, due soon, or due this month.
 * Sorted by urgency so the most pressing item is first.
 */
export function Reminders({
  collapsible = false,
  assignments,
  completedKeys,
  onFocusClient,
}: RemindersProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const now = useMemo(() => new Date(), []);

  const items = useMemo<ReminderItem[]>(() => {
    return getReminderCandidates(assignments, completedKeys, now)
      .map(({ assignment, state, label, deadline }) => ({
        assignment,
        state,
        label,
        dueOn: deadline.dueOn,
        year: deadline.year,
        month: deadline.month,
        daysUntilDue: deadline.daysUntilDue,
      }))
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }, [assignments, now, completedKeys]);

  const heading = (
    <>
      <span className={collapsible ? "section-heading" : undefined}>Ειδοποιήσεις</span>
      {items.length > 0 && (
        <span className="reminder-count">{items.length}</span>
      )}
    </>
  );

  return (
    <section className="reminders">
      <h3 className={collapsible ? "overview-panel-heading" : undefined}>
        {collapsible ? (
          <button
            type="button"
            className="overview-panel-toggle reminders-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={contentId}
          >
            {heading}
            <span aria-hidden="true" className="report-caret">{expanded ? "▾" : "▸"}</span>
          </button>
        ) : heading}
      </h3>
      <div id={contentId} hidden={collapsible && !expanded}>
        {items.length === 0 ? (
          <p className="empty-message">Δεν υπάρχουν εκκρεμείς ειδοποιήσεις</p>
        ) : (
          <ul className="reminder-list">
          {items.map((item) => (
          // A button rather than a div: the reminder is clickable, so it has to
          // be reachable by keyboard and announced as activatable.
          <li key={item.assignment.id} className={`reminder-item ${item.state}`}>
            <button
              className="reminder-link"
              onClick={() => onFocusClient(item.assignment.clientId, item.year, item.month)}
              title={`Εργασίες μήνα για ${item.assignment.clientName}`}
            >
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
                  {PERIODICITY_LABELS[item.assignment.periodicity]} · {displayDate(item.dueOn)}
                </span>
              </div>
            </button>
          </li>
          ))}
          </ul>
        )}
      </div>
    </section>
  );
}

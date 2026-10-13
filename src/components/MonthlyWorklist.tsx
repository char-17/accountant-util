import { useState } from "react";
import type { MonthlyStatusWithDetails } from "../domain/types";
import type { WorklistFilters } from "../domain/worklist";
import { WorklistFiltersBar } from "./WorklistFiltersBar";
import { TaskPaymentRow } from "./TaskPaymentRow";

interface MonthlyWorklistProps {
  /** Already filtered; the component does not re-apply the filters. */
  statuses: MonthlyStatusWithDetails[];
  /** Unfiltered count, so the empty state can tell "nothing due" from "nothing matched". */
  totalCount: number;
  filters: WorklistFilters;
  isFiltered: boolean;
  onFilterStatusChange: (value: WorklistFilters["status"]) => void;
  /** Per-client picker. */
  onFilterClientSelect: (id: number | null) => void;
  /** Per-task picker. */
  onFilterTaskSelect: (id: number | null) => void;
  /** Per-profession picker. */
  onFilterProfessionSelect?: (id: number | null) => void;
  clientOptions: Array<{ id: number; name: string }>;
  taskOptions: Array<{ id: number; name: string }>;
  professionOptions?: Array<{ id: number; name: string }>;
  onFilterReset: () => void;
  year: number;
  month: number;
  onToggle: (clientId: number, taskTypeId: number, completed: boolean) => Promise<void>;
  /** Single click: narrows the list to this client. */
  onSelectClient: (clientId: number) => void;
  /** Double click: opens the full client tab. */
  onOpenClient: (clientId: number) => void;
  /** Client to pulse, so an incoming reminder can point at the right card. */
  highlightClientId?: number | null;
  onSetAmount: (clientId: number, taskTypeId: number, amount: number | null) => Promise<void>;
  onSetPaid: (
    clientId: number,
    taskTypeId: number,
    isPaid: boolean,
    paidAt: string | null
  ) => Promise<void>;
  onSetInvoiced: (
    clientId: number,
    taskTypeId: number,
    isInvoiced: boolean,
    invoicedAt: string | null
  ) => Promise<void>;
}

/** The change awaiting the user's confirmation. */
interface PendingChange {
  clientId: number;
  taskTypeId: number;
  clientName: string;
  taskName: string;
  taskColor: string;
  completed: boolean;
  wasCompleted: boolean;
}

/**
 * Lists every task due this month with a checkbox, so the accountant can
 * actually complete work. Toggling asks for confirmation first, in both
 * directions, because it changes the monthly counters.
 */
export function MonthlyWorklist({
  statuses,
  totalCount,
  filters,
  isFiltered,
  onFilterStatusChange,
  onFilterClientSelect,
  onFilterTaskSelect,
  onFilterProfessionSelect,
  clientOptions,
  taskOptions,
  professionOptions = [],
  onFilterReset,
  year,
  month,
  onToggle,
  onSelectClient,
  onOpenClient,
  highlightClientId,
  onSetAmount,
  onSetPaid,
  onSetInvoiced,
}: MonthlyWorklistProps) {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [saving, setSaving] = useState(false);

  function requestToggle(item: MonthlyStatusWithDetails) {
    setPending({
      clientId: item.clientId,
      taskTypeId: item.taskTypeId,
      clientName: item.clientName,
      taskName: item.taskName,
      taskColor: item.taskColor,
      completed: item.status !== "completed",
      wasCompleted: item.status === "completed",
    });
  }

  async function confirmToggle() {
    if (!pending) return;
    setSaving(true);
    try {
      await onToggle(pending.clientId, pending.taskTypeId, pending.completed);
      setPending(null);
    } finally {
      setSaving(false);
    }
  }

  const filterBar = (
    <WorklistFiltersBar
      filters={filters}
      onStatusChange={onFilterStatusChange}
      onClientSelect={onFilterClientSelect}
      onTaskSelect={onFilterTaskSelect}
      onProfessionSelect={onFilterProfessionSelect ?? (() => {})}
      clientOptions={clientOptions}
      taskOptions={taskOptions}
      professionOptions={professionOptions}
      onReset={onFilterReset}
      isFiltered={isFiltered}
      shownCount={statuses.length}
      totalCount={totalCount}
    />
  );

  if (statuses.length === 0) {
    // Distinguish "the month is genuinely empty" from "the filters excluded
    // everything", which is a different situation for the user.
    return (
      <div className="worklist">
        <h3 className="section-heading">
          Εργασίες μήνα <span className="worklist-period">{month}/{year}</span>
        </h3>
        {isFiltered ? (
          <>
            {filterBar}
            <p className="empty-message">
              Καμία εργασία δεν ταιριάζει με τα φίλτρα.{" "}
              <button className="link-button" onClick={onFilterReset}>
                Καθαρισμός φίλτρων
              </button>
            </p>
          </>
        ) : (
          <p className="empty-message">
            Δεν υπάρχουν εργασίες για αυτόν τον μήνα. Ανοίξτε έναν πελάτη και
            αναθέστε του εργασία.
          </p>
        )}
      </div>
    );
  }

  // Group by client so the list reads like a real monthly checklist.
  const byClient = new Map<number, { name: string; items: MonthlyStatusWithDetails[] }>();
  for (const s of statuses) {
    if (!byClient.has(s.clientId)) {
      byClient.set(s.clientId, { name: s.clientName, items: [] });
    }
    byClient.get(s.clientId)!.items.push(s);
  }

  return (
    <div className="worklist">
      <h3 className="section-heading">
        Εργασίες μήνα <span className="worklist-period">{month}/{year}</span>
      </h3>

      {filterBar}

      <div className="worklist-clients">
        {[...byClient.entries()].map(([clientId, group], index) => {
          const done = group.items.filter((i) => i.status === "completed").length;
          const allDone = done === group.items.length;
          const highlighted = highlightClientId === clientId;

          return (
            <div
              key={clientId}
              className={`worklist-client ${index % 2 === 0 ? "alt" : ""} ${
                highlighted ? "highlight" : ""
              }`}
            >
              {/* The name is a button, so it is reachable by keyboard and on
                  touch. A double click also opens the tab, for the mouse. */}
              <button
                className="worklist-client-name"
                onClick={() => onSelectClient(clientId)}
                onDoubleClick={() => onOpenClient(clientId)}
                title="Επιλογή πελάτη · διπλό κλικ ανοίγει την καρτέλα"
              >
                {group.name}
                <span className={`worklist-count ${allDone ? "done" : ""}`}>
                  {done}/{group.items.length}
                </span>
              </button>

              <ul className="worklist-items">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className={`worklist-item ${item.status === "completed" ? "done" : ""}`}
                  >
                    <label className="worklist-item-main">
                      <input
                        type="checkbox"
                        checked={item.status === "completed"}
                        // Ask first; the parent only sees a confirmed change.
                        onChange={() => requestToggle(item)}
                      />
                      <span
                        className="task-color-dot"
                        style={{ backgroundColor: item.taskColor }}
                        aria-hidden="true"
                      />
                      <span className="worklist-task-name">{item.taskName}</span>
                    </label>
                    {item.completedAt && (
                      <span className="worklist-completed-at">
                        {new Date(item.completedAt).toLocaleDateString("el-GR")}
                      </span>
                    )}

                    <TaskPaymentRow
                      item={item}
                      onSetAmount={onSetAmount}
                      onSetPaid={onSetPaid}
                      onSetInvoiced={onSetInvoiced}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {pending && (
        <div
          className="modal-backdrop"
          onClick={() => !saving && setPending(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="worklist-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="worklist-confirm-title">
              {pending.completed ? "Επιβεβαίωση ολοκλήρωσης" : "Επιβεβαίωση αλλαγής"}
            </h3>

            <div className="confirm-task">
              <span
                className="task-color-dot"
                style={{ backgroundColor: pending.taskColor }}
                aria-hidden="true"
              />
              <div>
                <span className="confirm-client">{pending.clientName}</span>
                <span className="confirm-task-name">{pending.taskName}</span>
              </div>
            </div>

            <p>
              {pending.completed ? (
                <>
                  Θα σημειωθεί ως <strong>ολοκληρωμένη</strong> για τον μήνα{" "}
                  {month}/{year};
                </>
              ) : (
                <>
                  Θα επανέλθει σε <strong>εκκρεμή</strong>. Η ημερομηνία ολοκλήρωσης
                  θα αφαιρεθεί για τον μήνα {month}/{year};
                </>
              )}
            </p>

            <div className="form-actions">
              <button
                className={pending.completed ? "btn-primary" : "btn-warning"}
                onClick={confirmToggle}
                disabled={saving}
              >
                {saving
                  ? "Αποθήκευση..."
                  : pending.completed
                    ? "Ναι, ολοκληρώθηκε"
                    : "Ναι, επανήλθε"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setPending(null)}
                disabled={saving}
              >
                Άκυρο
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
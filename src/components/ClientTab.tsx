import { useState, useEffect, useCallback, useRef } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { Client, TaskType, Profession } from "../domain/types";
import * as assignmentRepo from "../persistence/assignmentRepo";
import type { ClientTaskWithTask } from "../persistence/assignmentRepo";
import type { ClientInput } from "../hooks/useClients";
import type { Periodicity } from "../domain/types";
import {
  PERIODICITY_LABELS,
  currentDeadline,
  describeDeadline,
  reminderState,
} from "../domain/recurrence";
import { ClientForm } from "./ClientForm";
import { toMessage } from "../utils/errors";

interface ClientTabProps {
  db: Database;
  client: Client;
  tasks: TaskType[];
  /** Offered by the profession picker, so a client can be classified here. */
  professions: Profession[];
  onClose: () => void;
  onUpdate: () => void;
  onDelete: (id: number) => Promise<void>;
  /** Saves one client; the dashboard owns the list and refreshes it. */
  onSaveClient: (id: number, data: ClientInput) => Promise<void>;
}

export function ClientTab({ db, client, tasks, professions, onClose, onUpdate, onDelete, onSaveClient }: ClientTabProps) {
  const [assignments, setAssignments] = useState<ClientTaskWithTask[]>([]);
  const [newTaskTypeId, setNewTaskTypeId] = useState<number | "">("");
  const [newPeriodicity, setNewPeriodicity] = useState<Periodicity>("monthly");
  const [newDueDay, setNewDueDay] = useState("28");
  const [newReminderDays, setNewReminderDays] = useState("5");
  const [assignmentError, setAssignmentError] = useState("");
  // Which assignment is pending deletion, and whether the write is in flight.
  // Deleting an assignment is the one action here that removes a row outright,
  // so it asks first - and it says what survives, not just what does not.
  const [assignmentPendingDelete, setAssignmentPendingDelete] = useState<ClientTaskWithTask | null>(null);
  const [deletingAssignment, setDeletingAssignment] = useState(false);
  // Guidance shown when the add button is used before a task is chosen. Kept
  // apart from assignmentError because it is not a failure.
  const [addHint, setAddHint] = useState("");
  // The task picker, so a refused add can put the cursor where the fix is.
  const taskPickerRef = useRef<HTMLSelectElement>(null);
  // Where ClientForm's action row is portalled to. Null until this component's
  // own footer box has mounted, which is why the row appears on the second
  // render rather than the first.
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);

  // Stable, so the effect below can depend on it honestly instead of silencing
  // the hooks rule.
  const loadAssignments = useCallback(async () => {
    const result = await assignmentRepo.getAssignmentsByClient(db, client.id);
    setAssignments(result);
  }, [db, client.id]);

  // Reset the form whenever a different client is shown.
  useEffect(() => {
    setNewTaskTypeId("");
    setNewPeriodicity("monthly");
    setNewDueDay("28");
    setNewReminderDays("5");
    setAssignmentError("");
    void loadAssignments();
  }, [client.id, loadAssignments]);

  async function handleSave(data: ClientInput) {
    await onSaveClient(client.id, data);
    onUpdate();
  }

  async function handleAddAssignment() {
    if (!newTaskTypeId) {
      // The button stays clickable so it can say why, rather than being dead.
      setAddHint("Επιλέξτε πρώτα μια εργασία από την πρώτη επιλογή.");
      taskPickerRef.current?.focus();
      return;
    }
    setAddHint("");
    setAssignmentError("");
    try {
      const today = new Date().toISOString().slice(0, 10);
      await assignmentRepo.createAssignment(db, client.id, Number(newTaskTypeId), today, {
        periodicity: newPeriodicity,
        dueDay: Number(newDueDay),
        reminderDays: Number(newReminderDays),
      });
      setNewTaskTypeId("");
      await loadAssignments();
      // Tell the app: the new assignment changes the monthly worklist and
      // the reminders, which are rendered outside this panel.
      onUpdate();
    } catch (err) {
      setAssignmentError(toMessage(err));
    }
  }

  async function handleToggleAssignment(assignmentId: number, isActive: boolean) {
    setAssignmentError("");
    try {
      if (isActive) {
        await assignmentRepo.deactivateAssignment(db, assignmentId);
      } else {
        await assignmentRepo.activateAssignment(db, assignmentId);
      }
      await loadAssignments();
      onUpdate();
    } catch (err) {
      setAssignmentError(toMessage(err));
    }
  }

  async function handleDeleteAssignment() {
    if (!assignmentPendingDelete) return;
    const target = assignmentPendingDelete;
    setAssignmentError("");
    setDeletingAssignment(true);
    try {
      await assignmentRepo.deleteAssignment(db, target.id);
      setAssignmentPendingDelete(null);
      await loadAssignments();
      // The reminders rendered in the far-right panel belonged to this
      // assignment, so they go too and the parent has to redraw them.
      onUpdate();
    } catch (err) {
      setAssignmentError(toMessage(err));
      setAssignmentPendingDelete(null);
    } finally {
      setDeletingAssignment(false);
    }
  }

  const availableTasks = tasks.filter(
    (t) => t.isActive && !assignments.some((a) => a.taskTypeId === t.id)
  );

  return (
    <div className="client-tab">
      <div className="client-tab-header">
        <h2>{client.name}</h2>
        <button className="close-btn" onClick={onClose} aria-label="Κλείσιμο">
          ✕
        </button>
      </div>

      {/* The action row lives at the foot of this panel, below the assignments,
          rather than in the middle of the form. It is held in state by the form
          and portalled here, so this only has to own the empty box it lands in -
          a callback ref, because the portal target has to exist before the form
          first renders, and a plain ref would still be null at that point. */}
      <ClientForm
        key={client.id}
        actionsTarget={actionsTarget}
        submitLabel="Αποθήκευση αλλαγών"
        resetOnSuccess={false}
        initialData={{
          name: client.name,
          professionId: client.professionId ?? null,
          taxId: client.taxId || "",
          notes: client.notes || "",
        }}
        professions={professions}
        onSubmit={handleSave}
        onCancel={onClose}
        onDelete={async () => {
          await onDelete(client.id);
          onClose();
        }}
      />

      <div className="client-assignments">
        <h3>Εργασίες πελάτη</h3>

        {/* Two rows of labelled fields with a full-width action, rather than
            five controls in a line. As one flex row the two selects could not
            shrink below their longest option, so the row overflowed the panel
            and the button wrapped onto a line of its own. */}
        <div className="add-assignment">
          <div className="assignment-field">
            <label htmlFor="na-task">Εργασία</label>
            <select
              id="na-task"
              ref={taskPickerRef}
              value={newTaskTypeId}
              onChange={(e) => {
                setNewTaskTypeId(e.target.value ? Number(e.target.value) : "");
                // The hint has done its job the moment the problem is solved.
                setAddHint("");
              }}
            >
              <option value="">Επιλέξτε εργασία...</option>
              {availableTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </select>
          </div>

          <div className="assignment-field">
            <label htmlFor="na-period">Περιοδικότητα</label>
            <select
              id="na-period"
              value={newPeriodicity}
              onChange={(e) => setNewPeriodicity(e.target.value as Periodicity)}
            >
              {(Object.keys(PERIODICITY_LABELS) as Periodicity[]).map((p) => (
                <option key={p} value={p}>{PERIODICITY_LABELS[p]}</option>
              ))}
            </select>
          </div>

          <div className="assignment-field">
            <label htmlFor="na-due">Ημέρα λήξης</label>
            <input
              id="na-due"
              type="number"
              min={1}
              max={31}
              value={newDueDay}
              onChange={(e) => setNewDueDay(e.target.value)}
              title="Ημέρα του μήνα που λήγει η εργασία"
            />
          </div>

          <div className="assignment-field">
            <label htmlFor="na-remind">Ειδοποίηση πριν (μέρες)</label>
            <input
              id="na-remind"
              type="number"
              min={0}
              max={90}
              value={newReminderDays}
              onChange={(e) => setNewReminderDays(e.target.value)}
              title="Πόσες μέρες πριν τη λήξη να εμφανιστεί ειδοποίηση"
            />
          </div>

          {/* aria-disabled rather than disabled. A disabled button takes no
              focus, so anyone using the keyboard or a screen reader could
              reach the row, find the button dead, and never learn why. This one
              stays focusable and explains itself: the tooltip on hover, and a
              click that says what is missing and puts the cursor on the field. */}
          <button
            className="btn-primary assignment-add-btn"
            onClick={handleAddAssignment}
            aria-disabled={!newTaskTypeId}
            title={
              newTaskTypeId
                ? "Προσθέτει την εργασία στον πελάτη"
                : "Επιλέξτε πρώτα μια εργασία από την πρώτη επιλογή"
            }
          >
            Προσθήκη εργασίας
          </button>
        </div>

        {addHint && (
          <p className="assignment-hint-banner" role="status">
            <span aria-hidden="true">ⓘ</span>
            {addHint}
          </p>
        )}

        {assignmentError && (
          <div className="error-banner" role="alert">{assignmentError}</div>
        )}

        <div className="assignment-list">
          {assignments.length === 0 ? (
            <p className="empty-message">Δεν έχουν ανατεθεί εργασίες</p>
          ) : (
            assignments.map((assignment) => {
              const deadline = assignment.isActive
                ? currentDeadline(assignment, new Date())
                : null;
              return (
                <div
                  key={assignment.id}
                  className={`assignment-item ${!assignment.isActive ? "inactive" : ""}`}
                >
                  <div className="assignment-info">
                    <span
                      className="task-color-dot"
                      style={{ backgroundColor: assignment.taskColor }}
                    />
                    <div>
                      <span className="task-name">{assignment.taskName}</span>
                      <span className="assignment-meta">
                        {PERIODICITY_LABELS[assignment.periodicity]} · λήξη {assignment.dueDay} ·
                        {" "}ειδοποίηση {assignment.reminderDays}μ
                      </span>
                    </div>
                  </div>
                  <div className="assignment-actions">
                    {deadline && (
                      <span
                        className={`deadline-badge ${reminderState(
                          deadline,
                          new Date(),
                          assignment.reminderDays
                        )}`}
                        title={`Λήξη: ${deadline.dueOn}`}
                      >
                        {describeDeadline(deadline)}
                      </span>
                    )}
                    <button
                      className={`btn-toggle ${assignment.isActive ? "active" : ""}`}
                      onClick={() => handleToggleAssignment(assignment.id, assignment.isActive)}
                    >
                      {assignment.isActive ? "Ενεργή" : "Ανενεργή"}
                    </button>
                    <button
                      className="icon-btn delete-btn"
                      onClick={() => setAssignmentPendingDelete(assignment)}
                      disabled={deletingAssignment}
                      title={`Αφαίρεση της εργασίας «${assignment.taskName}» από τον πελάτη`}
                      aria-label={`Αφαίρεση της εργασίας ${assignment.taskName}`}
                    >
                      {/* Drawn rather than the 🗑 character: an emoji renders in
                          its own colours and ignores the hover, and it depends
                          on an emoji font being present at all. An SVG takes
                          currentColor, so it follows the button's states. */}
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Confirmation for removing an assignment outright. Deactivating is the
          reversible option and it sits next to this one; this deletes the row,
          so the dialog spells out that the history stays and only the
          recurring job and its reminders go. */}
      {assignmentPendingDelete && (
        <div className="modal-backdrop" onClick={() => !deletingAssignment && setAssignmentPendingDelete(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Αφαίρεση εργασίας"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Αφαίρεση εργασίας</h3>
            <p>
              Θα αφαιρεθεί η εργασία <strong>{assignmentPendingDelete.taskName}</strong> από τον{" "}
              {assignmentPendingDelete.clientName}.
            </p>
            <div className="modal-warning">
              Η εργασία δεν θα εμφανιστεί ξανά στους μήνες που έρχονται και οι
              ειδοποιήσεις της θα διαγραφούν. Οι ολοκληρωμένες εργασίες, τα ποσά
              και οι εισπράξεις των προηγούμενων μηνών{" "}
              <strong>δεν χάνονται</strong> και μένουν στην αναφορά.
            </div>
            <div className="form-actions">
              <button
                className="btn-danger"
                onClick={handleDeleteAssignment}
                disabled={deletingAssignment}
              >
                {deletingAssignment ? "Διαγραφή..." : "Ναι, αφαίρεση"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setAssignmentPendingDelete(null)}
                disabled={deletingAssignment}
              >
                Άκυρο
              </button>
              <button
                className="btn-secondary btn-push-right"
                onClick={() => {
                  // Deactivating is the reversible answer, so it is offered
                  // here rather than making the user undo this afterwards.
                  void handleToggleAssignment(assignmentPendingDelete.id, true);
                  setAssignmentPendingDelete(null);
                }}
                disabled={deletingAssignment}
                title="Κράτηση της εργασίας, απλώς χωρίς να παράγεται πλέον"
              >
                Απενεργοποίηση αντί
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The buttons land here, at the foot of the panel. */}
      <div className="client-tab-footer" ref={setActionsTarget} />
    </div>
  );
}

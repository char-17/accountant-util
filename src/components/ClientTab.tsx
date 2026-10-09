import { useState, useEffect, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { Client, TaskType } from "../domain/types";
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
  onClose: () => void;
  onUpdate: () => void;
  onDelete: (id: number) => Promise<void>;
  /** Saves one client; the dashboard owns the list and refreshes it. */
  onSaveClient: (id: number, data: ClientInput) => Promise<void>;
}

export function ClientTab({ db, client, tasks, onClose, onUpdate, onDelete, onSaveClient }: ClientTabProps) {
  const [assignments, setAssignments] = useState<ClientTaskWithTask[]>([]);
  const [newTaskTypeId, setNewTaskTypeId] = useState<number | "">("");
  const [newPeriodicity, setNewPeriodicity] = useState<Periodicity>("monthly");
  const [newDueDay, setNewDueDay] = useState("28");
  const [newReminderDays, setNewReminderDays] = useState("5");
  const [assignmentError, setAssignmentError] = useState("");
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
    if (!newTaskTypeId) return;
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
          taxId: client.taxId || "",
          notes: client.notes || "",
        }}
        onSubmit={handleSave}
        onCancel={onClose}
        onDelete={async () => {
          await onDelete(client.id);
          onClose();
        }}
      />

      <div className="client-assignments">
        <h3>Εργασίες πελάτη</h3>

        <div className="add-assignment">
          <select
            value={newTaskTypeId}
            onChange={(e) => setNewTaskTypeId(e.target.value ? Number(e.target.value) : "")}
            aria-label="Επιλογή εργασίας για ανάθεση"
          >
            <option value="">Επιλέξτε εργασία...</option>
            {availableTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </select>
          <select
            value={newPeriodicity}
            onChange={(e) => setNewPeriodicity(e.target.value as Periodicity)}
            aria-label="Περιοδικότητα"
            className="compact-select"
          >
            {(Object.keys(PERIODICITY_LABELS) as Periodicity[]).map((p) => (
              <option key={p} value={p}>{PERIODICITY_LABELS[p]}</option>
            ))}
          </select>
          <input
            type="number"
            className="compact-input"
            min={1}
            max={31}
            value={newDueDay}
            onChange={(e) => setNewDueDay(e.target.value)}
            aria-label="Ημέρα λήξης"
            title="Ημέρα του μήνα που λήγει η εργασία"
          />
          <input
            type="number"
            className="compact-input"
            min={0}
            max={90}
            value={newReminderDays}
            onChange={(e) => setNewReminderDays(e.target.value)}
            aria-label="Ειδοποίηση πριν"
            title="Πόσες μέρες πριν τη λήξη να εμφανιστεί ειδοποίηση"
          />
          <button
            className="btn-small"
            onClick={handleAddAssignment}
            disabled={!newTaskTypeId}
          >
            Προσθήκη
          </button>
        </div>
        <p className="assignment-hint">
          Ημέρα λήξης: <strong>{newDueDay || "-"}</strong> · Ειδοποίηση:{" "}
          <strong>{newReminderDays === "" ? "-" : newReminderDays}</strong> μέρες πριν
        </p>

        {assignmentError && <div className="error-banner">{assignmentError}</div>}

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
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* The buttons land here, at the foot of the panel. */}
      <div className="client-tab-footer" ref={setActionsTarget} />
    </div>
  );
}

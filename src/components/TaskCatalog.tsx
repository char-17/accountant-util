import { useState } from "react";
import type { TaskType } from "../domain/types";
import type { TaskUsage } from "../persistence/taskRepo";
import { DeleteImpact } from "./DeleteImpact";
import { MUTED_PALETTE, isColorUsed } from "../utils/colors";
import { toMessage } from "../utils/errors";

interface TaskCatalogProps {
  tasks: TaskType[];
  /** What each task is attached to, so deleting can say what it would take. */
  usage?: Record<number, TaskUsage>;
  onCreate: (data: Pick<TaskType, "name" | "color" | "description">) => Promise<void>;
  onUpdate: (id: number, data: Partial<TaskType>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  suggestColor: () => Promise<string>;
}

export function TaskCatalog({ tasks, usage = {}, onCreate, onUpdate, onDelete }: TaskCatalogProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: "", color: "", description: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Held until confirmed. Deleting a task straight from the row took the whole
  // month's history with it, and there was no way back from that.
  const [pendingDelete, setPendingDelete] = useState<TaskType | null>(null);
  const [deleting, setDeleting] = useState(false);

  const usedColors = tasks.filter((t) => t.isActive).map((t) => t.color);

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setError("");
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      // The dialog closes so the error is not hidden behind it, but the reason
      // is kept on the page - a failed delete is not a silent one.
      setError(toMessage(err));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleAdd() {
    if (!formData.name.trim()) {
      setError("Το όνομα είναι υποχρεωτικό");
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        name: formData.name,
        color: formData.color || MUTED_PALETTE[0],
        description: formData.description,
      });
      setFormData({ name: "", color: "", description: "" });
      setIsAdding(false);
      setError("");
    } catch (err) {
      // Surface the reason instead of closing the form as if it had worked.
      setError(toMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(task: TaskType) {
    setEditingId(task.id);
    setFormData({ name: task.name, color: task.color, description: task.description || "" });
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    await onUpdate(editingId, formData);
    setEditingId(null);
    setFormData({ name: "", color: "", description: "" });
  }

  return (
    <div className="task-catalog">
      <div className="task-catalog-header">
        <h2>Κατάλογος Εργασιών</h2>
        <button className="btn-primary" onClick={() => setIsAdding(true)}>
          + Νέα Εργασία
        </button>
      </div>

      {isAdding && (
        <div className="task-form">
          <input
            type="text"
            placeholder="Όνομα εργασίας *"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            aria-label="Όνομα εργασίας"
          />
          <div className="color-picker" role="group" aria-label="Επιλογή χρώματος">
            {MUTED_PALETTE.map((color) => (
              <button
                key={color}
                className={`color-option ${formData.color === color ? "selected" : ""} ${isColorUsed(color, usedColors) ? "used" : ""}`}
                style={{ backgroundColor: color }}
                onClick={() => setFormData({ ...formData, color })}
                aria-pressed={formData.color === color}
                title={isColorUsed(color, usedColors) ? `${color} - χρησιμοποιείται ήδη` : color}
              />
            ))}
          </div>
          <input
            type="text"
            placeholder="Περιγραφή (προαιρετικό)"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            aria-label="Περιγραφή εργασίας"
          />
          {error && <span className="error-message">{error}</span>}
          <div className="form-actions">
            <button className="btn-primary" onClick={handleAdd} disabled={saving}>
              {saving ? "Αποθήκευση..." : "Αποθήκευση"}
            </button>
            <button className="btn-secondary" onClick={() => { setIsAdding(false); setError(""); }}>
              Ακύρωση
            </button>
          </div>
        </div>
      )}

      <div className="task-list">
        {tasks.length === 0 ? (
          <p className="empty-message">Δεν υπάρχουν εργασίες</p>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className={`task-item ${!task.isActive ? "inactive" : ""}`}>
              {editingId === task.id ? (
                <div className="task-edit-form">
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    aria-label={`Όνομα εργασίας${task.name ? ` - ${task.name}` : ""}`}
                  />
                  <div className="color-picker" role="group" aria-label="Επιλογή χρώματος">
                    {MUTED_PALETTE.map((color) => (
                      <button
                        key={color}
                        className={`color-option ${formData.color === color ? "selected" : ""}`}
                        style={{ backgroundColor: color }}
                        onClick={() => setFormData({ ...formData, color })}
                        aria-pressed={formData.color === color}
                        title={color}
                      />
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="Περιγραφή"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    aria-label="Περιγραφή εργασίας"
                  />
                  <div className="form-actions">
                    <button className="btn-small" onClick={handleSaveEdit}>Αποθήκευση</button>
                    <button className="btn-small btn-secondary" onClick={() => setEditingId(null)}>
                      Ακύρωση
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="task-info">
                    <span className="task-color-dot" style={{ backgroundColor: task.color }} />
                    <div>
                      <span className="task-name">{task.name}</span>
                      {task.description && (
                        <span className="task-description">{task.description}</span>
                      )}
                    </div>
                  </div>
                  <div className="task-actions">
                    <button className="btn-small" onClick={() => handleEdit(task)}>
                      Επεξεργασία
                    </button>
                    <button
                      className="btn-small btn-secondary"
                      onClick={() => onUpdate(task.id, { isActive: !task.isActive })}
                    >
                      {task.isActive ? "Απενεργοποίηση" : "Ενεργοποίηση"}
                    </button>
                    <button className="btn-small btn-danger" onClick={() => setPendingDelete(task)}>
                      Διαγραφή
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => !deleting && setPendingDelete(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Διαγραφή εργασίας"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Διαγραφή εργασίας</h3>
            <p>
              Θα διαγραφεί η εργασία <strong>{pendingDelete.name}</strong>.
            </p>
            <DeleteImpact
              clients={usage[pendingDelete.id]?.clients ?? 0}
              history={usage[pendingDelete.id]?.history ?? 0}
            />
            <div className="form-actions">
              <button className="btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Διαγραφή..." : "Ναι, διέγραψε"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
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

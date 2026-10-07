import { useState } from "react";
import type { TaskType } from "../domain/types";
import { MUTED_PALETTE, isColorUsed } from "../utils/colors";
import { toMessage } from "../utils/errors";

interface TaskCatalogProps {
  tasks: TaskType[];
  onCreate: (data: Pick<TaskType, "name" | "color" | "description">) => Promise<void>;
  onUpdate: (id: number, data: Partial<TaskType>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  suggestColor: () => Promise<string>;
}

export function TaskCatalog({ tasks, onCreate, onUpdate, onDelete }: TaskCatalogProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: "", color: "", description: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const usedColors = tasks.filter((t) => t.isActive).map((t) => t.color);

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
                    <button className="btn-small btn-danger" onClick={() => onDelete(task.id)}>
                      Διαγραφή
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

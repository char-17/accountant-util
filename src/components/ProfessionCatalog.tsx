import { useState } from "react";
import type { Profession } from "../domain/types";
import { MUTED_PALETTE, isColorUsed } from "../utils/colors";
import { toMessage } from "../utils/errors";

interface ProfessionCatalogProps {
  professions: Profession[];
  /** How many clients carry each profession, for the delete confirmation. */
  clientCounts?: Record<number, number>;
  onCreate: (data: { name: string; description?: string | null; color: string }) => Promise<void>;
  onUpdate: (id: number, data: Partial<Profession>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  /** The first palette colour not yet taken, asked of the database. */
  suggestColor: () => Promise<string>;
}

/**
 * The profession catalogue. Same shape and behaviour as the task catalogue: a
 * list with edit, activate/deactivate and delete on every row, and a colour
 * chosen from the same muted palette - the dot beside the name is what tells
 * two similarly-named professions apart at a glance in the worklist.
 */
export function ProfessionCatalog({
  professions,
  clientCounts = {},
  onCreate,
  onUpdate,
  onDelete,
  suggestColor,
}: ProfessionCatalogProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", color: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Profession | null>(null);
  const [deleting, setDeleting] = useState(false);

  const usedColors = professions.filter((p) => p.isActive).map((p) => p.color);

  // Asked each time the form opens, not once at mount: the list of taken
  // colours is whatever is in the database when the user reaches for "+ Νέο".
  const startAdding = async () => {
    setFormData({ name: "", description: "", color: await suggestColor() });
    setError("");
    setIsAdding(true);
  };

  const cancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setError("");
  };

  async function handleAdd() {
    if (!formData.name.trim()) {
      setError("Το όνομα επαγγέλματος είναι υποχρεωτικό");
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        name: formData.name.trim(),
        description: formData.description,
        color: formData.color,
      });
      cancel();
    } catch (err) {
      // Surface the reason rather than closing the form as if it had worked.
      setError(toMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setSaving(true);
    try {
      await onUpdate(editingId, {
        name: formData.name.trim(),
        description: formData.description,
        color: formData.color,
      });
      setEditingId(null);
      setFormData({ name: "", description: "", color: "" });
      setError("");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDelete(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      setError(toMessage(err));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="task-catalog">
      <div className="task-catalog-header">
        <h2>Κατάλογος Επαγγελμάτων</h2>
        <button className="btn-primary" onClick={startAdding}>
          + Νέο Επάγγελμα
        </button>
      </div>

      {isAdding && (
        <div className="task-form">
          <div className="form-group">
            <label htmlFor="pf-name">Όνομα *</label>
            <input
              id="pf-name"
              type="text"
              placeholder="π.χ. Ελεύθερος Επαγγελματίας"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="pf-desc">Περιγραφή</label>
            <textarea
              id="pf-desc"
              rows={2}
              placeholder="Τι καλύπτει αυτό το επάγγελμα (προαιρετικό)"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>
          {/* Same palette and same swatch grid as the task catalogue, so the two
              lists are picked from identically. */}
          <div className="color-picker" role="group" aria-label="Επιλογή χρώματος επαγγέλματος">
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
          {error && <span className="error-message">{error}</span>}
          <div className="form-actions">
            <button className="btn-primary" onClick={handleAdd} disabled={saving}>
              {saving ? "Αποθήκευση..." : "Αποθήκευση"}
            </button>
            <button className="btn-secondary" onClick={cancel}>
              Άκυρο
            </button>
          </div>
        </div>
      )}

      <div className="task-list">
        {professions.length === 0 ? (
          <p className="empty-message">Δεν υπάρχουν επαγγέλματα</p>
        ) : (
          professions.map((profession) => {
            const inUse = clientCounts[profession.id] ?? 0;
            return (
              <div
                key={profession.id}
                className={`task-item ${!profession.isActive ? "inactive" : ""}`}
              >
                {editingId === profession.id ? (
                  <div className="task-edit-form">
                    <div className="form-group">
                      <label htmlFor={`pf-edit-name-${profession.id}`}>Όνομα</label>
                      <input
                        id={`pf-edit-name-${profession.id}`}
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor={`pf-edit-desc-${profession.id}`}>Περιγραφή</label>
                      <textarea
                        id={`pf-edit-desc-${profession.id}`}
                        rows={2}
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      />
                    </div>
                    <div className="color-picker" role="group" aria-label="Επιλογή χρώματος επαγγέλματος">
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
                    {error && <span className="error-message">{error}</span>}
                    <div className="form-actions">
                      <button className="btn-small" onClick={handleSaveEdit} disabled={saving}>
                        Αποθήκευση
                      </button>
                      <button className="btn-small btn-secondary" onClick={() => setEditingId(null)}>
                        Άκυρο
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="task-info">
                      {/* The same dot, in the same place, as a task's - so the two
                          catalogues are read the same way. */}
                      <span className="task-color-dot" style={{ backgroundColor: profession.color }} />
                      <div>
                        <span className="task-name">{profession.name}</span>
                        {profession.description && (
                          <span className="task-description">{profession.description}</span>
                        )}
                        {inUse > 0 && (
                          <span className="task-description">
                            Σε {inUse} {inUse === 1 ? "πελάτη" : "πελάτες"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="task-actions">
                      <button
                        className="btn-small"
                        onClick={() => {
                          setEditingId(profession.id);
                          setFormData({
                            name: profession.name,
                            description: profession.description || "",
                            // Preloaded so saving without touching the swatches
                            // keeps the colour the row already had.
                            color: profession.color,
                          });
                          setError("");
                        }}
                      >
                        Επεξεργασία
                      </button>
                      <button
                        className="btn-small btn-secondary"
                        onClick={() => onUpdate(profession.id, { isActive: !profession.isActive })}
                      >
                        {profession.isActive ? "Απενεργοποίηση" : "Ενεργοποίηση"}
                      </button>
                      <button
                        className="btn-small btn-danger"
                        onClick={() => setPendingDelete(profession)}
                      >
                        Διαγραφή
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => !deleting && setPendingDelete(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Διαγραφή επαγγέλματος"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Διαγραφή επαγγέλματος</h3>
            <p>
              Θα διαγραφεί το επάγγελμα <strong>{pendingDelete.name}</strong>.
            </p>
            <div className="modal-warning">
              {(clientCounts[pendingDelete.id] ?? 0) > 0 ? (
                <>
                  Θα αποσυνδεθεί από{" "}
                  <strong>
                    {clientCounts[pendingDelete.id]}{" "}
                    {(clientCounts[pendingDelete.id] ?? 0) === 1 ? "πελάτη" : "πελάτες"}
                  </strong>
                  , οι οποίοι θα εμφανίζονται χωρίς επάγγελμα. Τα δεδομένα τους δεν
                  χάνονται.
                </>
              ) : (
                "Δεν χρησιμοποιείται από κανέναν πελάτη."
              )}
            </div>
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

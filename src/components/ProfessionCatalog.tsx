import { useState } from "react";
import type { Profession } from "../domain/types";
import { toMessage } from "../utils/errors";

interface ProfessionCatalogProps {
  professions: Profession[];
  /** How many clients carry each profession, for the delete confirmation. */
  clientCounts?: Record<number, number>;
  onCreate: (data: { name: string; description?: string | null }) => Promise<void>;
  onUpdate: (id: number, data: Partial<Profession>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

/**
 * The profession catalogue. Same shape and behaviour as the task catalogue:
 * a list with edit, activate/deactivate and delete on every row. The difference
 * is that a profession carries no colour - there is nothing to colour it for -
 * so the row is name and description, and the actions sit on the right.
 */
export function ProfessionCatalog({
  professions,
  clientCounts = {},
  onCreate,
  onUpdate,
  onDelete,
}: ProfessionCatalogProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Profession | null>(null);
  const [deleting, setDeleting] = useState(false);

  const startAdding = () => {
    setFormData({ name: "", description: "" });
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
      await onCreate({ name: formData.name.trim(), description: formData.description });
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
      await onUpdate(editingId, { name: formData.name.trim(), description: formData.description });
      setEditingId(null);
      setFormData({ name: "", description: "" });
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

import { useState, useEffect } from "react";
import type { ClientInput } from "../hooks/useClients";
import { validateClient } from "../domain/validation";

interface ClientFormProps {
  onSubmit: (data: ClientInput) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  initialData?: Partial<ClientInput>;
  /** Clear the fields after a successful submit. Right for "create", wrong for "edit". */
  resetOnSuccess?: boolean;
  /** When set, a delete button sits at the far right of the action row. */
  onDelete?: () => Promise<void>;
  deleteLabel?: string;
}

type FormState = {
  name: string;
  email: string;
  phone: string;
  address: string;
  taxId: string;
  notes: string;
};

const EMPTY: FormState = {
  name: "",
  email: "",
  phone: "",
  address: "",
  taxId: "",
  notes: "",
};

export function ClientForm({
  onSubmit,
  onCancel,
  submitLabel = "Αποθήκευση",
  initialData,
  resetOnSuccess = false,
  onDelete,
  deleteLabel = "Διαγραφή πελάτη",
}: ClientFormProps) {
  const [form, setForm] = useState<FormState>({ ...EMPTY, ...initialData });
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Clear the transient banners whenever the form is re-targeted.
  useEffect(() => {
    setSuccess("");
    setSubmitError("");
  }, [initialData?.name]);

  const set = (key: keyof FormState) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleDelete() {
    if (!onDelete) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setSubmitError("");
    try {
      await onDelete();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError("");
    setSuccess("");

    const validationErrors = validateClient(form);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);

    setSaving(true);
    try {
      await onSubmit({
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        taxId: form.taxId || undefined,
        notes: form.notes || undefined,
      });
      // Only reset when creating. On edit the caller owns the record, and
      // clearing here would blank the fields the user is looking at.
      if (resetOnSuccess) {
        setForm(EMPTY);
      }
      setSuccess("Οι αλλαγές αποθηκεύτηκαν.");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message;

  return (
    <form className="client-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="cf-name">Όνομα *</label>
        <input
          id="cf-name"
          type="text"
          value={form.name}
          onChange={(e) => set("name")(e.target.value)}
          className={errorFor("name") ? "error" : ""}
          required
        />
        {errorFor("name") && <span className="error-message">{errorFor("name")}</span>}
      </div>

      {/* Email and phone each get a full row: at the modal's width the two
          together left the phone field too narrow to read a number into. */}
      <div className="form-group">
        <label htmlFor="cf-email">Email</label>
        <input
          id="cf-email"
          type="email"
          value={form.email}
          onChange={(e) => set("email")(e.target.value)}
          className={errorFor("email") ? "error" : ""}
        />
        {errorFor("email") && <span className="error-message">{errorFor("email")}</span>}
      </div>

      <div className="form-group">
        <label htmlFor="cf-phone">Τηλέφωνο</label>
        <input
          id="cf-phone"
          type="text"
          value={form.phone}
          onChange={(e) => set("phone")(e.target.value)}
          className={errorFor("phone") ? "error" : ""}
        />
        {errorFor("phone") && <span className="error-message">{errorFor("phone")}</span>}
      </div>

      <div className="form-group">
        <label htmlFor="cf-address">Διεύθυνση</label>
        <input
          id="cf-address"
          type="text"
          value={form.address}
          onChange={(e) => set("address")(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="cf-taxid">ΑΦΜ</label>
        <input
          id="cf-taxid"
          type="text"
          value={form.taxId}
          onChange={(e) => set("taxId")(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="cf-notes">Σημειώσεις</label>
        <textarea
          id="cf-notes"
          rows={3}
          value={form.notes}
          onChange={(e) => set("notes")(e.target.value)}
        />
      </div>

      {success && <div className="success-banner" role="status">{success}</div>}
      {submitError && <div className="error-banner">{submitError}</div>}

      {confirmDelete && onDelete && (
        <div className="inline-confirm">
          <span className="inline-confirm-text">
            Θα διαγραφούν και οι εργασίες/ιστορικό του πελάτη. Επιβεβαίωση;
          </span>
          <button
            type="button"
            className="btn-danger btn-small"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Διαγραφή..." : "Ναι, διέγραψε"}
          </button>
          <button
            type="button"
            className="btn-secondary btn-small"
            onClick={() => setConfirmDelete(false)}
            disabled={deleting}
          >
            Όχι
          </button>
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Αποθήκευση..." : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Ακύρωση
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="btn-danger btn-push-right"
            onClick={handleDelete}
            disabled={deleting || saving}
            title="Οριστική διαγραφή πελάτη"
          >
            {deleting ? "Διαγραφή..." : deleteLabel}
          </button>
        )}
      </div>
    </form>
  );
}

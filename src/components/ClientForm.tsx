import { useState, useEffect, useId } from "react";
import { createPortal } from "react-dom";
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
  /**
   * Where to render the action row, when it should not sit inside the form.
   *
   * The client tab puts its buttons at the foot of the whole panel, below the
   * assignments, rather than in the middle of the form. The buttons still need
   * this component's `saving`/`deleting` state and its submit handler, so the
   * row is portalled into the target rather than lifted back out to the parent.
   * Left unset - as in the "new client" modal - it renders inline as before.
   */
  actionsTarget?: HTMLElement | null;
}

type FormState = {
  name: string;
  taxId: string;
  notes: string;
};

const EMPTY: FormState = {
  name: "",
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
  actionsTarget,
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

  // The portalled submit button lives outside the <form>, and HTML only submits
  // a form from a button inside it. The `form` attribute points it back, and
  // useId keeps it unique so two forms on a page cannot collide.
  const formId = useId();

  const actionRow = (
    <div className="form-actions">
      <button
        type="submit"
        className="btn-primary"
        disabled={saving}
        form={actionsTarget ? formId : undefined}
      >
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
  );

  // Portalled: the row renders where the tab asked for it, but it is still this
  // component's markup and state. Inline: unchanged, which is what the "new
  // client" modal wants.

  return (
    <>
      <form className="client-form" id={formId} onSubmit={handleSubmit}>
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

        {/* Inline only. A submit button outside its <form> does not submit it,
            so when the row is rendered here it has to be a child of the form.
            When it is portalled it carries on submitting through the form
            attribute set below. */}
        {!actionsTarget && actionRow}
      </form>

      {actionsTarget && createPortal(actionRow, actionsTarget)}
    </>
  );
}

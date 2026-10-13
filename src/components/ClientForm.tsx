import { useState, useEffect, useId, useMemo } from "react";
import { createPortal } from "react-dom";
import type { ClientInput } from "../hooks/useClients";
import type { Profession } from "../domain/types";
import { validateClient } from "../domain/validation";
import { ClientFilterSelect } from "./WorklistFiltersBar";

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
  /**
   * The professions a client can be classified into.
   *
   * Left out the field is not rendered at all, which is what the "new client"
   * modal wants - it is a quick form and the profession belongs on the client
   * tab, where there is room to browse the list.
   */
  professions?: Profession[];
}

type FormState = {
  name: string;
  /**
   * "" means unclassified. Held as a string rather than an id because it comes
   * out of a DOM control, and the empty string is a value the picker itself
   * produces for "no profession".
   */
  professionId: string;
  taxId: string;
  notes: string;
};

const EMPTY: FormState = {
  name: "",
  professionId: "",
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
  professions,
}: ClientFormProps) {
  // professionId is normalised here rather than through the spread below: it
  // arrives as a number or null from the record, but the state holds a string,
  // and a bare spread would put a number into a field typed as string.
  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY,
    ...initialData,
    professionId: initialData?.professionId != null ? String(initialData.professionId) : "",
  }));
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

    // professionId is held as a string for the control; the domain wants the
    // id, so it is converted rather than passed through as-is.
    const validationErrors = validateClient({
      ...form,
      professionId: form.professionId === "" ? null : Number(form.professionId),
    });
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);

    setSaving(true);
    try {
      await onSubmit({
        name: form.name,
        // null, not undefined: an empty picker is a real instruction to clear
        // the client's profession, and undefined would mean "leave it alone".
        professionId: form.professionId === "" ? null : Number(form.professionId),
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

  // One swatch per profession, rebuilt only when the list does. The picker is
  // not memoised, so an object built inline would simply be a new allocation on
  // every keystroke elsewhere in the form.
  const professionSwatches = useMemo(
    () => Object.fromEntries((professions ?? []).map((p) => [p.id, p.color])),
    [professions]
  );

  // Every id in here is derived from useId rather than written out.
  //
  // Two instances of this form are on screen at once whenever the client tab is
  // open: the dashboard behind it keeps the "new client" modal mounted. With
  // fixed ids the two copies of #cf-name collided, and a <label for> resolves to
  // the first match in the document - so the client tab's label pointed at the
  // modal's input behind the overlay, and clicking it moved focus there.
  const uid = useId();
  const formId = `${uid}-form`;
  const nameFieldId = `${uid}-name`;
  const taxIdFieldId = `${uid}-taxid`;
  const notesFieldId = `${uid}-notes`;

  // The portalled submit button lives outside the <form>, and HTML only submits
  // a form from a button inside it. The `form` attribute points it back.
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
          <label htmlFor={nameFieldId}>Όνομα *</label>
          <input
            id={nameFieldId}
            type="text"
            value={form.name}
            onChange={(e) => set("name")(e.target.value)}
            className={errorFor("name") ? "error" : ""}
            required
          />
          {errorFor("name") && <span className="error-message">{errorFor("name")}</span>}
        </div>

        <div className="form-group">
          <label htmlFor={taxIdFieldId}>ΑΦΜ</label>
          <input
            id={taxIdFieldId}
            type="text"
            value={form.taxId}
            onChange={(e) => set("taxId")(e.target.value)}
          />
        </div>

        {professions && (
          <div className="form-group">
            {/* A span, not a label: the picker is a composite control - a search
                box and a toggle in one head - and <label for> needs a single form
                element to point at. The picker carries its own accessible name
                via aria-label, so this is the visible caption only, and it has
                no id because nothing refers to it. */}
            <span className="form-label-like">Επάγγελμα</span>
            <ClientFilterSelect
              value={form.professionId === "" ? null : Number(form.professionId)}
              options={professions}
              onChange={(id) => set("professionId")(id === null ? "" : String(id))}
              allLabel="Χωρίς επάγγελμα"
              searchLabel="Αναζήτηση επαγγέλματος..."
              listLabel="Επάγγελμα πελάτη"
              className="filter-profession"
              emptyText="Κανένα επάγγελμα με αυτό το όνομα"
              colors={professionSwatches}
            />
            {/* Nothing to pick from is a dead end unless it says where the list
                comes from. */}
            {professions.length === 0 && (
              <span className="form-hint">
                Δεν έχουν καταχωρηθεί επαγγέλματα. Προσθέστε τα από την καρτέλα
                «Επαγγέλμα».
              </span>
            )}
          </div>
        )}

        <div className="form-group">
          <label htmlFor={notesFieldId}>Σημειώσεις</label>
          <textarea
            id={notesFieldId}
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

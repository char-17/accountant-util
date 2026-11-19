import { displayDate, parseDisplayDate } from "../domain/dates";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatAmount, parseAmount } from "../domain/money";
import { financialValues, localDate, type SaveFinance } from "../domain/taskFinance";
import type { MonthlyStatusWithDetails } from "../domain/types";
import { useDialogA11y } from "../hooks/useDialogA11y";

export type FinanceAction = "collect" | "invoice" | "correction";

interface TaskFinanceDialogProps {
  action: FinanceAction;
  item: MonthlyStatusWithDetails;
  initialAmount: string;
  onSave: SaveFinance;
  onClose: () => void;
}

interface DateFieldProps {
  label: string;
  text: string;
  disabled: boolean;
  onChange: (text: string) => void;
}

function DateField({ label, text, disabled, onChange }: DateFieldProps) {
  const id = useId();
  const calendar = useRef<HTMLInputElement>(null);
  return (
    <div className="finance-date-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-label={label} type="text" value={text} placeholder="ηη/μμ/εεεε"
        disabled={disabled} onChange={event => onChange(event.target.value)} />
      <span className="finance-calendar">
        <button type="button" aria-label={`Επιλογή από ημερολόγιο (${label})`} disabled={disabled}
          onClick={() => calendar.current?.showPicker()}>📅</button>
        <input ref={calendar} type="date" aria-label="Ημερολόγιο" aria-hidden="true" tabIndex={-1} disabled={disabled}
          value={parseDisplayDate(text) ?? ""} onChange={event => onChange(displayDate(event.target.value, ""))} />
      </span>
    </div>
  );
}

export function TaskFinanceDialog({ action, item, initialAmount, onSave, onClose }: TaskFinanceDialogProps) {
  const titleId = useId();
  const [amountText, setAmountText] = useState(initialAmount);
  const [values, setValues] = useState(() => financialValues(item));
  const [paidText, setPaidText] = useState(() => displayDate(action === "collect" ? localDate() : item.paidAt, ""));
  const [invoiceText, setInvoiceText] = useState(() => displayDate(action === "invoice" ? localDate() : item.invoicedAt, ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useDialogA11y<HTMLDivElement>(true, () => { if (!busy) onClose(); });
  const correcting = action === "correction";
  const pendingCollection = action === "collect" && item.status === "pending";
  const title = correcting ? "Διόρθωση καταχώρισης" : action === "invoice" ? "Καταχώριση τιμολογίου" : "Καταχώριση είσπραξης";

  async function confirm(complete = false) {
    const amount = parseAmount(amountText);
    if (amount === null) {
      setError("Συμπληρώστε έγκυρο ποσό σε ευρώ.");
      return;
    }
    const paidAt = parseDisplayDate(paidText);
    const invoicedAt = parseDisplayDate(invoiceText);
    // Older records can have a flag without a date. Preserve that when editing another field.
    if (!paidAt && (action === "collect" || (correcting && values.isPaid && (item.paidAt || paidText)))) {
      setError("Συμπληρώστε έγκυρη ημερομηνία είσπραξης σε μορφή ηη/μμ/εεεε.");
      return;
    }
    if (!invoicedAt && (action === "invoice" || (correcting && values.isInvoiced && (item.invoicedAt || invoiceText)))) {
      setError("Συμπληρώστε έγκυρη ημερομηνία τιμολογίου σε μορφή ηη/μμ/εεεε.");
      return;
    }
    setBusy(true);
    try {
      if (action === "correction") {
        await onSave(item, { kind: action, values: { ...values, amount, paidAt, invoicedAt } });
      } else if (action === "collect") {
        await onSave(item, { kind: action, amount, date: paidAt ?? "", complete });
      } else {
        await onSave(item, { kind: action, amount, date: invoicedAt ?? "" });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal finance-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h3 id={titleId}>{title}</h3>
        <p><strong>{item.clientName}</strong> · {item.taskName} · {item.month}/{item.year}</p>
        <label>Ποσό (€)
          <input aria-label="Ποσό (€)" inputMode="decimal" value={amountText} disabled={busy}
            readOnly={!correcting && Boolean(item.isPaid || item.isInvoiced) && item.amount != null}
            onChange={event => setAmountText(event.target.value)} />
        </label>
        {correcting && (
          <p>Προηγούμενο ποσό: {item.amount == null ? "—" : formatAmount(item.amount) + " €"}. Η αλλαγή θα καταγραφεί στο ιστορικό.</p>
        )}
        {action === "correction" ? (
          <>
            {Boolean(item.isPaid) && (
              <div>
                <label><input type="checkbox" checked={values.isPaid} disabled={busy}
                  onChange={event => setValues({ ...values, isPaid: event.target.checked })} /> Εισπράχθηκε</label>
                {values.isPaid && <DateField label="Ημερομηνία είσπραξης" text={paidText} onChange={setPaidText} disabled={busy} />}
              </div>
            )}
            {Boolean(item.isInvoiced) && (
              <div>
                <label><input type="checkbox" checked={values.isInvoiced} disabled={busy}
                  onChange={event => setValues({ ...values, isInvoiced: event.target.checked })} /> Εκδόθηκε τιμολόγιο</label>
                {values.isInvoiced && <DateField label="Ημερομηνία τιμολογίου" text={invoiceText} onChange={setInvoiceText} disabled={busy} />}
              </div>
            )}
          </>
        ) : (
          <DateField label={action === "collect" ? "Ημερομηνία είσπραξης" : "Ημερομηνία τιμολογίου"}
            text={action === "collect" ? paidText : invoiceText} disabled={busy}
            onChange={action === "collect" ? setPaidText : setInvoiceText} />
        )}
        {pendingCollection && <p>Η εργασία είναι εκκρεμής. Θέλετε να σημειωθεί και ως ολοκληρωμένη;</p>}
        {error && <p role="alert" className="task-payment-error">{error}</p>}
        <div className="form-actions">
          {pendingCollection && <button className="btn-primary" disabled={busy} onClick={() => void confirm(true)}>Ολοκλήρωση και είσπραξη</button>}
          <button className={pendingCollection ? "btn-secondary" : "btn-primary"} disabled={busy} onClick={() => void confirm()}>
            {correcting ? "Επιβεβαίωση διόρθωσης" : action === "invoice" ? "Καταχώριση τιμολογίου" : pendingCollection ? "Είσπραξη μόνο" : "Καταχώριση είσπραξης"}
          </button>
          <button className="btn-secondary" disabled={busy} onClick={onClose}>Άκυρο</button>
        </div>
      </div>
    </div>, document.body
  );
}

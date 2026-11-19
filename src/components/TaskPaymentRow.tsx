import { displayDate, greekDateOptions } from "../domain/dates";
import { useEffect, useState } from "react";
import type { FinancialValues, MonthlyStatusWithDetails } from "../domain/types";
import type { SaveFinance } from "../domain/taskFinance";
import { formatAmount, parseAmount } from "../domain/money";
import { TaskFinanceDialog, type FinanceAction } from "./TaskFinanceDialog";

const dateLabel = (date: string | null | undefined) => displayDate(date, "χωρίς ημερομηνία");

function describeValues(value: FinancialValues) {
  const amount = value.amount == null ? "χωρίς ποσό" : formatAmount(value.amount) + " €";
  const paid = value.isPaid ? "είσπραξη " + dateLabel(value.paidAt) : "χωρίς είσπραξη";
  const invoice = value.isInvoiced ? "τιμολόγιο " + dateLabel(value.invoicedAt) : "χωρίς τιμολόγιο";
  return [amount, paid, invoice].join(" · ");
}

interface TaskPaymentRowProps {
  item: MonthlyStatusWithDetails;
  onSave: SaveFinance;
}

export function TaskPaymentRow({ item, onSave }: TaskPaymentRowProps) {
  const [amountText, setAmountText] = useState(String(item.amount ?? ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ action: FinanceAction; item: MonthlyStatusWithDetails; amount: string } | null>(null);
  const locked = Boolean(item.isPaid || item.isInvoiced);

  useEffect(() => {
    setAmountText(String(item.amount ?? ""));
    setError("");
  }, [item.id, item.year, item.month, item.amount]);

  async function commitAmount() {
    if (locked || busy) return;
    const amount = parseAmount(amountText);
    if (amount === null && amountText.trim() !== "") {
      setError("Συμπληρώστε έγκυρο ποσό σε ευρώ.");
      return;
    }
    if (amount === (item.amount ?? null)) return;
    setBusy(true);
    try {
      await onSave(item, { kind: "amount", amount });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function review(action: FinanceAction) {
    setError("");
    setDialog({ action, item, amount: amountText });
  }

  return (
    <div className="task-payment">
      <div className="task-payment-fields">
        <label className="task-payment-field task-payment-check">
          <input type="checkbox" checked={Boolean(item.isPaid)} disabled={busy} data-finance-action
            onChange={() => review(item.isPaid ? "correction" : "collect")} aria-label={`Είσπραξη για ${item.taskName}`} />
          <span className="task-payment-check-label">Είσπραξη</span>
        </label>
        <label className="task-payment-field task-payment-amount-field">
          <span className="task-payment-label">Ποσό</span>
          <input type="text" inputMode="decimal" className="task-payment-amount"
            value={amountText} placeholder="0,00" disabled={busy} readOnly={locked}
            onChange={event => setAmountText(event.target.value)}
            onBlur={event => {
              const next = event.relatedTarget;
              const opensReview = next instanceof HTMLElement && next.hasAttribute("data-finance-action")
                && event.currentTarget.closest(".task-payment")?.contains(next);
              if (!opensReview) void commitAmount();
            }}
            onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
            aria-label={`Ποσό για ${item.taskName}`} />
        </label>
        <label className="task-payment-field task-payment-check">
          <input type="checkbox" checked={Boolean(item.isInvoiced)} disabled={busy} data-finance-action
            onChange={() => review(item.isInvoiced ? "correction" : "invoice")} aria-label={`Τιμολόγιο για ${item.taskName}`} />
          <span className="task-payment-check-label">Τιμολόγιο</span>
        </label>
      </div>
      {locked && (
        <div className="task-finance-status">
          {Boolean(item.isPaid) && <span>{item.amount == null ? "Καταχωρισμένη είσπραξη" : `Εισπράχθηκαν ${formatAmount(item.amount)} €`} · {dateLabel(item.paidAt)}</span>}
          {Boolean(item.isInvoiced) && <span>Εκδόθηκε τιμολόγιο · {dateLabel(item.invoicedAt)}</span>}
          <button type="button" className="link-button" onClick={() => review("correction")}>Διόρθωση καταχώρισης</button>
        </div>
      )}
      {Boolean(item.corrections?.length) && (
        <details className="task-finance-history">
          <summary>Ιστορικό διορθώσεων ({item.corrections?.length})</summary>
          <ol>{item.corrections?.map((entry, index) => (
            <li key={index}>{new Date(entry.at).toLocaleString("el-GR", { ...greekDateOptions, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              <div>Πριν: {describeValues(entry.before)}</div>
              <div>Μετά: {describeValues(entry.after)}</div>
            </li>
          ))}</ol>
        </details>
      )}
      {error && <span className="task-payment-error" role="alert">{error}</span>}
      {dialog && <TaskFinanceDialog action={dialog.action} item={dialog.item} initialAmount={dialog.amount}
        onSave={onSave} onClose={() => setDialog(null)} />}
    </div>
  );
}

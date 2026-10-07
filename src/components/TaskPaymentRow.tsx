import { useEffect, useState } from "react";
import type { MonthlyStatusWithDetails } from "../domain/types";
import { parseAmount } from "../domain/money";
import { validatePayment } from "../domain/validation";

interface TaskPaymentRowProps {
  item: MonthlyStatusWithDetails;
  onSetAmount: (clientId: number, taskTypeId: number, amount: number | null) => Promise<void>;
  onSetPaid: (
    clientId: number,
    taskTypeId: number,
    isPaid: boolean,
    paidAt: string | null
  ) => Promise<void>;
  onSetInvoiced: (
    clientId: number,
    taskTypeId: number,
    isInvoiced: boolean,
    invoicedAt: string | null
  ) => Promise<void>;
}

/** YYYY-MM-DD, the shape both SQLite and a date input expect. */
function toIsoDate(value?: string): string {
  if (!value) return "";
  return value.slice(0, 10);
}

function formatDisplayDate(value?: string): string {
  const iso = toIsoDate(value);
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("el-GR");
}

/**
 * Fee, collection and invoicing for one month of one task.
 *
 * The amount is typed freely and committed on blur or Enter, so a half-typed
 * "1." never reaches the database. Ticking "Εισπραξη" without an amount is
 * refused with a message instead of silently writing a paid row with no figure,
 * which is the rule the accountant asked for.
 */
export function TaskPaymentRow({
  item,
  onSetAmount,
  onSetPaid,
  onSetInvoiced,
}: TaskPaymentRowProps) {
  // Local draft so typing is not fighting the round trip to the database.
  const [amountText, setAmountText] = useState(
    item.amount !== null && item.amount !== undefined ? String(item.amount) : ""
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Adopt a value written elsewhere (another row, a restore, a month change)
  // without stomping on what the user is currently typing.
  useEffect(() => {
    setAmountText(item.amount !== null && item.amount !== undefined ? String(item.amount) : "");
    setError("");
  }, [item.id, item.amount, item.year, item.month]);

  async function commitAmount() {
    const parsed = parseAmount(amountText);
    const current = item.amount ?? null;
    if (parsed === current) return;

    const problems = validatePayment({ amount: parsed, isPaid: item.isPaid, isInvoiced: item.isInvoiced });
    if (problems.length > 0) {
      setError(problems[0].message);
      return;
    }

    setBusy(true);
    try {
      await onSetAmount(item.clientId, item.taskTypeId, parsed);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Αποτυχία αποθήκευσης ποσού");
    } finally {
      setBusy(false);
    }
  }

  async function togglePaid() {
    const next = !item.isPaid;
    const problems = validatePayment({ amount: item.amount ?? null, isPaid: next, isInvoiced: item.isInvoiced });
    if (problems.length > 0) {
      setError(problems[0].message);
      return;
    }

    setBusy(true);
    try {
      // The collection date defaults to today the first time it is ticked, and is
      // an editable date afterwards.
      const paidAt = next ? new Date().toISOString().slice(0, 10) : null;
      await onSetPaid(item.clientId, item.taskTypeId, next, paidAt);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Αποτυχία ενημέρωσης είσπραξης");
    } finally {
      setBusy(false);
    }
  }

  async function toggleInvoiced() {
    const next = !item.isInvoiced;
    setBusy(true);
    try {
      const invoicedAt = next ? new Date().toISOString().slice(0, 10) : null;
      await onSetInvoiced(item.clientId, item.taskTypeId, next, invoicedAt);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Αποτυχία ενημέρωσης τιμολογίου");
    } finally {
      setBusy(false);
    }
  }

  async function changePaidAt(value: string) {
    setBusy(true);
    try {
      await onSetPaid(item.clientId, item.taskTypeId, item.isPaid, value || null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Αποτυχία ενημέρωσης ημερομηνίας");
    } finally {
      setBusy(false);
    }
  }

  async function changeInvoicedAt(value: string) {
    setBusy(true);
    try {
      await onSetInvoiced(item.clientId, item.taskTypeId, item.isInvoiced, value || null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Αποτυχία ενημέρωσης ημερομηνίας");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="task-payment">
      <div className="task-payment-fields">
        <label className="task-payment-field">
          <input
            type="checkbox"
            checked={item.isPaid}
            disabled={busy}
            onChange={togglePaid}
            aria-label={`Εισπραξη για ${item.taskName}`}
          />
          <span>Εισπραξη</span>
        </label>

        <label className="task-payment-field">
          <span className="task-payment-label">Ποσό</span>
          <input
            type="text"
            inputMode="decimal"
            className="task-payment-amount"
            value={amountText}
            placeholder="0,00"
            disabled={busy}
            onChange={(e) => setAmountText(e.target.value)}
            onBlur={commitAmount}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            aria-label={`Ποσό για ${item.taskName}`}
          />
        </label>

        {item.isPaid && (
          <label className="task-payment-field">
            <span className="task-payment-label">Ημ. Είσπραξης</span>
            <input
              type="date"
              className="task-payment-date"
              value={toIsoDate(item.paidAt)}
              disabled={busy}
              onChange={(e) => changePaidAt(e.target.value)}
              aria-label={`Ημερομηνία είσπραξης για ${item.taskName}`}
            />
          </label>
        )}

        <label className="task-payment-field">
          <input
            type="checkbox"
            checked={item.isInvoiced}
            disabled={busy}
            onChange={toggleInvoiced}
            aria-label={`Τιμολόγιο για ${item.taskName}`}
          />
          <span>Τιμολόγιο</span>
        </label>

        {item.isInvoiced && (
          <label className="task-payment-field">
            <span className="task-payment-label">Ημ. Τιμολογίου</span>
            <input
              type="date"
              className="task-payment-date"
              value={toIsoDate(item.invoicedAt)}
              disabled={busy}
              onChange={(e) => changeInvoicedAt(e.target.value)}
              aria-label={`Ημερομηνία τιμολογίου για ${item.taskName}`}
            />
          </label>
        )}
      </div>

      {item.isPaid && item.paidAt && (
        <span className="task-payment-hint">Εισπραξη: {formatDisplayDate(item.paidAt)}</span>
      )}
      {item.isInvoiced && item.invoicedAt && (
        <span className="task-payment-hint">Τιμολόγιο: {formatDisplayDate(item.invoicedAt)}</span>
      )}

      {error && (
        <span className="task-payment-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
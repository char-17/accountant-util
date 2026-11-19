import { isCalendarDate } from "./dates";
import { validatePayment } from "./validation";
import type { FinancialValues, MonthlyStatusWithDetails } from "./types";

export type FinancialChange =
  | { kind: "amount"; amount: number | null }
  | { kind: "collect"; amount: number; date: string; complete: boolean }
  | { kind: "invoice"; amount: number; date: string }
  | { kind: "correction"; values: FinancialValues };

export type SaveFinance = (item: MonthlyStatusWithDetails, change: FinancialChange) => Promise<void>;

export function financialValues(item: MonthlyStatusWithDetails): FinancialValues {
  return {
    amount: item.amount ?? null,
    isPaid: Boolean(item.isPaid),
    paidAt: item.paidAt || null,
    isInvoiced: Boolean(item.isInvoiced),
    invoicedAt: item.invoicedAt || null,
  };
}

export function localDate(date = new Date()): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}

export function applyFinancialChange(before: FinancialValues, change: FinancialChange): FinancialValues {
  const locked = before.isPaid || before.isInvoiced;
  const next = change.kind === "correction" ? { ...change.values } : { ...before, amount: change.amount };
  if (locked && change.kind !== "correction" && before.amount !== next.amount) {
    throw Error("Το ποσό είναι κλειδωμένο. Επιλέξτε «Διόρθωση καταχώρισης».");
  }
  if (change.kind === "collect") {
    if (before.isPaid) throw Error("Η είσπραξη έχει ήδη καταχωριστεί.");
    next.isPaid = true;
    next.paidAt = change.date;
  }
  if (change.kind === "invoice") {
    if (before.isInvoiced) throw Error("Το τιμολόγιο έχει ήδη καταχωριστεί.");
    next.isInvoiced = true;
    next.invoicedAt = change.date;
  }
  const [amountError] = validatePayment(next);
  if (amountError) throw Error(amountError.message);
  if (!next.isPaid) next.paidAt = null;
  if (!next.isInvoiced) next.invoicedAt = null;
  if (next.isPaid && !isCalendarDate(next.paidAt) && !(before.isPaid && next.paidAt === before.paidAt)) {
    throw Error("Συμπληρώστε έγκυρη ημερομηνία είσπραξης.");
  }
  if (next.isInvoiced && !isCalendarDate(next.invoicedAt) && !(before.isInvoiced && next.invoicedAt === before.invoicedAt)) {
    throw Error("Συμπληρώστε έγκυρη ημερομηνία τιμολογίου.");
  }
  if (change.kind === "correction" && ((!before.isPaid && next.isPaid) || (!before.isInvoiced && next.isInvoiced))) {
    throw Error("Για νέα καταχώριση επιλέξτε την αντίστοιχη οικονομική ενέργεια.");
  }
  return next;
}

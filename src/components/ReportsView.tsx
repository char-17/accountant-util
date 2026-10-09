import { useState } from "react";
import type { ReportClientGroup, ReportPeriod, ReportRange } from "../domain/types";
import {
  REPORT_PERIOD_LABELS,
  monthsInRange,
  reportRangeLabel,
  reportTotals,
} from "../domain/report";
import { formatAmount } from "../domain/money";

interface ReportsViewProps {
  groups: ReportClientGroup[];
  loading: boolean;
  year: number;
  month: number;
  period: ReportPeriod;
  onPeriodChange: (period: ReportPeriod) => void;
  /** Only used by the manual period. */
  customFrom: number;
  customTo: number;
  onCustomRangeChange: (from: number, to: number) => void;
  /** True when the chosen range holds no rows at all. */
  isEmpty: boolean;
}

const MONTH_OPTIONS = [
  { value: 1, label: "Ιανουάριος" },
  { value: 2, label: "Φεβρουάριος" },
  { value: 3, label: "Μάρτιος" },
  { value: 4, label: "Απρίλιος" },
  { value: 5, label: "Μάιος" },
  { value: 6, label: "Ιούνιος" },
  { value: 7, label: "Ιούλιος" },
  { value: 8, label: "Αύγουστος" },
  { value: 9, label: "Σεπτέμβριος" },
  { value: 10, label: "Οκτώβριος" },
  { value: 11, label: "Νοέμβριος" },
  { value: 12, label: "Δεκέμβριος" },
];

/** "Εισπραγμένο" in green, otherwise an explicit grey "Εκκρεμεί". */
function PaymentCell({ isPaid }: { isPaid: boolean }) {
  return (
    <span className={`report-paid ${isPaid ? "yes" : "no"}`}>
      {isPaid ? "Εισπραγμένο" : "Εκκρεμεί"}
    </span>
  );
}

function InvoiceCell({ isInvoiced }: { isInvoiced: boolean }) {
  return (
    <span className={`report-invoiced ${isInvoiced ? "yes" : "no"}`}>
      {isInvoiced ? "Εκδόθηκε" : "Εκκρεμεί"}
    </span>
  );
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const iso = value.slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("el-GR");
}

/**
 * The report: clients, each with their services indented underneath, and the
 * collection state per service.
 *
 * "Εισπραγμένο" is carried by colour *and* by the word itself, so the state is
 * still readable when printed in black and white or read by someone who cannot
 * distinguish the two colours.
 */
export function ReportsView({
  groups,
  loading,
  year,
  month,
  period,
  onPeriodChange,
  customFrom,
  customTo,
  onCustomRangeChange,
  isEmpty,
}: ReportsViewProps) {
  const [expanded, setExpanded] = useState(true);

  const range: ReportRange =
    period === "custom"
      ? { year, fromMonth: Math.min(customFrom, customTo), toMonth: Math.max(customFrom, customTo) }
      : period === "year"
        ? { year, fromMonth: 1, toMonth: 12 }
        : period === "quarter"
          ? (() => {
              const first = Math.floor((month - 1) / 3) * 3 + 1;
              return { year, fromMonth: first, toMonth: first + 2 };
            })()
          : { year, fromMonth: month, toMonth: month };

  const totals = reportTotals(groups);
  const monthCount = monthsInRange(range).length;

  return (
    <div className="reports-view">
      <div className="reports-controls">
        <div className="reports-period" role="group" aria-label="Περίοδος αναφοράς">
          {(Object.keys(REPORT_PERIOD_LABELS) as ReportPeriod[]).map((p) => (
            <button
              key={p}
              className={`status-filter-option ${period === p ? "active" : ""}`}
              onClick={() => onPeriodChange(p)}
              aria-pressed={period === p}
            >
              {REPORT_PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {period === "custom" && (
          <div className="reports-custom-range">
            <label>
              <span>Από</span>
              <select
                value={customFrom}
                onChange={(e) => onCustomRangeChange(Number(e.target.value), customTo)}
                aria-label="Αναφορά από μήνα"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Έως</span>
              <select
                value={customTo}
                onChange={(e) => onCustomRangeChange(customFrom, Number(e.target.value))}
                aria-label="Αναφορά έως μήνα"
              >
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <p className="reports-range-label">
          {reportRangeLabel(range)}
          {monthCount > 1 && <span> · {monthCount} μήνες</span>}
        </p>
      </div>

      {loading ? (
        <p className="empty-message">Φόρτωση...</p>
      ) : isEmpty ? (
        <p className="empty-message">
          Δεν υπάρχουν εργασίες για την περίοδο {reportRangeLabel(range)}.
        </p>
      ) : (
        <>
          <div className="reports-totals">
            <div className="report-total">
              <span className="report-total-value">{formatAmount(totals.amount)} €</span>
              <span className="report-total-label">Συνολικό ποσό</span>
            </div>
            <div className="report-total">
              <span className="report-total-value paid">{formatAmount(totals.paid)} €</span>
              <span className="report-total-label">Εισπραγμένα</span>
            </div>
            <div className="report-total">
              <span className="report-total-value unpaid">{formatAmount(totals.unpaid)} €</span>
              <span className="report-total-label">Ανείσπρακτα</span>
            </div>
            <div className="report-total">
              <span className="report-total-value">{formatAmount(totals.invoiced)} €</span>
              <span className="report-total-label">Τιμολογημένα</span>
            </div>
          </div>

          <div className="reports-table-section">
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Πελάτης / Υπηρεσία</th>
                    <th scope="col">Εισπραξη</th>
                    <th scope="col">Έκδοση Τιμολογίου</th>
                    <th scope="col">Ποσό</th>
                    <th scope="col">Ημερομηνία Είσπραξης</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <ReportGroupRow
                      key={group.clientId}
                      group={group}
                      expanded={expanded}
                      onToggle={() => setExpanded((v) => !v)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface ReportGroupRowProps {
  group: ReportClientGroup;
  expanded: boolean;
  onToggle: () => void;
}

function ReportGroupRow({ group, expanded, onToggle }: ReportGroupRowProps) {
  return (
    <>
      <tr className="report-client-row">
        <th scope="rowgroup">
          <button className="report-client-toggle" onClick={onToggle} aria-expanded={expanded}>
            <span aria-hidden="true" className="report-caret">
              {expanded ? "▾" : "▸"}
            </span>
            {group.clientName}
          </button>
        </th>
        <td colSpan={2} />
        <td className="report-amount">{formatAmount(group.totalAmount)} €</td>
        <td className="report-amount-muted">
          {formatAmount(group.paidAmount)} € / {formatAmount(group.totalAmount)} €
        </td>
      </tr>

      {expanded &&
        group.rows.map((row) => (
          <tr key={row.key} className="report-service-row">
            <td className="report-service-name">
              <span
                className="task-color-dot"
                style={{ backgroundColor: row.taskColor }}
                aria-hidden="true"
              />
              <span className="report-service-label">{row.taskName}</span>
              <span className="report-service-month">
                {new Date(row.year, row.month - 1, 1).toLocaleDateString("el-GR", {
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </td>
            <td>
              <PaymentCell isPaid={row.isPaid} />
            </td>
            <td>
              <InvoiceCell isInvoiced={row.isInvoiced} />
            </td>
            <td className="report-amount">{formatAmount(row.amount)} €</td>
            <td className="report-date">{formatDate(row.paidAt)}</td>
          </tr>
        ))}
    </>
  );
}
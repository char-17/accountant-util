import { displayDate } from "../domain/dates";
import { Fragment, useRef, useState } from "react";
import type { ReportBasis, ReportClientGroup, ReportPeriod, ReportServiceRow } from "../domain/types";
import {
  reportTotals,
  REPORT_PERIOD_LABELS,
  normalizeCustomRange,
  rangeForPeriod,
  REPORT_BASIS_LABELS,
  reportRangeLabel,
} from "../domain/report";
import { ClientFilterSelect } from "./WorklistFiltersBar";
import { formatAmount } from "../domain/money";

interface ReportsViewProps {
  basis: ReportBasis;
  onBasisChange: (basis: ReportBasis) => void;
  invoicedUnpaid: boolean;
  onInvoicedUnpaidChange: (value: boolean) => void;
  clients: { id: number; name: string }[];
  error?: string;
  onRetry?: () => void;
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


/**
 * The report: clients, each with their services indented underneath, and the
 * amount and dates for each service.
 */
export function ReportsView({
  error,
  onRetry,
  groups, clients, basis, onBasisChange, invoicedUnpaid, onInvoicedUnpaidChange,
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
  // Which client rows are open, by client id.
  //
  // `null` means "not decided yet", which reads as everything open - the report
  // starts fully expanded so the numbers are visible without a click. Once the
  // user touches a row it becomes an explicit list, and only the row they
  // touched moves. A single boolean shared by every row would fold them
  // together: clicking one client opened and closed all of them at once, which
  // is what it used to do.
  const [expandedIds, setExpandedIds] = useState<Set<number> | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [amountSort, setAmountSort] = useState<"asc" | "desc" | null>(null);

  // A new report starts fully open again. Adjusted during render rather than in
  // an effect: an effect would run after paint, so the previous period's
  // collapsed rows would flash on screen for a frame before being reset.
  const reportBasis = `${basis}-${invoicedUnpaid}-${year}-${month}-${period}-${customFrom}-${customTo}`;
  const lastBasis = useRef(reportBasis);
  if (lastBasis.current !== reportBasis) {
    lastBasis.current = reportBasis;
    setExpandedIds(null);
  }

  const isExpanded = (clientId: number) =>
    expandedIds === null ? true : expandedIds.has(clientId);

  const toggleClient = (clientId: number) =>
    setExpandedIds((prev) => {
      // First click decides the starting point from the rows actually on screen,
      // so whichever client was clicked moves and the rest stay where they are.
      const base = prev ?? new Set(groups.map((g) => g.clientId));
      const next = new Set(base);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });

  const range = period === "custom"
    ? normalizeCustomRange(year, customFrom, customTo) : rangeForPeriod(period, year, month);
  const work = basis === "work";
  const multipleMonths = range.fromMonth !== range.toMonth;
  const visibleGroups = selectedClientId === null
    ? groups
    : groups.filter((group) => group.clientId === selectedClientId);
  const totals = reportTotals(visibleGroups);
  const summaries: Record<ReportBasis, [string, number][]> = {
    work: [
      ["Αμοιβές", totals.amount],
      ["Εισπραχθέντα", totals.paid],
      ["Τιμολογημένα", totals.invoiced],
      ["Σύνολο προς είσπραξη", totals.unpaid],
    ],
    payments: [["Σύνολο εισπράξεων περιόδου", totals.paid]],
    invoices: [["Σύνολο τιμολογημένων περιόδου", totals.invoiced]],
  };
  const hasVisibleRows = visibleGroups.length > 0;
  const orderedGroups = amountSort === null
    ? visibleGroups
    : [...visibleGroups]
        .sort((a, b) => {
          const difference = a.totalAmount - b.totalAmount;
          return amountSort === "asc" ? difference : -difference;
        });

  const cycleAmountSort = () => {
    setAmountSort((current) =>
      current === null ? "asc" : current === "asc" ? "desc" : null
    );
  };

  // Prints the page, not the app: the report is laid out for the screen, so the
  // controls, the totals strip and the client rows all have to say whether they
  // belong on paper. See the @media print block in App.css.
  const handlePrint = () => window.print();

  return (
    <div className="reports-view">
      <div className="report-basis-options" role="group" aria-label="Είδος αναφοράς">
        {(Object.keys(REPORT_BASIS_LABELS) as ReportBasis[]).map(key => (
          <button key={key} type="button" className={basis === key ? "status-filter-option active" : "status-filter-option"}
            aria-pressed={basis === key} onClick={() => onBasisChange(key)}>{REPORT_BASIS_LABELS[key]}</button>
        ))}
      </div>
      <div className="reports-controls">
        <div className="reports-period" role="group" aria-label="Περίοδος αναφοράς">
          {(Object.keys(REPORT_PERIOD_LABELS) as ReportPeriod[])
            .filter((p) => p !== "custom")
            .map((p) => (
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

        <div className="reports-custom-group">
          <button
            className={`status-filter-option ${period === "custom" ? "active" : ""}`}
            onClick={() => onPeriodChange("custom")}
            aria-pressed={period === "custom"}
          >
            {REPORT_PERIOD_LABELS.custom}
          </button>

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
        </div>

        {/* The period in words sits between the buttons and the print action
            rather than on a line of its own: it describes what those buttons
            selected, so reading it directly beside them saves the eye a trip
            down and back. Centred in the space that leaves. */}
        <p className="reports-range-label">
          {reportRangeLabel(range)}
        </p>

        <button className="btn-secondary reports-print" onClick={handlePrint}>
          Εκτύπωση
        </button>
      </div>

      <div className="reports-filter-row">
        <ClientFilterSelect
          value={selectedClientId}
          options={clients}
          onChange={setSelectedClientId}
          allLabel="Όλοι οι πελάτες"
          searchLabel="Αναζήτηση πελάτη..."
          listLabel="Φίλτρο αναφορών ανά πελάτη"
          className="filter-client"
        />
        {work && <label className="report-outstanding-filter">
          <input type="checkbox" checked={invoicedUnpaid} onChange={e => onInvoicedUnpaidChange(e.target.checked)} />
          Τιμολογημένα προς είσπραξη
        </label>}
      </div>

      <p className="report-print-context">{REPORT_BASIS_LABELS[basis]} · {clients.find(client => client.id === selectedClientId)?.name ?? "Όλοι οι πελάτες"}
        {work && invoicedUnpaid && " · Τιμολογημένα προς είσπραξη"}</p>
      {!loading && !error && (
        <dl className="reports-totals" aria-label="Οικονομικά σύνολα">
          {summaries[basis].map(([label, value]) => (
            <div key={label} className="report-total">
              <dt className="report-total-label">{label}</dt>
              <dd className="report-total-value">{formatAmount(value)} €</dd>
            </div>
          ))}
        </dl>
      )}
      {loading ? (
        <p className="empty-message">Φόρτωση...</p>
      ) : error ? (
        <p role="alert">{error} <button onClick={onRetry}>Επανάληψη</button></p>
      ) : isEmpty || !hasVisibleRows ? (
        <p className="empty-message">
          {selectedClientId !== null ? "Καμία κίνηση για τον επιλεγμένο πελάτη στην περίοδο."
            : work && !invoicedUnpaid ? `Δεν υπάρχουν εργασίες για την περίοδο ${reportRangeLabel(range)}.`
            : "Δεν υπάρχουν καταχωρίσεις για την επιλεγμένη περίοδο και τα φίλτρα."}
        </p>
      ) : (
        <div className="report-table-wrap">
          <table className="report-table" data-basis={basis}>
            <thead>
              <tr>
                <th scope="col">ΠΕΛΑΤΗΣ / ΥΠΗΡΕΣΙΑ</th>
                <th scope="col">
                  <span className="report-amount-print-label">ΠΟΣΟ</span>
                  <button
                    type="button"
                    className="report-sort-button"
                    onClick={cycleAmountSort}
                    aria-label={`Ταξινόμηση ποσού ${amountSort === "asc" ? "φθίνουσα" : "αύξουσα"}`}
                    title="Ταξινόμηση με βάση το ποσό"
                  >
                    <span>ΠΟΣΟ</span>
                    <span className="report-sort-arrows" aria-hidden="true">
                      {amountSort === "asc" ? "↑" : amountSort === "desc" ? "↓" : "↕"}
                    </span>
                  </button>
                </th>
                {work && <th scope="col">ΠΡΟΣ ΕΙΣΠΡΑΞΗ</th>}
                {basis !== "invoices" && <th scope="col">ΗΜΕΡΟΜΗΝΙΑ ΕΙΣΠΡΑΞΗΣ</th>}
                {basis !== "payments" && <th scope="col">ΗΜΕΡΟΜΗΝΙΑ ΕΚΔΟΣΗΣ ΤΙΜΟΛΟΓΙΟΥ</th>}
              </tr>
            </thead>
            {orderedGroups.map((group) => (
              <ReportGroupRow
                key={group.clientId}
                group={group} basis={basis} multipleMonths={multipleMonths} amountSort={amountSort}
                expanded={isExpanded(group.clientId)}
                onToggle={() => toggleClient(group.clientId)}
              />
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

interface ReportGroupRowProps {
  basis: ReportBasis;
  multipleMonths: boolean;
  amountSort: "asc" | "desc" | null;
  group: ReportClientGroup;
  expanded: boolean;
  onToggle: () => void;
}

function monthOfRow(row: ReportServiceRow, basis: ReportBasis) {
  if (basis === "work") return row.month;
  return Number((basis === "payments" ? row.paidAt : row.invoicedAt)?.slice(5, 7));
}

function ReportGroupRow({ group, basis, multipleMonths, amountSort, expanded, onToggle }: ReportGroupRowProps) {
  const work = basis === "work";
  const rows = [...group.rows].sort((a, b) => {
    const months = monthOfRow(a, basis) - monthOfRow(b, basis);
    if (months) return months;
    if (amountSort) return ((a.amount ?? 0) - (b.amount ?? 0)) * (amountSort === "asc" ? 1 : -1);
    if (work) return 0;
    const first = basis === "payments" ? a.paidAt : a.invoicedAt;
    const second = basis === "payments" ? b.paidAt : b.invoicedAt;
    return (first ?? "").localeCompare(second ?? "");
  });
  return (
    <tbody>
      <tr className="report-client-row">
        <th scope="rowgroup">
          <button className="report-client-toggle" onClick={onToggle} aria-expanded={expanded}>
            <span aria-hidden="true" className="report-caret">
              {expanded ? "▾" : "▸"}
            </span>
            {group.clientName}
          </button>
        </th>
        <td className="report-amount">{formatAmount(group.totalAmount)} €</td>
        {work && <td className="report-amount report-outstanding">{formatAmount(reportTotals([group]).unpaid)} €</td>}
        <td colSpan={work ? 2 : 1} />
      </tr>

      {expanded &&
        rows.map((row, index) => (
          <Fragment key={row.key}>
            {multipleMonths && (index === 0 || monthOfRow(row, basis) !== monthOfRow(rows[index - 1], basis)) &&
              <tr className="report-month-row"><th colSpan={work ? 5 : 3}>{MONTH_OPTIONS[monthOfRow(row, basis) - 1]?.label}</th></tr>}
            <tr className="report-service-row">
              <td className="report-service-name">
                <span
                  className="task-color-dot"
                  style={{ backgroundColor: row.taskColor }}
                  aria-hidden="true"
                />
                <span className="report-service-label">{row.taskName}</span>
              </td>
              <td className="report-amount">{row.amount == null ? "Χωρίς ποσό" : formatAmount(row.amount) + " €"}</td>
              {work && <td className="report-amount report-outstanding">{!row.isPaid && row.amount == null
                ? "—" : formatAmount(row.isPaid ? 0 : row.amount ?? 0) + " €"}</td>}
              {basis !== "invoices" && <td className="report-date">{displayDate(row.paidAt, row.isPaid ? "Εισπράχθηκε · λείπει ημερομηνία" : "—")}</td>}
              {basis !== "payments" && <td className="report-date">{displayDate(row.invoicedAt, row.isInvoiced ? "Τιμολογήθηκε · λείπει ημερομηνία" : "—")}</td>}
            </tr>
          </Fragment>
        ))}
    </tbody>
  );
}

import { useRef, useState } from "react";
import type { ReportClientGroup, ReportPeriod, ReportRange } from "../domain/types";
import {
  REPORT_PERIOD_LABELS,
  monthsInRange,
  reportRangeLabel,
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

function formatDate(value?: string): string {
  if (!value) return "—";
  const iso = value.slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("el-GR");
}

/**
 * The report: clients, each with their services indented underneath, and the
 * amount and dates for each service.
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
  const reportBasis = `${year}-${month}-${period}-${customFrom}-${customTo}`;
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

  const monthCount = monthsInRange(range).length;
  const visibleGroups = selectedClientId === null
    ? groups
    : groups.filter((group) => group.clientId === selectedClientId);
  const hasVisibleRows = visibleGroups.length > 0;
  const orderedGroups = amountSort === null
    ? visibleGroups
    : [...visibleGroups]
        .sort((a, b) => {
          const difference = a.totalAmount - b.totalAmount;
          return amountSort === "asc" ? difference : -difference;
        })
        .map((group) => ({
          ...group,
          rows: [...group.rows].sort((a, b) =>
            amountSort === "asc" ? a.amount - b.amount : b.amount - a.amount
          ),
        }));

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
          {monthCount > 1 && <span> · {monthCount} μήνες</span>}
        </p>

        <button className="btn-secondary reports-print" onClick={handlePrint}>
          Εκτύπωση
        </button>
      </div>

      {loading ? (
        <p className="empty-message">Φόρτωση...</p>
      ) : isEmpty || !hasVisibleRows ? (
        <p className="empty-message">
          {selectedClientId === null
            ? `Δεν υπάρχουν εργασίες για την περίοδο ${reportRangeLabel(range)}.`
            : "Ο επιλεγμένος πελάτης δεν έχει εργασίες για την επιλεγμένη περίοδο."}
        </p>
      ) : (
        <>
          <div className="reports-filter-row">
            <label className="reports-client-filter">
              <span>Πελάτης</span>
              <select
                value={selectedClientId ?? ""}
                onChange={(event) => setSelectedClientId(event.target.value ? Number(event.target.value) : null)}
                aria-label="Φίλτρο αναφορών ανά πελάτη"
              >
                <option value="">Όλοι οι πελάτες</option>
                {groups.map((group) => (
                  <option key={group.clientId} value={group.clientId}>
                    {group.clientName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  <th scope="col">ΠΕΛΑΤΗΣ / ΥΠΗΡΕΣΙΑ</th>
                  <th scope="col">
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
                  <th scope="col">ΗΜΕΡΟΜΗΝΙΑ ΕΙΣΠΡΑΞΗΣ</th>
                  <th scope="col">ΗΜΕΡΟΜΗΝΙΑ ΕΚΔΟΣΗΣ ΤΙΜΟΛΟΓΙΟΥ</th>
                </tr>
              </thead>
              <tbody>
                {orderedGroups.map((group) => (
                  <ReportGroupRow
                    key={group.clientId}
                    group={group}
                    expanded={isExpanded(group.clientId)}
                    onToggle={() => toggleClient(group.clientId)}
                  />
                ))}
              </tbody>
            </table>
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
        <td className="report-amount">{formatAmount(group.totalAmount)} €</td>
        <td colSpan={2} />
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
            <td className="report-amount">{formatAmount(row.amount)} €</td>
            <td className="report-date">{formatDate(row.paidAt)}</td>
            <td className="report-date">{formatDate(row.invoicedAt)}</td>
          </tr>
        ))}
    </>
  );
}

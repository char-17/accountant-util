/**
 * Building the monthly report as text a spreadsheet can open.
 *
 * Pure string building, kept in the domain layer so the escaping rules can be
 * tested without a filesystem: a client name containing a comma or a quote must
 * survive the round trip into Excel.
 */

import type { MonthlyStatusWithDetails, MonthlySummary } from "./types";

const MONTHS = [
  "Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος",
  "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος",
];

/**
 * Quotes a field for CSV. RFC 4180 requires doubling inner quotes, and Excel on
 * a Greek locale expects `;` as the separator, so both are handled here.
 */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  // A leading =, +, - or @ makes Excel treat the cell as a formula. Only text
  // is escaped: a real negative number must stay a number in the report.
  const risky = typeof value === "string" && /^[=+\-@]/.test(text);
  const safe = risky ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvRow(values: Array<string | number | null | undefined>): string {
  return values.map(csvCell).join(";");
}

export interface ReportOptions {
  year: number;
  month: number;
  statuses: MonthlyStatusWithDetails[];
  summary: MonthlySummary;
  /** Names shown when the report is used to start a new import. */
  filterDescription?: string;
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("el-GR");
}

/** e.g. "2026-10-07" — sorts correctly and is unambiguous. */
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

/**
 * A three-block report: the month's totals, then one row per task. The summary
 * block comes first so a printed page leads with the state of the month.
 */
export function buildCsvReport({ year, month, statuses, summary, filterDescription }: ReportOptions): string {
  const lines: string[] = [];
  const periodLabel = `${MONTHS[month - 1]} ${year}`;

  lines.push(csvRow(["Αναφορά εργασιών"]));
  lines.push(csvRow(["Περίοδος", periodLabel]));
  if (filterDescription) {
    lines.push(csvRow(["Φίλτρα", filterDescription]));
  }
  lines.push(csvRow(["Ημερομηνία δημιουργίας", isoDate(new Date())]));
  lines.push("");

  lines.push(csvRow(["Σύνοψη"]));
  lines.push(csvRow(["Πελάτες", summary.totalClients]));
  lines.push(csvRow(["Εργασίες", summary.totalTasks]));
  lines.push(csvRow(["Ολοκληρωμένες", summary.completedTasks]));
  lines.push(csvRow(["Εκκρεμείς", summary.pendingTasks]));
  lines.push("");

  lines.push(
    csvRow(["Πελάτης", "Εργασία", "Κατάσταση", "Ημερομηνία ολοκλήρωσης", "Σημείωση"])
  );

  for (const s of statuses) {
    lines.push(
      csvRow([
        s.clientName,
        s.taskName,
        s.status === "completed" ? "Ολοκληρωμένη" : "Εκκρεμής",
        formatDate(s.completedAt),
        s.note ?? "",
      ])
    );
  }

  if (statuses.length === 0) {
    lines.push(csvRow(["(καμία εργασία για την περίοδο)"]));
  }

  lines.push("");

  if (summary.clientProgress.length > 0) {
    lines.push(csvRow(["Πρόοδος ανά πελάτη"]));
    lines.push(csvRow(["Πελάτης", "Ολοκληρωμένες", "Σύνολο", "Ολοκληρώθηκε"]));
    for (const p of summary.clientProgress) {
      lines.push(
        csvRow([
          p.clientName,
          p.completedTasks,
          p.totalTasks,
          p.isComplete ? "Ναι" : "Όχι",
        ])
      );
    }
  }

  // Trailing newline so the last line is a complete row for other readers.
  return lines.join("\r\n") + "\r\n";
}

/** Filename such as "report-2026-10-07.csv", safe on Windows. */
export function reportFileName(extension: string, date = new Date()): string {
  return `report-${isoDate(date)}.${extension}`;
}
/**
 * Turning a chosen report period into the months a report covers, and turning
 * the status rows of those months into the grouped report the screen shows.
 *
 * Pure functions, so the period arithmetic and the grouping rules are testable
 * without a database or a browser.
 */

import type {
  MonthlyStatusWithDetails,
  ReportClientGroup,
  ReportPeriod,
  ReportRange,
  ReportServiceRow,
} from "./types";
import { roundMoney, sumMoney } from "./money";

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  month: "Μηνιαία",
  quarter: "Τριμηνιαία",
  year: "Ετήσια",
  custom: "Χειροκίνητη",
};

/** A year always runs inside one calendar year, so a range never wraps. */
export function rangeForPeriod(period: ReportPeriod, year: number, month: number): ReportRange {
  switch (period) {
    case "month":
      return { year, fromMonth: month, toMonth: month };
    case "quarter": {
      // Quarters are Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec.
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      return { year, fromMonth: first, toMonth: first + 2 };
    }
    case "year":
      return { year, fromMonth: 1, toMonth: 12 };
    case "custom":
      return { year, fromMonth: month, toMonth: month };
  }
}

/**
 * The manual period is a range between two months of the same year. A reversed
 * range is swapped rather than rejected: the accountant dragged the two handles
 * the wrong way round, and an error message would not tell them what they did
 * wrong.
 */
export function normalizeCustomRange(year: number, from: number, to: number): ReportRange {
  const lo = Math.min(Math.max(from, 1), 12);
  const hi = Math.min(Math.max(to, 1), 12);
  return { year, fromMonth: Math.min(lo, hi), toMonth: Math.max(lo, hi) };
}

/** Every month of a range, inclusive. */
export function monthsInRange(range: ReportRange): number[] {
  const months: number[] = [];
  for (let m = range.fromMonth; m <= range.toMonth; m++) months.push(m);
  return months;
}

export function reportRangeLabel(range: ReportRange): string {
  const names = [
    "Ιαν", "Φεβ", "Μαρ", "Απρ", "Μάι", "Ιουν",
    "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ",
  ];
  if (range.fromMonth === range.toMonth) return `${names[range.fromMonth - 1]} ${range.year}`;
  if (range.fromMonth === 1 && range.toMonth === 12) return `Έτος ${range.year}`;
  return `${names[range.fromMonth - 1]} – ${names[range.toMonth - 1]} ${range.year}`;
}

/**
 * Groups the rows of the covered months by client, keeping the month visible on
 * every line.
 *
 * A service that recurs across the period therefore appears once per month,
 * which is what makes a quarterly or yearly report readable: you can see that
 * the same work was billed in March and again in June. Amounts are summed per
 * client for the footers.
 */
export function buildReport(
  statuses: MonthlyStatusWithDetails[]
): ReportClientGroup[] {
  const groups = new Map<number, ReportClientGroup>();

  for (const s of statuses) {
    let group = groups.get(s.clientId);
    if (!group) {
      group = {
        clientId: s.clientId,
        clientName: s.clientName,
        rows: [],
        totalAmount: 0,
        paidAmount: 0,
        invoicedAmount: 0,
      };
      groups.set(s.clientId, group);
    }

    const amount = typeof s.amount === "number" && Number.isFinite(s.amount) ? s.amount : 0;
    const row: ReportServiceRow = {
      key: `${s.id}`,
      taskName: s.taskName,
      taskColor: s.taskColor,
      year: s.year,
      month: s.month,
      isPaid: Boolean(s.isPaid),
      isInvoiced: Boolean(s.isInvoiced),
      amount,
      paidAt: s.paidAt ?? undefined,
      invoicedAt: s.invoicedAt ?? undefined,
    };
    group.rows.push(row);

    group.totalAmount = roundMoney(group.totalAmount + amount);
    if (row.isPaid) group.paidAmount = roundMoney(group.paidAmount + amount);
    if (row.isInvoiced) group.invoicedAmount = roundMoney(group.invoicedAmount + amount);
  }

  return [...groups.values()].sort((a, b) =>
    a.clientName.localeCompare(b.clientName, "el")
  );
}

export interface ReportTotals {
  amount: number;
  paid: number;
  invoiced: number;
  unpaid: number;
}

/** Grand totals for the whole report, summed per group so rounding stays stable. */
export function reportTotals(groups: ReportClientGroup[]): ReportTotals {
  const amount = sumMoney(groups.map((g) => g.totalAmount));
  const paid = sumMoney(groups.map((g) => g.paidAmount));
  const invoiced = sumMoney(groups.map((g) => g.invoicedAmount));
  return { amount, paid, invoiced, unpaid: roundMoney(amount - paid) };
}
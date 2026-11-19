import { useState, useEffect, useCallback, useMemo } from "react";
import type Database from "@tauri-apps/plugin-sql";
import type { ReportBasis, ReportClientGroup, ReportPeriod } from "../domain/types";
import { buildReport, normalizeCustomRange, monthsInRange, rangeForPeriod } from "../domain/report";
import * as statusRepo from "../persistence/statusRepo";

interface UseReportsResult {
  basis: ReportBasis;
  setBasis: (basis: ReportBasis) => void;
  invoicedUnpaid: boolean;
  setInvoicedUnpaid: (value: boolean) => void;
  groups: ReportClientGroup[];
  loading: boolean;
  error: string;
  period: ReportPeriod;
  setPeriod: (period: ReportPeriod) => void;
  customFrom: number;
  customTo: number;
  setCustomRange: (from: number, to: number) => void;
  isEmpty: boolean;
  refresh: () => void;
}

/**
 * Loads the status rows of the chosen period and groups them for the report.
 *
 * The month range is resolved in the domain layer and only the resulting months
 * are queried, so a yearly report is one query and not twelve.
 */
export function useReports(db: Database | null, year: number, month: number, active: boolean): UseReportsResult {
  const [basis, setBasis] = useState<ReportBasis>("work");
  const [invoicedUnpaid, setInvoicedUnpaid] = useState(false);
  const [period, setPeriod] = useState<ReportPeriod>("month");
  const [customFrom, setCustomFrom] = useState(month);
  const [customTo, setCustomTo] = useState(month);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof statusRepo.getStatusInRange>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Bumped by refresh() so a reload can be triggered without changing the period.
  const [nonce, setNonce] = useState(0);

  const range = useMemo(() => {
    if (period === "custom") {
      return normalizeCustomRange(year, customFrom, customTo);
    }
    return rangeForPeriod(period, year, month);
  }, [period, year, month, customFrom, customTo]);

  useEffect(() => {
    if (!db || !active) return;
    let current = true;
    setLoading(true);
    setError("");
    void statusRepo.getStatusInRange(db, range.year, range.fromMonth, range.toMonth, basis, invoicedUnpaid)
      .then(result => { if (current) setRows(result); })
      .catch(() => {
        if (current) {
          setRows([]);
          setError("Δεν φορτώθηκε η αναφορά. Δοκιμάστε ξανά.");
        }
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [db, active, range.year, range.fromMonth, range.toMonth, basis, invoicedUnpaid, nonce]);

  const setCustomRange = useCallback((from: number, to: number) => {
    setCustomFrom(from);
    setCustomTo(to);
  }, []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const groups = useMemo(() => buildReport(rows), [rows]);

  return {
    basis, setBasis, invoicedUnpaid, setInvoicedUnpaid,
    groups,
    loading,
    error,
    period,
    setPeriod,
    customFrom,
    customTo,
    setCustomRange,
    isEmpty: rows.length === 0,
    refresh,
  };
}

/** Months covered by the current period; used by the header for its own count. */
export function reportMonthCount(
  period: ReportPeriod,
  month: number,
  customFrom: number,
  customTo: number
): number {
  const range =
    period === "custom"
      ? {
          year: 0,
          fromMonth: Math.min(customFrom, customTo),
          toMonth: Math.max(customFrom, customTo),
        }
      : rangeForPeriod(period, 0, month);
  return monthsInRange(range).length;
}
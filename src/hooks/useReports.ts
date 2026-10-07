import { useState, useEffect, useCallback, useMemo } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { ReportClientGroup, ReportPeriod } from "../domain/types";
import { buildReport, monthsInRange, rangeForPeriod } from "../domain/report";
import * as statusRepo from "../persistence/statusRepo";

interface UseReportsResult {
  groups: ReportClientGroup[];
  loading: boolean;
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
export function useReports(db: Database | null, year: number, month: number): UseReportsResult {
  const [period, setPeriod] = useState<ReportPeriod>("month");
  const [customFrom, setCustomFrom] = useState(month);
  const [customTo, setCustomTo] = useState(month);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof statusRepo.getStatusInRange>>>([]);
  const [loading, setLoading] = useState(true);
  // Bumped by refresh() so a reload can be triggered without changing the period.
  const [nonce, setNonce] = useState(0);

  const range = useMemo(() => {
    if (period === "custom") {
      const lo = Math.min(Math.max(customFrom, 1), 12);
      const hi = Math.min(Math.max(customTo, 1), 12);
      return { year, fromMonth: Math.min(lo, hi), toMonth: Math.max(lo, hi) };
    }
    return rangeForPeriod(period, year, month);
  }, [period, year, month, customFrom, customTo]);

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      setRows(await statusRepo.getStatusInRange(db, range.year, range.fromMonth, range.toMonth));
    } finally {
      setLoading(false);
    }
  }, [db, range.year, range.fromMonth, range.toMonth]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  const setCustomRange = useCallback((from: number, to: number) => {
    setCustomFrom(from);
    setCustomTo(to);
  }, []);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const groups = useMemo(() => buildReport(rows), [rows]);

  return {
    groups,
    loading,
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
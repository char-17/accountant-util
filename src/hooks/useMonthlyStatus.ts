import { useState, useEffect, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { MonthlyStatusWithDetails } from "../domain/types";
import * as statusRepo from "../persistence/statusRepo";

export function useMonthlyStatus(db: Database | null, year: number, month: number) {
  const [statuses, setStatuses] = useState<MonthlyStatusWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      // The month's task rows are derived from the active client→task
      // assignments. This must run on every refresh, not just when the month
      // changes: a task assigned today has no status row until it is seeded,
      // and would otherwise stay invisible in the worklist.
      await statusRepo.seedMonthFromAssignments(db, year, month);

      // Counts are derived from these rows in useWorklistFilters, so they stay
      // consistent with whatever the filters show.
      setStatuses(await statusRepo.getMonthlyStatus(db, year, month));
    } finally {
      setLoading(false);
    }
  }, [db, year, month]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const markCompleted = async (
    clientId: number,
    taskTypeId: number,
    note?: string
  ) => {
    if (!db) return;
    await statusRepo.setTaskCompleted(db, clientId, taskTypeId, year, month, note);
    await loadStatus();
  };

  const markPending = async (clientId: number, taskTypeId: number) => {
    if (!db) return;
    await statusRepo.setTaskPending(db, clientId, taskTypeId, year, month);
    await loadStatus();
  };

  // Money writes go through the same reload as the status itself: the amount,
  // the collection and the invoice all live on the same monthly row, so leaving
  // them stale would show a wrong figure in the summary and the report at once.
  const setAmount = async (clientId: number, taskTypeId: number, amount: number | null) => {
    if (!db) return;
    await statusRepo.setAmount(db, clientId, taskTypeId, year, month, amount);
    await loadStatus();
  };

  const setPaid = async (
    clientId: number,
    taskTypeId: number,
    isPaid: boolean,
    paidAt: string | null
  ) => {
    if (!db) return;
    await statusRepo.setPaid(db, clientId, taskTypeId, year, month, isPaid, paidAt);
    await loadStatus();
  };

  const setInvoiced = async (
    clientId: number,
    taskTypeId: number,
    isInvoiced: boolean,
    invoicedAt: string | null
  ) => {
    if (!db) return;
    await statusRepo.setInvoiced(db, clientId, taskTypeId, year, month, isInvoiced, invoicedAt);
    await loadStatus();
  };

  return {
    statuses,
    loading,
    markCompleted,
    markPending,
    setAmount,
    setPaid,
    setInvoiced,
    refresh: loadStatus,
  };
}

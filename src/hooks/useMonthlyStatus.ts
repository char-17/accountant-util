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

  return {
    statuses,
    loading,
    markCompleted,
    markPending,
    refresh: loadStatus,
  };
}

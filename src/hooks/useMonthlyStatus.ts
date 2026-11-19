import { useState, useEffect, useCallback, useRef } from "react";
import type Database from "@tauri-apps/plugin-sql";
import type { MonthlyStatusWithDetails } from "../domain/types";
import type { SaveFinance } from "../domain/taskFinance";
import * as statusRepo from "../persistence/statusRepo";

export function useMonthlyStatus(db: Database | null, year: number, month: number) {
  const [statuses, setStatuses] = useState<MonthlyStatusWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const request = useRef(0);
  const loadStatus = useCallback(async () => {
    if (!db) return;
    const sequence = ++request.current;
    setLoading(true);
    try {
      // The month's task rows are derived from the active client→task
      // assignments. This must run on every refresh, not just when the month
      // changes: a task assigned today has no status row until it is seeded,
      // and would otherwise stay invisible in the worklist.
      await statusRepo.seedMonthFromAssignments(db, year, month);

      // Counts are derived from these rows in useWorklistFilters, so they stay
      // consistent with whatever the filters show.
      const result = await statusRepo.getMonthlyStatus(db, year, month);
      if (sequence === request.current) setStatuses(result);
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }, [db, year, month]);

  const currentLoad = useRef(loadStatus);
  useEffect(() => {
    currentLoad.current = loadStatus;
    void loadStatus();
  }, [loadStatus]);

  const markCompleted = async (
    clientId: number,
    taskTypeId: number,
    note?: string
  ) => {
    if (!db) return;
    await statusRepo.setTaskCompleted(db, clientId, taskTypeId, year, month, note);
    await currentLoad.current();
  };

  const markPending = async (clientId: number, taskTypeId: number) => {
    if (!db) return;
    await statusRepo.setTaskPending(db, clientId, taskTypeId, year, month);
    await currentLoad.current();
  };

  const saveFinance: SaveFinance = async (item, change) => {
    if (!db) throw Error("Η βάση δεν είναι διαθέσιμη.");
    await statusRepo.saveTaskFinance(db, item, change);
  };

  return {
    statuses,
    loading,
    markCompleted,
    markPending,
    saveFinance,
    refresh: useCallback(() => currentLoad.current(), []),
  };
}

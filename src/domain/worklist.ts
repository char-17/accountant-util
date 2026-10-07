/**
 * Filtering and summarising of the monthly worklist.
 *
 * Pure functions over already-loaded rows, so the same rules can be unit tested
 * without a database and reused by both the worklist and the summary panel.
 */

import type { MonthlyStatusWithDetails, MonthlySummary, TaskStatus } from "./types";

export type StatusFilter = "all" | "pending" | "completed";

/**
 * The filters offered above the worklist.
 *
 * `clientId` follows the dashboard selection and is also set by the per-client
 * picker; `taskTypeId` comes from the per-task picker. Both are ids rather than
 * free text, so a partial name typed into a picker's search box narrows the
 * option list without silently filtering rows by a different rule.
 */
export interface WorklistFilters {
  /** Restrict to one client; null means every client. */
  clientId: number | null;
  /** Restrict to one task; null means every task. */
  taskTypeId: number | null;
  status: StatusFilter;
}

export const DEFAULT_FILTERS: WorklistFilters = {
  clientId: null,
  taskTypeId: null,
  status: "all",
};

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "Όλες",
  pending: "Εκκρεμείς",
  completed: "Ολοκληρωμένες",
};

function matchesStatus(status: TaskStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  return status === filter;
}

/** True when the row satisfies every active filter. */
export function matchesFilters(
  item: MonthlyStatusWithDetails,
  filters: WorklistFilters
): boolean {
  if (filters.clientId !== null && item.clientId !== filters.clientId) return false;
  if (filters.taskTypeId !== null && item.taskTypeId !== filters.taskTypeId) return false;
  if (!matchesStatus(item.status, filters.status)) return false;
  return true;
}

export function applyFilters(
  statuses: MonthlyStatusWithDetails[],
  filters: WorklistFilters
): MonthlyStatusWithDetails[] {
  return statuses.filter((item) => matchesFilters(item, filters));
}

/** True when anything other than "show everything" is active. */
export function hasActiveFilters(filters: WorklistFilters): boolean {
  return (
    filters.clientId !== null ||
    filters.taskTypeId !== null ||
    filters.status !== "all"
  );
}

/**
 * Counts per client and overall. Recomputed from the rows rather than stored, so
 * a filtered view reports the progress it actually shows.
 */
export function summarize(
  statuses: MonthlyStatusWithDetails[],
  year: number,
  month: number
): MonthlySummary {
  const byClient = new Map<number, MonthlySummary["clientProgress"][number]>();

  for (const s of statuses) {
    if (!byClient.has(s.clientId)) {
      byClient.set(s.clientId, {
        clientId: s.clientId,
        clientName: s.clientName,
        totalTasks: 0,
        completedTasks: 0,
        pendingTasks: 0,
        isComplete: false,
      });
    }
    const progress = byClient.get(s.clientId)!;
    progress.totalTasks++;
    if (s.status === "completed") {
      progress.completedTasks++;
    } else {
      progress.pendingTasks++;
    }
  }

  const clientProgress = [...byClient.values()];
  for (const progress of clientProgress) {
    progress.isComplete = progress.pendingTasks === 0;
  }

  return {
    year,
    month,
    totalClients: clientProgress.length,
    totalTasks: statuses.length,
    completedTasks: statuses.filter((s) => s.status === "completed").length,
    pendingTasks: statuses.filter((s) => s.status === "pending").length,
    clientProgress,
  };
}
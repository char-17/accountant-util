/**
 * Filtering and summarising of the monthly worklist.
 *
 * Pure functions over already-loaded rows, so the same rules can be unit tested
 * without a database and reused by both the worklist and the summary panel.
 */

import type { MonthlyStatusWithDetails, MonthlySummary, TaskStatus } from "./types";

export type StatusFilter = "all" | "pending" | "completed";

/** The search fields offered above the worklist. `clientId` follows the dashboard selection. */
export interface WorklistFilters {
  /** Restrict to one client; null means every client. */
  clientId: number | null;
  clientQuery: string;
  taskQuery: string;
  status: StatusFilter;
}

export const DEFAULT_FILTERS: WorklistFilters = {
  clientId: null,
  clientQuery: "",
  taskQuery: "",
  status: "all",
};

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: "Όλες",
  pending: "Εκκρεμείς",
  completed: "Ολοκληρωμένες",
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("el-GR");
}

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
  if (!matchesStatus(item.status, filters.status)) return false;

  const clientQuery = normalize(filters.clientQuery);
  if (clientQuery && !normalize(item.clientName).includes(clientQuery)) return false;

  const taskQuery = normalize(filters.taskQuery);
  if (taskQuery && !normalize(item.taskName).includes(taskQuery)) return false;

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
    normalize(filters.clientQuery) !== "" ||
    normalize(filters.taskQuery) !== "" ||
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
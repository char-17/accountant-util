import { useState, useCallback, useMemo } from "react";
import type { MonthlyStatusWithDetails } from "../domain/types";
import {
  DEFAULT_FILTERS,
  applyFilters,
  hasActiveFilters,
  summarize,
  type WorklistFilters,
} from "../domain/worklist";

interface UseWorklistFiltersResult {
  filters: WorklistFilters;
  /** Rows left after the filters; what the worklist should render. */
  filtered: MonthlyStatusWithDetails[];
  /** Counts for the rows on screen, so the summary matches the list. */
  summary: ReturnType<typeof summarize>;
  /** Unfiltered counts, shown only to describe what the filters are hiding. */
  totalCount: number;
  isFiltered: boolean;
  setClientQuery: (value: string) => void;
  setTaskQuery: (value: string) => void;
  setStatus: (value: WorklistFilters["status"]) => void;
  reset: () => void;
}

/**
 * Search and status filters for the monthly worklist. Filtering is pure and
 * derived, so changing a filter never re-queries the database.
 */
export function useWorklistFilters(
  statuses: MonthlyStatusWithDetails[],
  year: number,
  month: number,
  /** The client picked in the dashboard list, or null for every client. */
  selectedClientId: number | null = null
): UseWorklistFiltersResult {
  const [search, setSearch] = useState<Omit<WorklistFilters, "clientId">>({
    clientQuery: DEFAULT_FILTERS.clientQuery,
    taskQuery: DEFAULT_FILTERS.taskQuery,
    status: DEFAULT_FILTERS.status,
  });

  // The dashboard selection is authoritative, so it is combined here instead of
  // being copied into state by an effect - there is no second source of truth
  // to fall out of sync.
  const filters: WorklistFilters = useMemo(
    () => ({ ...search, clientId: selectedClientId }),
    [search, selectedClientId]
  );

  const filtered = useMemo(
    () => applyFilters(statuses, filters),
    [statuses, filters]
  );

  const summary = useMemo(
    () => summarize(filtered, year, month),
    [filtered, year, month]
  );

  const setClientQuery = useCallback((clientQuery: string) => {
    setSearch((prev) => ({ ...prev, clientQuery }));
  }, []);

  const setTaskQuery = useCallback((taskQuery: string) => {
    setSearch((prev) => ({ ...prev, taskQuery }));
  }, []);

  const setStatus = useCallback((status: WorklistFilters["status"]) => {
    setSearch((prev) => ({ ...prev, status }));
  }, []);

  // Clearing the selection is the caller's job: it owns selectedClientId.
  const reset = useCallback(() => setSearch(DEFAULT_FILTERS), []);

  return {
    filters,
    filtered,
    summary,
    totalCount: statuses.length,
    isFiltered: hasActiveFilters(filters),
    setClientQuery,
    setTaskQuery,
    setStatus,
    reset,
  };
}
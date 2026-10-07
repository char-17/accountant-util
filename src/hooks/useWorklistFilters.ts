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
  setClientId: (value: number | null) => void;
  setTaskTypeId: (value: number | null) => void;
  setStatus: (value: WorklistFilters["status"]) => void;
  reset: () => void;
}

/**
 * Per-client, per-task and status filters for the monthly worklist. Filtering is
 * pure and derived, so changing a filter never re-queries the database.
 */
export function useWorklistFilters(
  statuses: MonthlyStatusWithDetails[],
  year: number,
  month: number,
  /** The client picked in the dashboard list, or null for every client. */
  selectedClientId: number | null = null,
  /** Lets the worklist's own client picker drive the dashboard selection. */
  onSelectClient: (id: number | null) => void = () => {}
): UseWorklistFiltersResult {
  const [search, setSearch] = useState<Omit<WorklistFilters, "clientId">>({
    taskTypeId: DEFAULT_FILTERS.taskTypeId,
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

  // Picking a client in the worklist's own dropdown also moves the dashboard
  // selection, otherwise the two controls would disagree about who is selected.
  const setClientId = useCallback(
    (clientId: number | null) => {
      onSelectClient(clientId);
    },
    [onSelectClient]
  );

  const setTaskTypeId = useCallback((taskTypeId: number | null) => {
    setSearch((prev) => ({ ...prev, taskTypeId }));
  }, []);

  const setStatus = useCallback((status: WorklistFilters["status"]) => {
    setSearch((prev) => ({ ...prev, status }));
  }, []);

  // Clearing the filters also clears the dashboard selection, so "Καθαρισμός"
  // genuinely returns the worklist to every client.
  const reset = useCallback(() => {
    setSearch(DEFAULT_FILTERS);
    onSelectClient(null);
  }, [onSelectClient]);

  return {
    filters,
    filtered,
    summary,
    totalCount: statuses.length,
    isFiltered: hasActiveFilters(filters),
    setClientId,
    setTaskTypeId,
    setStatus,
    reset,
  };
}
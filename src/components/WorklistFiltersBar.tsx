import type { WorklistFilters } from "../domain/worklist";
import { STATUS_FILTER_LABELS } from "../domain/worklist";

interface WorklistFiltersBarProps {
  filters: WorklistFilters;
  onClientQueryChange: (value: string) => void;
  onTaskQueryChange: (value: string) => void;
  onStatusChange: (value: WorklistFilters["status"]) => void;
  onReset: () => void;
  /** Hidden when nothing is filtered, so the row stays out of the way. */
  isFiltered: boolean;
  shownCount: number;
  totalCount: number;
}

/**
 * Search by client or task plus a status filter. Colour is never the only cue:
 * the selected option is also underlined and labelled as active.
 */
export function WorklistFiltersBar({
  filters,
  onClientQueryChange,
  onTaskQueryChange,
  onStatusChange,
  onReset,
  isFiltered,
  shownCount,
  totalCount,
}: WorklistFiltersBarProps) {
  return (
    <div className="worklist-filters">
      <div className="worklist-filter-inputs">
        <input
          type="search"
          placeholder="Αναζήτηση πελάτη..."
          value={filters.clientQuery}
          onChange={(e) => onClientQueryChange(e.target.value)}
          aria-label="Φίλτρο πελάτη"
        />
        <input
          type="search"
          placeholder="Αναζήτηση εργασίας..."
          value={filters.taskQuery}
          onChange={(e) => onTaskQueryChange(e.target.value)}
          aria-label="Φίλτρο εργασίας"
        />
      </div>

      <div
        className="status-filter"
        role="group"
        aria-label="Φίλτρο κατάστασης"
      >
        {(Object.keys(STATUS_FILTER_LABELS) as Array<WorklistFilters["status"]>).map(
          (status) => (
            <button
              key={status}
              className={`status-filter-option ${
                filters.status === status ? "active" : ""
              }`}
              onClick={() => onStatusChange(status)}
              aria-pressed={filters.status === status}
            >
              {STATUS_FILTER_LABELS[status]}
            </button>
          )
        )}
      </div>

      {isFiltered && (
        <div className="worklist-filter-status">
          <span aria-live="polite">
            {shownCount} από {totalCount} εργασίες
          </span>
          <button className="btn-small btn-secondary" onClick={onReset}>
            Καθαρισμός
          </button>
        </div>
      )}
    </div>
  );
}
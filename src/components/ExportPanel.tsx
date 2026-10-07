import type { MonthlySummary } from "../domain/types";
import { STATUS_FILTER_LABELS } from "../domain/worklist";
import type { WorklistFilters } from "../domain/worklist";

interface ExportPanelProps {
  summary: MonthlySummary;
  filters: WorklistFilters;
  /** Used to name the selected client/task in the export scope note. */
  clientOptions?: Array<{ id: number; name: string }>;
  taskOptions?: Array<{ id: number; name: string }>;
  onExportCsv: () => Promise<void>;
  exporting: boolean;
}

/** Human-readable summary of what the export will contain. */
function describeScope(
  filters: WorklistFilters,
  clientOptions: Array<{ id: number; name: string }>,
  taskOptions: Array<{ id: number; name: string }>
): string | undefined {
  const parts: string[] = [];

  // The pickers hold ids; naming them keeps the exported file traceable without
  // the accountant having to remember which id was which.
  if (filters.clientId !== null) {
    const name = clientOptions.find((c) => c.id === filters.clientId)?.name;
    parts.push(name ? `πελάτης: "${name}"` : "συγκεκριμένος πελάτης");
  }
  if (filters.taskTypeId !== null) {
    const name = taskOptions.find((t) => t.id === filters.taskTypeId)?.name;
    parts.push(name ? `εργασία: "${name}"` : "συγκεκριμένη εργασία");
  }
  if (filters.status !== "all") parts.push(STATUS_FILTER_LABELS[filters.status]);

  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Export controls for the visible period. Exports what is on screen, so the
 * user is never handed a file that disagrees with the list.
 */
export function ExportPanel({
  summary,
  filters,
  clientOptions = [],
  taskOptions = [],
  onExportCsv,
  exporting,
}: ExportPanelProps) {
  const scope = describeScope(filters, clientOptions, taskOptions);

  return (
    <div className="export-panel">
      <h3>Εξαγωγή</h3>
      <p className="export-scope">
        {summary.totalTasks} εργασίες
        {scope && <span className="export-scope-detail"> · φίλτρα: {scope}</span>}
      </p>
      <div className="export-actions">
        <button
          className="btn-small"
          onClick={onExportCsv}
          disabled={exporting || summary.totalTasks === 0}
          title={
            summary.totalTasks === 0
              ? "Δεν υπάρχουν εργασίες για εξαγωγή"
              : undefined
          }
        >
          {exporting ? "Εξαγωγή..." : "Λήψη CSV"}
        </button>
        <button
          className="btn-small btn-secondary"
          onClick={() => window.print()}
          disabled={summary.totalTasks === 0}
          title="Εκτύπωση ή αποθήκευση ως PDF"
        >
          Εκτύπωση / PDF
        </button>
      </div>
    </div>
  );
}
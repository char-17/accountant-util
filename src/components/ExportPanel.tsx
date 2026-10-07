import type { MonthlySummary } from "../domain/types";
import { STATUS_FILTER_LABELS } from "../domain/worklist";
import type { WorklistFilters } from "../domain/worklist";

interface ExportPanelProps {
  summary: MonthlySummary;
  filters: WorklistFilters;
  onExportCsv: () => Promise<void>;
  exporting: boolean;
}

/** Human-readable summary of what the export will contain. */
function describeScope(filters: WorklistFilters): string | undefined {
  const parts: string[] = [];

  if (filters.clientId !== null) parts.push("συγκεκριμένος πελάτης");
  if (filters.clientQuery.trim()) parts.push(`πελάτης: "${filters.clientQuery.trim()}"`);
  if (filters.taskQuery.trim()) parts.push(`εργασία: "${filters.taskQuery.trim()}"`);
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
  onExportCsv,
  exporting,
}: ExportPanelProps) {
  const scope = describeScope(filters);

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
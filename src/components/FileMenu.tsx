import { useEffect, useRef, useState } from "react";
import type { MonthlySummary } from "../domain/types";
import { STATUS_FILTER_LABELS } from "../domain/worklist";
import type { WorklistFilters } from "../domain/worklist";

interface FileMenuProps {
  summary: MonthlySummary;
  filters: WorklistFilters;
  /** Names the selected client/task for the export tooltip. */
  clientOptions?: Array<{ id: number; name: string }>;
  taskOptions?: Array<{ id: number; name: string }>;
  onExportCsv: () => Promise<void>;
  exporting: boolean;
  onBackup: () => void;
  onRestore: () => void;
  busy: "backup" | "restore" | null;
}

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
 * The "Αρχείο" menu. Everything that leaves the app or touches the database as
 * a whole lives here, so the screen tabs and the month picker on the right stay
 * about moving around inside the app.
 */
export function FileMenu({
  summary,
  filters,
  clientOptions = [],
  taskOptions = [],
  onExportCsv,
  exporting,
  onBackup,
  onRestore,
  busy,
}: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // A menu that stays open behind a dialog, or after the user clicks away, is
  // worse than no menu. Click-outside and Escape both close it, and Escape
  // returns focus to the trigger so the keyboard does not lose its place.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      rootRef.current?.querySelector("button")?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const scope = describeScope(filters, clientOptions, taskOptions);
  const nothingToExport = summary.totalTasks === 0;
  const disabled = busy !== null;

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="file-menu" ref={rootRef}>
      <button
        className={`file-menu-trigger ${open ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="file-menu-list"
      >
        Αρχείο
        <span className="file-menu-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="file-menu-list" id="file-menu-list" role="menu">
          {/* The count and the active filters used to head this menu. Removed:
              the worklist already states both above it - "4 από 12 εργασίες" on
              the filter row, and the pickers that produced the number - so
              repeating them here said the same thing twice before the user had
              read anything. What each action will contain is still on its own
              tooltip, which is where it belongs. */}

          <button
            className="file-menu-item"
            role="menuitem"
            disabled={exporting || nothingToExport}
            title={
              nothingToExport
                ? "Δεν υπάρχουν εργασίες για εξαγωγή"
                : scope
                  ? `Εξαγωγή ${summary.totalTasks} εργασιών · φίλτρα: ${scope}`
                  : `Εξαγωγή ${summary.totalTasks} εργασιών`
            }
            onClick={() => run(() => void onExportCsv())}
          >
            {exporting ? "Εξαγωγή..." : "Εξαγωγή CSV"}
          </button>

          <button
            className="file-menu-item"
            role="menuitem"
            disabled={nothingToExport}
            title="Εκτύπωση ή αποθήκευση ως PDF"
            onClick={() => run(() => window.print())}
          >
            Εκτύπωση σε PDF
          </button>

          <div className="file-menu-separator" role="separator" />

          <button
            className="file-menu-item"
            role="menuitem"
            disabled={disabled}
            title="Το αντίγραφο περιέχει όλους τους πελάτες, τις εργασίες και το ιστορικό ολοκληρώσεων. Μπορείτε να το κρατήσετε σε ασφαλές μέρος."
            onClick={() => run(onBackup)}
          >
            {busy === "backup" ? "Δημιουργία..." : "Αντίγραφο ασφαλείας"}
          </button>

          {/* Restore replaces the current data, so it is the one item in the
              menu that is styled as a risk rather than as a peer. */}
          <button
            className="file-menu-item file-menu-item-warning"
            role="menuitem"
            disabled={disabled}
            title="Αντικαθιστά τα τωρινά δεδομένα με αυτά του αντιγράφου"
            onClick={() => run(onRestore)}
          >
            {busy === "restore" ? "Επαναφορά..." : "Επαναφορή από αντιγράφου"}
          </button>
        </div>
      )}
    </div>
  );
}

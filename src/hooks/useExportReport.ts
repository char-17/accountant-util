import { useCallback, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type { MonthlyStatusWithDetails, MonthlySummary } from "../domain/types";
import { buildCsvReport, reportFileName } from "../domain/exportReport";

interface UseExportReportResult {
  exporting: boolean;
  /** Resolves to the saved path, or null when the user cancelled the dialog. */
  exportCsv: (options: {
    year: number;
    month: number;
    statuses: MonthlyStatusWithDetails[];
    summary: MonthlySummary;
    filterDescription?: string;
  }) => Promise<string | null>;
}

/**
 * Writes the monthly report through the OS save dialog, so the user chooses the
 * folder and can cancel. Returns the path for the success toast, or null when
 * the dialog was dismissed.
 */
export function useExportReport(): UseExportReportResult {
  const [exporting, setExporting] = useState(false);

  const exportCsv = useCallback<UseExportReportResult["exportCsv"]>(async (options) => {
    const defaultPath = reportFileName("csv");

    const target = await save({
      title: "Αποθήκευση αναφοράς",
      defaultPath,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    // The user dismissed the save dialog.
    if (!target) return null;

    setExporting(true);
    try {
      const csv = buildCsvReport(options);
      await writeTextFile(target, csv);
    } finally {
      setExporting(false);
    }

    return target;
  }, []);

  return { exporting, exportCsv };
}
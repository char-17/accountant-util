import { useState, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { ExcelImportPreview, ImportResult, ParsedClient, ParsedTask } from "../domain/types";
import * as clientRepo from "../persistence/clientRepo";
import * as taskRepo from "../persistence/taskRepo";
import { MUTED_PALETTE } from "../utils/colors";

interface UseExcelImportResult {
  preview: ExcelImportPreview | null;
  result: ImportResult | null;
  loading: boolean;
  error: string;
  /** Parses a chosen file into a preview without writing anything. */
  loadFile: (file: File) => Promise<void>;
  /** Writes the previewed rows. */
  runImport: () => Promise<void>;
  clear: () => void;
}

/**
 * Excel import, kept out of the component so the UI layer never touches a
 * repository directly. Parsing and writing stay separate: nothing is written
 * until the user confirms the preview.
 */
export function useExcelImport(db: Database | null, onImportComplete: () => void): UseExcelImportResult {
  const [preview, setPreview] = useState<ExcelImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadFile = useCallback(async (file: File) => {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const workbook = await parseWorkbook(data);
      setPreview(workbook);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα ανάγνωσης αρχείου");
    } finally {
      setLoading(false);
    }
  }, []);

  const runImport = useCallback(async () => {
    if (!preview || !db) return;
    setLoading(true);

    try {
      const clientData = preview.clients.map((c) => ({
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        taxId: c.taxId,
        notes: c.notes,
      }));
      const clientResult = await clientRepo.bulkInsertClients(db, clientData);

      // Each new task takes the next free palette colour so the muted colours
      // stay distinguishable, as the catalogue requires.
      const usedColors = await taskRepo.getUsedColors(db);
      const taskData = preview.tasks.map((t, idx) => {
        const availableColors = MUTED_PALETTE.filter((c) => !usedColors.includes(c));
        const color = availableColors.length > 0 ? availableColors[0] : MUTED_PALETTE[idx % MUTED_PALETTE.length];
        usedColors.push(color);
        return { name: t.name, color, description: t.description };
      });
      const taskResult = await taskRepo.bulkInsertTaskTypes(db, taskData);

      setResult({
        clientsImported: clientResult.inserted,
        tasksImported: taskResult.inserted,
        duplicatesSkipped: clientResult.skipped + taskResult.skipped,
        errors: preview.errors,
      });

      onImportComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα εισαγωγής");
    } finally {
      setLoading(false);
    }
  }, [db, preview, onImportComplete]);

  const clear = useCallback(() => {
    setPreview(null);
    setResult(null);
  }, []);

  return { preview, result, loading, error, loadFile, runImport, clear };
}

/** A row with a single filled column is a task; several means a client. */
function readRow(row: unknown[], index: number): ParsedClient | ParsedTask | null {
  const name = String((row as unknown[])[0] ?? "").trim();
  if (!name) return null;

  const cell = (i: number) => {
    const value = (row as unknown[])[i];
    return value ? String(value).trim() : undefined;
  };

  if ((row as unknown[]).length === 1 || !(row as unknown[])[1]) {
    return { row: index + 1, name };
  }
  return {
    row: index + 1,
    name,
    email: cell(1),
    phone: cell(2),
    address: cell(3),
    taxId: cell(4),
    notes: cell(5),
  };
}

async function parseWorkbook(data: Uint8Array): Promise<ExcelImportPreview> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  const clients: ParsedClient[] = [];
  const tasks: ParsedTask[] = [];
  const errors: ExcelImportPreview["errors"] = [];
  const taskNames = new Set<string>();

  // Row 0 is the header.
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const parsed = readRow(row, i);
    if (!parsed) continue;

    if ("email" in parsed) {
      clients.push(parsed);
    } else if (!taskNames.has(parsed.name)) {
      taskNames.add(parsed.name);
      tasks.push(parsed);
    }
  }

  return { clients, tasks, errors };
}
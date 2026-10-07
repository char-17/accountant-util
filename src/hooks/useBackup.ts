import { useCallback, useState } from "react";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import Database from "@tauri-apps/plugin-sql";
import {
  defaultBackupName,
  describeCounts,
  inspectBackup,
  restoreFromBackup,
  sanitizeBackupName,
  type TableCounts,
} from "../persistence/backupRepo";

interface UseBackupResult {
  /** Non-null while a backup or restore is running; disables the buttons. */
  busy: "backup" | "restore" | null;
  backup: () => Promise<string | null>;
  restore: () => Promise<TableCounts | null>;
}

/**
 * Backup and restore through the OS dialogs. A cancelled dialog resolves to
 * null so the caller can stay silent instead of reporting a failure.
 */
export function useBackup(db: Database | null, onRestored: () => void): UseBackupResult {
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);

  const backup = useCallback(async (): Promise<string | null> => {
    if (!db) return null;
    const target = await save({
      title: "Αποθήκευση αντιγράφου ασφαλείας",
      defaultPath: defaultBackupName(),
      filters: [{ name: "Βάση δεδομένων", extensions: ["db"] }],
    });
    if (!target) return null;

    setBusy("backup");
    try {
      // VACUUM INTO needs the target not to exist, and cannot create the
      // directory, so the name is normalised first.
      const safe = sanitizeBackupName(target);
      await db.execute("VACUUM INTO '" + safe.replace(/'/g, "''") + "'");
      return safe;
    } finally {
      setBusy(null);
    }
  }, [db]);

  const restore = useCallback(async (): Promise<TableCounts | null> => {
    if (!db) return null;
    const source = await open({
      title: "Επιλογή αντιγράφου για επαναφορά",
      multiple: false,
      filters: [{ name: "Βάση δεδομένων", extensions: ["db"] }],
    });
    if (!source || Array.isArray(source)) return null;
    const path = sanitizeBackupName(source);

    setBusy("restore");
    try {
      const inspection = await inspectBackup(db, path);
      if (!inspection.valid) {
        throw new Error(inspection.reason ?? "Το αρχείο δεν είναι έγκυρη βάση δεδομένων.");
      }
      const counts = inspection.counts!;

      // Replacing the data is irreversible, so ask before doing it.
      const approved = await confirm(
        `Θα αντικατασταθούν τα τωρινά δεδομένα με τα παρακάτω:\n\n` +
          `${describeCounts(counts)}\n\n` +
          `Τυχόν αλλαγές από την τελευταία αποθήκευση θα χαθούν. Συνέχεια;`,
        { title: "Επαναφορά αντιγράφου", kind: "warning", okLabel: "Επαναφορά", cancelLabel: "Άκυρο" }
      );
      if (!approved) return null;

      await restoreFromBackup(db, path);
      onRestored();
      return counts;
    } finally {
      setBusy(null);
    }
  }, [db, onRestored]);

  return { busy, backup, restore };
}
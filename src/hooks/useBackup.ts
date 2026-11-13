import { useCallback, useEffect, useState } from "react";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import type Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { toMessage } from "../utils/errors";
import { logEvent } from "../utils/logging";
import {
  defaultBackupName,
  describeCounts,
  sanitizeBackupName,
  vacuumIntoStatement,
  type TableCounts,
} from "../persistence/backupRepo";
import {
  joinBackupPath,
  prepareBackupArea,
  promoteAutoBackup,
  type BackupArea,
} from "../persistence/backupArea";

interface UseBackupResult {
  /** Non-null while a backup or restore is running; disables the buttons. */
  busy: "backup" | "restore" | null;
  /** Writes a snapshot to the manual folder and returns where it landed. */
  backup: () => Promise<string>;
  /**
   * Writes today's automatic snapshot and swaps it in over yesterday's.
   * Unlike `backup` it asks nothing: the schedule behind it runs whether or
   * not anybody is watching, and a dialog at 3 PM would be an interruption
   * dressed as a confirmation.
   */
  autoBackup: () => Promise<string>;
  /** Resolves to null when the dialog was dismissed or the user declined. */
  restore: () => Promise<TableCounts | null>;
  area: BackupArea | null;
}

const NO_DATABASE = "Η βάση δεδομένων δεν είναι ακόμη διαθέσιμη.";

/**
 * Backup and restore.
 *
 * Neither path goes through a save dialog any more. The folders belong to the
 * application: the manual one is written to by a menu item that says what it
 * will do, and the automatic one keeps a single file that today's backup
 * replaces. What each still shares with the old flow is the snapshot itself -
 * `VACUUM INTO` through the live connection, which writes a self-contained
 * copy and does not need the application closed - and with it the reason the
 * paths are assembled by the backend rather than here: the ACL gives this
 * window no read or remove permission, and the installation folder could not
 * be named in a capability before it existed.
 */
export function useBackup(db: Database | null): UseBackupResult {
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [area, setArea] = useState<BackupArea | null>(null);

  useEffect(() => {
    if (!db) return;
    void prepareBackupArea().then(setArea).catch(() => undefined);
  }, [db]);

  const backup = useCallback(async (): Promise<string> => {
    if (!db) throw new Error(NO_DATABASE);

    setBusy("backup");
    try {
      // Resolves the folder and clears a staging file left by an interrupted
      // run. Creating it is not optional: VACUUM INTO cannot make a directory,
      // so a path into a folder that is not there yet is a failure the user
      // would only learn about from a toast that does not say why.
      const area = await prepareBackupArea();
      setArea(area);
      const target = joinBackupPath(area.manualDir, defaultBackupName());
      await db.execute(vacuumIntoStatement(target));
      return target;
    } catch (err) {
      await logEvent("error", `Το χειροκίνητο αντίγραφο ασφαλείας δεν ολοκληρώθηκε: ${toMessage(err)}`);
      throw err;
    } finally {
      setBusy(null);
    }
  }, [db]);

  const autoBackup = useCallback(async (): Promise<string> => {
    if (!db) throw new Error(NO_DATABASE);

    setBusy("backup");
    try {
      const area = await prepareBackupArea();
      setArea(area);
      // Staged, not written over yesterday's file: VACUUM INTO refuses an
      // existing target, and deleting first would leave no backup at all if
      // the write then failed. The swap behind it is a single rename, so the
      // folder never holds neither file.
      await db.execute(vacuumIntoStatement(area.autoStaging));
      await promoteAutoBackup();
      return area.autoFinal;
    } catch (err) {
      await logEvent("error", `Το αυτόματο αντίγραφο ασφαλείας δεν ολοκληρώθηκε: ${toMessage(err)}`);
      throw err;
    } finally {
      setBusy(null);
    }
  }, [db]);

  const restore = useCallback(async (): Promise<TableCounts | null> => {
    if (!db) return null;

    // Point the dialog at the folder the application writes to, so restoring
    // one of its own backups does not start from wherever the dialog was last
    // opened. A failure here costs nothing - the dialog still opens - which is
    // why it is caught rather than propagated.
    let manualDir: string | undefined;
    try {
      manualDir = (await prepareBackupArea()).manualDir;
    } catch (err) {
      console.error("Δεν ήταν δυνατό να προσδιοριστεί ο φάκελος των αντιγράφων:", err);
    }

    const source = await open({
      title: "Επιλογή αντιγράφου για επαναφορά",
      multiple: false,
      filters: [{ name: "Βάση δεδομένων", extensions: ["db"] }],
      defaultPath: manualDir,
    });
    if (!source || Array.isArray(source)) return null;
    const path = sanitizeBackupName(source);

    setBusy("restore");
    try {
      const counts = await invoke<TableCounts>("inspect_backup_database", { sourcePath: path });

      // Replacing the data is irreversible, so ask before doing it.
      const approved = await confirm(
        `Θα αντικατασταθούν τα τωρινά δεδομένα με τα παρακάτω:\n\n` +
          `${describeCounts(counts)}\n\n` +
          `Τυχόν αλλαγές από την τελευταία αποθήκευση θα χαθούν. Συνέχεια;`,
        { title: "Επαναφορά αντιγράφου", kind: "warning", okLabel: "Επαναφορά", cancelLabel: "Άκυρο" }
      );
      if (!approved) return null;

      // The SQL plugin uses a connection pool. Closing it before the Rust
      // command replaces the file avoids a connection-specific ATTACH and
      // also lets the next launch run migrations against older backups.
      await db.close();
      await invoke("restore_database_file", { sourcePath: path });
      window.location.reload();
      return counts;
    } catch (err) {
      await logEvent("error", `Η επαναφορά αντιγράφου δεν ολοκληρώθηκε: ${toMessage(err)}`);
      throw err;
    } finally {
      setBusy(null);
    }
  }, [db]);

  return { busy, backup, autoBackup, restore, area };
}

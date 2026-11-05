/**
 * Where backups live, as the backend reports it.
 *
 * The frontend never assembles a path on its own. Every directory here is
 * built by `src-tauri/src/backup_fs.rs` from the running executable's own
 * location, because that path cannot be known until the installer has run and
 * therefore cannot be written into a capability, and because a path split
 * across two languages is a path that eventually disagrees with itself -
 * which is the same problem `audit-config.cjs` exists to catch for the
 * database name.
 *
 * The two commands are also the only way in: the ACL grants the frontend
 * `fs:allow-write-text-file` and nothing else, so it could not create these
 * folders, delete a file, or read one even if it knew where they were.
 */

import { invoke } from "@tauri-apps/api/core";

export interface BackupArea {
  /** Folder for snapshots the user asks for, one file per snapshot. */
  manualDir: string;
  /**
   * Where the next automatic snapshot is written, before it is renamed over
   * the previous one. The frontend writes here with `VACUUM INTO`, which
   * refuses an existing target, and then asks the backend to swap it in.
   */
  autoStaging: string;
  /** Where the automatic snapshot ends up, and the only file it keeps. */
  autoFinal: string;
  /**
   * Modification time of the current automatic backup in milliseconds since
   * the epoch, or `null` when there has never been one. Read off the file
   * itself rather than from remembered state, so it cannot drift from what is
   * actually on disk.
   */
  lastAutoMs: number | null;
}

/**
 * Creates the backup folders if they are missing, clears a staging file left
 * behind by an interrupted run, and reports the layout.
 *
 * Safe to call before anything else: every step is idempotent, and the one
 * thing it deletes is a partial file that would otherwise block every later
 * `VACUUM INTO`.
 */
export function prepareBackupArea(): Promise<BackupArea> {
  return invoke<BackupArea>("prepare_backup_area");
}

/**
 * Renames the freshly written snapshot over the previous automatic backup.
 *
 * Called only after `VACUUM INTO` has succeeded on `autoStaging`. If nothing
 * was staged this refuses rather than removing the backup that is there, which
 * is the difference between a subsystem that fails and one that destroys.
 */
export function promoteAutoBackup(): Promise<void> {
  return invoke("promote_auto_backup");
}

/**
 * Appends a file name to a directory the backend produced.
 *
 * The separator is read from the directory instead of assumed. Hard-coding
 * `\` would work on every machine this runs on today and break on the first
 * port; hard-coding `/` would hand SQLite a path the OS has to translate.
 * The path came from the runtime, so it is the only honest source for which
 * one it uses.
 */
export function joinBackupPath(dir: string, fileName: string): string {
  if (dir.endsWith("/") || dir.endsWith("\\")) return dir + fileName;
  return `${dir}${dir.includes("\\") ? "\\" : "/"}${fileName}`;
}

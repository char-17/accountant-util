/**
 * Backup and restore.
 *
 * The database runs in WAL mode, so copying the .db file while the app is open
 * would lose everything still sitting in the -wal file. `VACUUM INTO` writes a
 * single self-contained snapshot through SQLite itself, which is safe to run on
 * a live database. Restoring attaches the snapshot and copies the tables back,
 * so the app never has to be closed first.
 */

import type Database from "@tauri-apps/plugin-sql";

/**
 * Tables are restored in this order so foreign keys always point at a row that
 * already exists. `sqlite_sequence` is copied too, otherwise AUTOINCREMENT
 * restarts and new rows would collide with restored ids.
 */
const RESTORE_ORDER = [
  { table: "clients" },
  { table: "task_types" },
  { table: "client_task_assignments" },
  { table: "monthly_task_status" },
  { table: "task_reminders" },
] as const;

const SEQUENCE_TABLE = "sqlite_sequence";

export interface TableCounts {
  clients: number;
  task_types: number;
  client_task_assignments: number;
  monthly_task_status: number;
  task_reminders: number;
}

/**
 * Strips characters that break `VACUUM INTO` or Windows filenames.
 *
 * Only the file name is touched: the directory must survive intact, and the
 * colon of `C:\...` is part of the drive, not a forbidden filename character.
 * Probing showed the double quote alone makes `VACUUM INTO` fail; the rest are
 * stripped so the name also stays portable to other systems.
 */
export function sanitizeBackupName(path: string): string {
  const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  const directory = separator >= 0 ? path.slice(0, separator + 1) : "";
  const fileName = separator >= 0 ? path.slice(separator + 1) : path;

  const cleaned = fileName
    .replace(/["*:<>?|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // A name that is only forbidden characters collapses to something like
  // ".db", which is not a name anyone would recognise. Fall back instead.
  // \p{L}/\p{N} rather than \w, which is ASCII-only and would reject every
  // Greek filename.
  const hasContent = /[\p{L}\p{N}]/u.test(cleaned.replace(/\.[^.]+$/, ""));
  return directory + (hasContent ? cleaned : "backup.db");
}

/** "backup-2026-10-07.db", with the extension forced to .db. */
export function defaultBackupName(date = new Date()): string {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
  return sanitizeBackupName(`backup-${iso}.db`);
}

/** Confirms the chosen file really is an Accountant Util database. */
export async function inspectBackup(
  db: Database,
  path: string
): Promise<{ valid: boolean; reason?: string; counts?: TableCounts }> {
  const safe = sanitizeBackupName(path);
  try {
    // A snapshot must at least carry the tables the app needs.
    const rows = await db.select<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?)`,
      ["clients", "task_types", "monthly_task_status"]
    );
    if (rows.length < 3) {
      return { valid: false, reason: "Το αρχείο δεν περιέχει τους πίνακες της εφαρμογής." };
    }

    const counts = await countBackup(db, safe);
    return { valid: true, counts };
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Opens the snapshot read-only and reads its row counts, so the user can see
 * what they are about to overwrite.
 */
export async function countBackup(db: Database, path: string): Promise<TableCounts> {
  await db.execute(`ATTACH DATABASE '${escapeSqlLiteral(path)}' AS backup_candidate`);
  try {
    const rows = await db.select<TableCounts[]>(
      `SELECT
         (SELECT COUNT(*) FROM backup_candidate.clients)                    AS clients,
         (SELECT COUNT(*) FROM backup_candidate.task_types)                 AS task_types,
         (SELECT COUNT(*) FROM backup_candidate.client_task_assignments)     AS client_task_assignments,
         (SELECT COUNT(*) FROM backup_candidate.monthly_task_status)        AS monthly_task_status,
         (SELECT COUNT(*) FROM backup_candidate.task_reminders)             AS task_reminders`
    );
    return rows[0];
  } finally {
    // Always detached, even on failure, or the file stays locked.
    await db.execute("DETACH DATABASE backup_candidate");
  }
}

/**
 * Replaces the current data with the snapshot. The existing tables are kept
 * (not dropped) so the schema and its migrations stay intact.
 */
export async function restoreFromBackup(db: Database, path: string): Promise<TableCounts> {
  const safe = sanitizeBackupName(path);

  const before = await countBackup(db, safe);

  await db.execute(`ATTACH DATABASE '${escapeSqlLiteral(safe)}' AS backup_source`);
  try {
    for (const { table } of RESTORE_ORDER) {
      await db.execute(`DELETE FROM main.${table}`);
      await db.execute(`INSERT INTO main.${table} SELECT * FROM backup_source.${table}`);
    }

    // Only reset the counters if the snapshot actually carries them.
    const hasSequence = await db.select<Array<{ name: string }>>(
      `SELECT name FROM backup_source.sqlite_master WHERE type = 'table' AND name = ?`,
      [SEQUENCE_TABLE]
    );
    if (hasSequence.length > 0) {
      await db.execute(`DELETE FROM main.${SEQUENCE_TABLE}`);
      await db.execute(`INSERT INTO main.${SEQUENCE_TABLE} SELECT * FROM backup_source.${SEQUENCE_TABLE}`);
    }
  } finally {
    await db.execute("DETACH DATABASE backup_source");
  }

  return before;
}

/**
 * Escapes a value for inlining into SQL. ATTACH does not accept a bind
 * parameter through the Tauri plugin, so the path is quoted by hand.
 */
function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Human-readable one-liner for the confirmation prompt. */
export function describeCounts(counts: TableCounts): string {
  return (
    `${counts.clients} πελάτες, ` +
    `${counts.task_types} εργασίες, ` +
    `${counts.client_task_assignments} αναθέσεις, ` +
    `${counts.monthly_task_status} μηνιαίες καταστάσεις`
  );
}
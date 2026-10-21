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
 * Tables in dependency order: each one only points at tables listed before it.
 * Restored forwards and cleared backwards - see restoreFromBackup.
 *
 * `professions` leads because clients.profession_id points at it.
 * `sqlite_sequence` is copied too, otherwise AUTOINCREMENT restarts and new
 * rows would collide with restored ids.
 */
const RESTORE_ORDER = [
  { table: "professions" },
  { table: "clients" },
  { table: "task_types" },
  { table: "client_task_assignments" },
  { table: "monthly_task_status" },
] as const;

const SEQUENCE_TABLE = "sqlite_sequence";

export interface TableCounts {
  clients: number;
  professions: number;
  task_types: number;
  client_task_assignments: number;
  monthly_task_status: number;
}

/** Whether `schema` (main, or an attached name) holds `table`. */
async function hasTable(db: Database, schema: string, table: string): Promise<boolean> {
  const rows = await db.select<Array<{ name: string }>>(
    `SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`,
    [table]
  );
  return rows.length > 0;
}

/** Whether `table` in `schema` has `column`. PRAGMA takes no bind parameters. */
async function hasColumn(
  db: Database,
  schema: string,
  table: string,
  column: string
): Promise<boolean> {
  const rows = await db.select<Array<{ name: string }>>(
    `PRAGMA ${schema}.table_info(${table})`
  );
  return rows.some((r) => r.name === column);
}

/**
 * The columns both sides have, in the live table's order.
 *
 * A snapshot taken before a column was added has fewer of them, and
 * `INSERT ... SELECT *` fails on the mismatch: the live table has 7 columns and
 * the snapshot supplies 6. Naming the columns fixes that and makes the column
 * the snapshot lacks fall back to the live table's default - which for
 * clients.profession_id is NULL, i.e. unclassified.
 *
 * The names come from PRAGMA output and are quoted, since identifiers cannot be
 * bound and the values are interpolated.
 */
async function sharedColumns(
  db: Database,
  schema: string,
  table: string
): Promise<string[]> {
  const live = await db.select<Array<{ name: string }>>(
    `PRAGMA main.table_info(${table})`
  );
  const snapshot = await db.select<Array<{ name: string }>>(
    `PRAGMA ${schema}.table_info(${table})`
  );
  const inSnapshot = new Set(snapshot.map((r) => r.name));
  return live.map((r) => r.name).filter((name) => inSnapshot.has(name));
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
    // Only the four tables every snapshot is known to carry. Asking for a count
    // of a table the file does not have makes the whole query throw, which is
    // why task_reminders is not listed: a snapshot taken after that table was
    // retired does not contain it, and an older one merely carries an empty
    // shape nobody reads. The same reasoning is why professions is counted
    // separately below rather than here.
    const rows = await db.select<Omit<TableCounts, "professions">[]>(
      `SELECT
         (SELECT COUNT(*) FROM backup_candidate.clients)                    AS clients,
         (SELECT COUNT(*) FROM backup_candidate.task_types)                 AS task_types,
         (SELECT COUNT(*) FROM backup_candidate.client_task_assignments)     AS client_task_assignments,
         (SELECT COUNT(*) FROM backup_candidate.monthly_task_status)        AS monthly_task_status`
    );
    // Counted separately: a snapshot taken before professions existed has no
    // such table, and asking for its count in the query above would make the
    // whole count throw - which would turn every older backup into "not an
    // Accountant Util database".
    const professions = (await hasTable(db, "backup_candidate", "professions"))
      ? await db.select<Array<{ c: number }>>(
          "SELECT COUNT(*) as c FROM backup_candidate.professions"
        ).then((r) => r[0]?.c ?? 0)
      : 0;
    return { ...rows[0], professions };
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
    // A table is restored only when both ends hold it. The live database always
    // has the migrations, but a snapshot may predate one - professions are the
    // first such table - and then the user asked to go back to a state without
    // it, so the rows here are emptied rather than read from a table that is not
    // there.
    // Deleting and inserting want opposite orders, and the difference is not
    // cosmetic. Insertion needs a referenced row in place before the row that
    // points at it. Deletion needs the reverse: emptying professions while
    // clients still carry their id trips the foreign key - there is no
    // ON DELETE clause on that column, unlike the assignments' cascade onto
    // clients. Hence clearOrder below, which is RESTORE_ORDER backwards.
    const restorable: string[] = [];
    const emptied: string[] = [];
    for (const { table } of RESTORE_ORDER) {
      const inMain = await hasTable(db, "main", table);
      const inSnapshot = await hasTable(db, "backup_source", table);
      if (inMain && inSnapshot) restorable.push(table);
      else if (inMain) emptied.push(table);
    }

    // Derived from RESTORE_ORDER rather than from the two buckets above:
    // reversing a concatenation would move whichever table happened to be
    // optional to the front of the delete, which is the opposite of what the
    // reversing is for.
    const clearOrder = RESTORE_ORDER.map(({ table }) => table)
      .filter((table) => restorable.includes(table) || emptied.includes(table))
      .reverse();

    for (const table of clearOrder) {
      await db.execute(`DELETE FROM main.${table}`);
    }
    for (const table of restorable) {
      const columns = await sharedColumns(db, "backup_source", table);
      // Nothing in common would mean the snapshot has a table of the same name
      // and no matching columns. Skipping leaves the live table empty, which is
      // the honest reading: there is nothing to restore from.
      if (columns.length === 0) continue;
      const list = columns.map((c) => `"${c}"`).join(", ");
      await db.execute(
        `INSERT INTO main.${table} (${list}) SELECT ${list} FROM backup_source.${table}`
      );
    }

    // With no professions restored, the restored clients' profession_id values
    // would point at rows that no longer exist. Cleared rather than left to the
    // filter to match nothing: the worklist joins on it with LEFT, so a stale id
    // would quietly put those clients outside every profession filter.
    if (emptied.includes("professions")) {
      if (await hasColumn(db, "main", "clients", "profession_id")) {
        await db.execute("UPDATE main.clients SET profession_id = NULL");
      }
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
  const base =
    `${counts.clients} πελάτες, ` +
    `${counts.task_types} εργασίες, ` +
    `${counts.client_task_assignments} αναθέσεις, ` +
    `${counts.monthly_task_status} μηνιαίες καταστάσεις`;
  // Left out when zero: a snapshot from before professions existed counts none,
  // and announcing "0 επαγγέλματα" would imply the list was emptied rather than
  // that the feature postdates the file.
  return counts.professions > 0 ? `${base}, ${counts.professions} επαγγέλματα` : base;
}
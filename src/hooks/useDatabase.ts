import { useState, useEffect } from "react";
import Database from "@tauri-apps/plugin-sql";
import { migrateLegacyDatabase, DB_FILE_NAME } from "../domain/dbLocation";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tax_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS task_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#8B9DAD',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS client_task_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    task_type_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE,
    UNIQUE(client_id, task_type_id, is_active)
  )`,
  `CREATE TABLE IF NOT EXISTS monthly_task_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    task_type_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK(month >= 1 AND month <= 12),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
    completed_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE,
    UNIQUE(client_id, task_type_id, year, month)
  )`,

  // --- Periodicity / deadlines -------------------------------------------
  // Additive migrations. Each runs once; running it again is a no-op because
  // the column already exists, so this is safe on every launch.
  `ALTER TABLE client_task_assignments ADD COLUMN periodicity TEXT NOT NULL DEFAULT 'monthly'`,
  `ALTER TABLE client_task_assignments ADD COLUMN due_day INTEGER NOT NULL DEFAULT 28`,
  `ALTER TABLE client_task_assignments ADD COLUMN reminder_days INTEGER NOT NULL DEFAULT 5`,

  // Effective reminder date per assignment+period, so a reminder fires at a
  // fixed point in time rather than drifting when the user changes settings.
  `CREATE TABLE IF NOT EXISTS task_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    remind_on TEXT NOT NULL,
    due_on TEXT NOT NULL,
    is_dismissed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (assignment_id) REFERENCES client_task_assignments(id) ON DELETE CASCADE,
    UNIQUE(assignment_id, year, month)
  )`,

  // --- Money: fee, collection and invoicing, per client+task+month --------
  // Nullable amount: a month's row is seeded before anyone types anything, so a
  // NOT NULL column would demand a value for work that has not been priced.
  `ALTER TABLE monthly_task_status ADD COLUMN amount REAL`,
  `ALTER TABLE monthly_task_status ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE monthly_task_status ADD COLUMN paid_at TEXT`,
  `ALTER TABLE monthly_task_status ADD COLUMN is_invoiced INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE monthly_task_status ADD COLUMN invoiced_at TEXT`,
];

/**
 * Columns removed from the clients table.
 *
 * The CREATE TABLE above only describes a database being built for the first
 * time; on an existing one it is a no-op, so these have to be dropped
 * explicitly or every launch would keep carrying three unused columns.
 *
 * The order matters: a column is only dropped once nothing selects it, so this
 * runs after the repository queries have been cut down.
 */
const DROPPED_CLIENT_COLUMNS = ["email", "phone", "address"] as const;

/** True when the clients table has the named column. */
async function hasColumn(database: Database, column: string): Promise<boolean> {
  const rows = await database.select<{ name: string }[]>(
    "PRAGMA table_info(clients)"
  );
  return rows.some((r) => r.name === column);
}

/**
 * Drops the retired columns, one at a time and only where they exist.
 *
 * A missing column is not an error here: a database created after the change
 * never had them, and that is the common case, not a failure. A genuine
 * failure to drop is reported rather than swallowed - it is harmless (the
 * columns are simply unused) but the user should know the database still holds
 * whatever was in them.
 */
async function dropRetiredClientColumns(
  database: Database
): Promise<string | null> {
  const failed: string[] = [];
  for (const column of DROPPED_CLIENT_COLUMNS) {
    if (!(await hasColumn(database, column))) continue;
    try {
      await database.execute(`ALTER TABLE clients DROP COLUMN ${column}`);
    } catch {
      failed.push(column);
    }
  }
  if (failed.length > 0) {
    return `Δεν ήταν δυνατή η αφαίρεση των στηλών ${failed.join(", ")} από τους πελάτες. Δεν επηρεάζει τη χρήση της εφαρμογής.`;
  }
  return null;
}

/**
 * Applies migrations, tolerating "duplicate column"/"already exists" so an
 * existing database upgrades in place instead of erroring on every launch.
 */
async function applyMigrations(database: Database): Promise<string | null> {
  for (const migration of MIGRATIONS) {
    try {
      await database.execute(migration);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const alreadyApplied =
        message.includes("duplicate column name") ||
        message.includes("already exists");
      if (!alreadyApplied) throw err;
    }
  }
  return dropRetiredClientColumns(database);
}

export function useDatabase() {
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A database found at the old location that could not be carried over would
  // otherwise leave the user looking at a silently empty application.
  const [migrationWarning, setMigrationWarning] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const result = await migrateLegacyDatabase();
        if (result.migrated) {
          console.info("Η βάση δεδομένων μεταφέρθηκε από την παλιά θέση.");
        }
        if (result.warning) {
          setMigrationWarning(result.warning);
        }

        const database = await Database.load(`sqlite:${DB_FILE_NAME}`);
        const columnWarning = await applyMigrations(database);
        if (columnWarning) {
          setMigrationWarning(columnWarning);
        }
        setDb(database);
      } catch (err) {
        // Show the underlying reason (e.g. checksum mismatch, missing permission)
        // instead of a generic message that hides the cause.
        const reason = err instanceof Error ? err.message : String(err);
        console.error("Database init error:", reason);
        setError(reason);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  return { db, loading, error, migrationWarning };
}

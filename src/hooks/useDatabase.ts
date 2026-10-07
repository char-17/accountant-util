import { useState, useEffect } from "react";
import Database from "@tauri-apps/plugin-sql";
import { migrateLegacyDatabase, DB_FILE_NAME } from "../domain/dbLocation";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
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
];

/**
 * Applies migrations, tolerating "duplicate column"/"already exists" so an
 * existing database upgrades in place instead of erroring on every launch.
 */
async function applyMigrations(database: Database) {
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
        await applyMigrations(database);
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

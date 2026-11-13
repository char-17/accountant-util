use std::fs;
use std::path::Path;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Executor, Row};
use tauri::Manager;

/// The database file name, matching DB_FILE_NAME in src/domain/dbLocation.ts.
const DB_FILE_NAME: &str = "accountant.db";

/// The bundle identifier used before the rename, so the old data is found.
const LEGACY_DIRECTORY: &str = "com.ariston.tauri-app";
const SCHEMA_VERSION: i64 = 1;

#[derive(serde::Serialize)]
pub struct MigrationResult {
    pub migrated: bool,
    /// Set when an older database exists but could not be moved.
    pub warning: Option<String>,
    pub legacy_location: Option<String>,
}

fn nothing_to_do() -> MigrationResult {
    MigrationResult { migrated: false, warning: None, legacy_location: None }
}

async fn migrate_database_file(path: &Path) -> Result<Option<String>, String> {
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|err| format!("Δεν ήταν δυνατή η σύνδεση με τη βάση: {err}"))?;

    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .map_err(|err| format!("Δεν ήταν δυνατή η ενεργοποίηση των foreign keys: {err}"))?;
    let version = sqlx::query("PRAGMA user_version")
        .fetch_one(&pool)
        .await
        .map_err(|err| format!("Δεν ήταν δυνατή η ανάγνωση της έκδοσης της βάσης: {err}"))?
        .get::<i64, _>("user_version");

    if version >= SCHEMA_VERSION {
        pool.close().await;
        return Ok(None);
    }

    // A self-contained snapshot is taken before any schema change. If a
    // migration fails, the transaction rolls back; the snapshot also remains
    // available for manual recovery if the process is interrupted.
    let snapshot = path.with_file_name(format!(
        "accountant.db.pre-migration-{}.db",
        chrono::Utc::now().timestamp_millis()
    ));
    let snapshot_sql = format!(
        "VACUUM INTO '{}'",
        snapshot.to_string_lossy().replace('\'', "''")
    );
    sqlx::query(&snapshot_sql)
        .execute(&pool)
        .await
        .map_err(|err| format!("Δεν δημιουργήθηκε το αντίγραφο πριν τη migration: {err}"))?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|err| format!("Δεν ξεκίνησε η ασφαλής migration: {err}"))?;
    let migrations = [
        "CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tax_id TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
        "CREATE TABLE IF NOT EXISTS task_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, color TEXT NOT NULL DEFAULT '#8B9DAD', is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
        "CREATE TABLE IF NOT EXISTS client_task_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, task_type_id INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, start_date TEXT NOT NULL, end_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE, FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE, UNIQUE(client_id, task_type_id, is_active))",
        "CREATE TABLE IF NOT EXISTS monthly_task_status (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, task_type_id INTEGER NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL CHECK(month >= 1 AND month <= 12), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')), completed_at TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE, FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE, UNIQUE(client_id, task_type_id, year, month))",
        "ALTER TABLE client_task_assignments ADD COLUMN periodicity TEXT NOT NULL DEFAULT 'monthly'",
        "ALTER TABLE client_task_assignments ADD COLUMN due_day INTEGER NOT NULL DEFAULT 28",
        "ALTER TABLE client_task_assignments ADD COLUMN reminder_days INTEGER NOT NULL DEFAULT 5",
        "DROP TABLE IF EXISTS task_reminders",
        "ALTER TABLE monthly_task_status ADD COLUMN amount REAL",
        "ALTER TABLE monthly_task_status ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE monthly_task_status ADD COLUMN paid_at TEXT",
        "ALTER TABLE monthly_task_status ADD COLUMN is_invoiced INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE monthly_task_status ADD COLUMN invoiced_at TEXT",
        "CREATE TABLE IF NOT EXISTS professions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, color TEXT NOT NULL DEFAULT '#8B9DAD', is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
        "ALTER TABLE professions ADD COLUMN color TEXT NOT NULL DEFAULT '#8B9DAD'",
        "ALTER TABLE clients ADD COLUMN profession_id INTEGER REFERENCES professions(id)",
    ];

    for migration in migrations {
        if let Err(err) = tx.execute(sqlx::query(migration)).await {
            let message = err.to_string();
            let already_applied = message.contains("duplicate column name") || message.contains("already exists");
            if !already_applied {
                return Err(format!("Η migration απέτυχε και έγινε rollback: {message}"));
            }
        }
    }

    let mut failed_drops = Vec::new();
    for column in ["email", "phone", "address"] {
        let rows = sqlx::query("PRAGMA table_info(clients)")
            .fetch_all(&mut *tx)
            .await
            .map_err(|err| format!("Δεν ήταν δυνατός ο έλεγχος της στήλης {column}: {err}"))?;
        let exists = rows.iter().any(|row| row.get::<String, _>("name") == column);
        if !exists { continue; }
        if let Err(err) = tx.execute(sqlx::query(&format!("ALTER TABLE clients DROP COLUMN {column}"))).await {
            failed_drops.push(column);
            let _ = err;
        }
    }

    tx.execute(sqlx::query(&format!("PRAGMA user_version = {SCHEMA_VERSION}")))
        .await
        .map_err(|err| format!("Δεν γράφτηκε η έκδοση της βάσης: {err}"))?;
    tx.commit()
        .await
        .map_err(|err| format!("Δεν ολοκληρώθηκε η migration: {err}"))?;
    pool.close().await;

    Ok((!failed_drops.is_empty()).then(|| format!(
        "Δεν ήταν δυνατή η αφαίρεση των παλιών στηλών: {}. Η βάση παραμένει έγκυρη.",
        failed_drops.join(", ")
    )))
}

/// Runs schema changes in one SQLite transaction and snapshots the database
/// before changing it. The frontend only opens the database after this returns.
#[tauri::command]
pub async fn migrate_database(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let app_dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Δεν ήταν δυνατός ο εντοπισμός της βάσης: {err}"))?;
    fs::create_dir_all(&app_dir)
        .map_err(|err| format!("Δεν ήταν δυνατή η δημιουργία του φακέλου βάσης: {err}"))?;
    migrate_database_file(&app_dir.join(DB_FILE_NAME)).await
}

/// Moves the database from the previous identifier's directory into the current
/// app data directory.
///
/// Renaming the bundle identifier changes the data directory, which would
/// otherwise leave the user with an empty application after upgrading. Nothing
/// is overwritten: if a database already exists in the new location the old one
/// is left untouched, so repeated launches cannot destroy data.
///
/// This runs in Rust because the frontend has no permission to read the app
/// data directory, and a silent failure there is very hard to notice.
///
/// SQLite in WAL mode keeps committed pages in a `-wal` file beside the
/// database, so that file is moved too; leaving it behind would lose the most
/// recent writes.
#[tauri::command]
pub fn migrate_legacy_database(app: tauri::AppHandle) -> MigrationResult {
    let current_dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(err) => {
            return MigrationResult {
                migrated: false,
                warning: Some(format!(
                    "Δεν ήταν δυνατός ο έλεγχος της παλιάς βάσης δεδομένων: {err}"
                )),
                legacy_location: None,
            }
        }
    };

    let current_file = current_dir.join(DB_FILE_NAME);
    if current_file.exists() {
        return nothing_to_do();
    }

    let legacy_dir = match current_dir.parent() {
        Some(parent) => parent.join(LEGACY_DIRECTORY),
        None => return nothing_to_do(),
    };
    let legacy_file = legacy_dir.join(DB_FILE_NAME);

    if !legacy_file.exists() {
        return nothing_to_do();
    }

    let legacy_path = legacy_file.to_string_lossy().to_string();

    if let Err(err) = fs::create_dir_all(&current_dir) {
        return MigrationResult {
            migrated: false,
            warning: Some(format!(
                "Δεν ήταν δυνατή η δημιουργία του φακέλου της εφαρμογής: {err}"
            )),
            legacy_location: Some(legacy_path),
        };
    }

    if let Err(err) = fs::rename(&legacy_file, &current_file) {
        return MigrationResult {
            migrated: false,
            // The old file is untouched, so nothing is lost; the user is told
            // where it is instead of seeing a silently empty application.
            warning: Some(format!(
                "Βρέθηκε παλιότερη βάση δεδομένων στο \"{legacy_path}\", αλλά δεν ήταν \
                 δυνατή η μεταφορά της. Αιτία: {err}"
            )),
            legacy_location: Some(legacy_path),
        };
    }

    // The -wal holds committed pages that have not been written back yet.
    let legacy_wal = legacy_dir.join(format!("{DB_FILE_NAME}-wal"));
    if legacy_wal.exists() {
        let current_wal = current_dir.join(format!("{DB_FILE_NAME}-wal"));
        if let Err(err) = fs::rename(&legacy_wal, &current_wal) {
            return MigrationResult {
                migrated: true,
                warning: Some(format!(
                    "Το αρχείο WAL δεν μεταφέρθηκε, οπότε ενδέχεται να λείπουν οι \
                     πιο πρόσφατες αλλαγές: {err}"
                )),
                legacy_location: Some(legacy_wal.to_string_lossy().to_string()),
            };
        }
    }

    MigrationResult { migrated: true, warning: None, legacy_location: None }
}

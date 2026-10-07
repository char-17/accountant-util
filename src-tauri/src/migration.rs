use std::fs;
use tauri::Manager;

/// The database file name, matching DB_FILE_NAME in src/domain/dbLocation.ts.
const DB_FILE_NAME: &str = "accountant.db";

/// The bundle identifier used before the rename, so the old data is found.
const LEGACY_DIRECTORY: &str = "com.ariston.tauri-app";

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
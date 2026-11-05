//! The filesystem side of backups: where they live, and the handful of things
//! SQLite cannot do for itself.
//!
//! `VACUUM INTO` writes the snapshot through the SQL plugin. What it cannot do
//! is create the folder it is about to write into, replace a file that is
//! already there, or report how old the last automatic backup is. The frontend
//! cannot do those either: the ACL grants it `fs:allow-write-text-file` and
//! nothing else, and the installation folder could not be named in a
//! capability regardless - its path does not exist until the installer has
//! run, and a scope written before that cannot name it.
//!
//! So the folder sits behind two commands, and the frontend never builds a
//! path itself. That is what `BackupArea` is for: if the TypeScript side were
//! assembling `backups/manual/...` out of its own constants, the two languages
//! would have to agree forever, and `audit-config.cjs` exists precisely because
//! they do not agree forever.
//!
//! The two commands are thin on purpose. They resolve the real installation
//! directory and hand the paths to `prepare` and `promote`, which do the work
//! and take their directories as arguments - so the behaviour under test is the
//! behaviour that ships, and the tests never touch an installation.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The folder, inside the installation directory, that holds every backup.
///
/// It sits beside the executable rather than in the app data directory because
/// that is where the accountant asked for it: one place, visible, copyable,
/// next to the program.
///
/// The reason this is safe is not an assumption. `tauri build` writes the
/// generated installer to `target/release/nsis/x64/installer.nsi`, and its
/// upgrade section removes only the previous main binary, and only when the
/// binary was renamed. The uninstaller ends with `RMDir "$INSTDIR"` - without
/// `/r`, so it only succeeds on an empty folder. Nothing in the installer ever
/// clears this directory, which is what lets a backup outlive an update.
const BACKUP_ROOT: &str = "backups";

/// Manual snapshots accumulate; the automatic one does not.
///
/// They are kept apart because they follow opposite rules. The manual folder
/// holds every snapshot the user ever asked for, each under its own
/// timestamped name. The automatic folder holds exactly one file, which each
/// day's backup replaces.
const MANUAL_DIR: &str = "manual";
const AUTO_DIR: &str = "auto";

/// Where a new automatic snapshot is written before it becomes *the* backup.
///
/// `VACUUM INTO` refuses to write onto an existing file, so the daily backup
/// cannot be written straight to its final name while yesterday's copy is
/// still there. Deleting first would be worse: if the write then failed there
/// would be no backup at all, which is the one outcome this subsystem exists
/// to prevent. Writing a separate file and renaming it keeps a complete
/// backup on disk at every instant.
const AUTO_STAGING: &str = "staging.db";

/// The single file the automatic folder keeps.
const AUTO_FINAL: &str = "backup.db";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupArea {
    /// Folder for snapshots the user asks for. The caller appends its own
    /// timestamped file name - the timestamp is made in the frontend, where
    /// the user's clock and locale already are.
    pub manual_dir: String,
    /// Where the next automatic snapshot is written, before it is renamed in.
    pub auto_staging: String,
    /// Where the automatic snapshot ends up, and the only file it keeps.
    pub auto_final: String,
    /// Modification time of the current automatic backup, in milliseconds
    /// since the epoch. `None` when there has never been one. This is what
    /// decides whether today's 3 PM backup is overdue.
    pub last_auto_ms: Option<i64>,
}

fn as_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// Modification time as milliseconds since the epoch, or `None` when the file
/// is not there or the clock read is refused.
fn modified_ms(path: &Path) -> Option<i64> {
    let since_epoch =
        fs::metadata(path).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(since_epoch.as_millis() as i64)
}

/// The directory the running executable sits in.
///
/// `current_exe` rather than the resource directory: this has to be `$INSTDIR`
/// exactly, because that is the folder the installer leaves alone. On a normal
/// install that is `%LOCALAPPDATA%\Programs\Accountant Util\`; in development
/// it is `target\debug\`, inside the repository's ignored tree and harmless.
fn install_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|err| format!("Δεν ήταν δυνατή η εύρεση του εκτελέσιμου: {err}"))?;
    exe.parent().map(Path::to_path_buf).ok_or_else(|| {
        "Δεν ήταν δυνατό να προσδιοριστεί ο φάκελος εγκατάστασης του προγράμματος.".to_string()
    })
}

fn backup_dir(kind: &str) -> Result<PathBuf, String> {
    Ok(install_dir()?.join(BACKUP_ROOT).join(kind))
}

/// Makes the backup area usable and reports where everything lives.
///
/// Three jobs, because the caller needs all three before it can write anything
/// and each is useless without the others:
///
///  1. **Create the folders.** `VACUUM INTO` cannot make a directory, so a
///     path to a folder that does not exist is a backup that silently fails.
///
///  2. **Clear a staging file left behind by an interrupted run.** A crash
///     during `VACUUM INTO` leaves a partial file that would make every later
///     attempt fail, because `VACUUM INTO` will not write onto an existing
///     file. Deleting it is safe by construction: the final file is never
///     touched by a write, so whatever `staging.db` holds, `backup.db` still
///     holds yesterday's complete snapshot. On the very first run there is no
///     yesterday, and the next scheduled attempt replaces what was lost.
///
///  3. **Read the age of the current automatic backup**, which is what the
///     daily schedule compares against today's 3 PM.
///
/// Called once before any backup and once at startup for the schedule, so it
/// has to be idempotent - and it is: every step either creates something that
/// is already there or removes something that should not be.
fn prepare(manual: &Path, auto: &Path) -> Result<BackupArea, String> {
    fs::create_dir_all(manual)
        .map_err(|err| format!("Δεν ήταν δυνατή η δημιουργία του φακέλου αντιγράφων: {err}"))?;
    fs::create_dir_all(auto)
        .map_err(|err| format!("Δεν ήταν δυνατή η δημιουργία του φακέλου αυτόματων: {err}"))?;

    let staging = auto.join(AUTO_STAGING);
    let final_path = auto.join(AUTO_FINAL);
    if staging.exists() {
        // Leftover from a run that did not finish. Dropping it never costs the
        // real backup, which is the file this never writes to.
        fs::remove_file(&staging)
            .map_err(|err| format!("Δεν ήταν δυνατή η καθαριστική του προσωρινού αρχείου: {err}"))?;
    }

    Ok(BackupArea {
        manual_dir: as_string(manual),
        auto_staging: as_string(&staging),
        auto_final: as_string(&final_path),
        last_auto_ms: modified_ms(&final_path),
    })
}

/// Replaces this automatic backup with the snapshot just written to staging.
///
/// The rename is the whole operation. Both files are in the same directory, so
/// they swap without a moment where neither exists - on Windows through
/// `MoveFileEx` with the replace flag, on POSIX through `rename`, and both
/// hold for the duration of the call. There is deliberately no delete-then-
/// write anywhere: that sequence has a window with no backup in it, which is
/// the one outcome this subsystem exists to prevent.
///
/// If the rename fails, nothing has happened: staging keeps the new snapshot
/// and `backup.db` keeps yesterday's, so no data is lost either way, and the
/// next run's `prepare` clears staging for a fresh attempt.
fn promote(staging: &Path, final_path: &Path) -> Result<(), String> {
    if !staging.exists() {
        return Err(format!(
            "Το προσωρινό αντίγραφο \"{}\" δεν βρέθηκε, οπότε δεν υπάρχει τίποτε να αντικατασταθεί.",
            as_string(staging)
        ));
    }

    fs::rename(staging, final_path).map_err(|err| {
        format!(
            "Δεν ήταν δυνατή η τοποθέτηση του νέου αντιγράφου στο \"{}\": {err}",
            as_string(final_path)
        )
    })
}

#[tauri::command]
pub fn prepare_backup_area() -> Result<BackupArea, String> {
    prepare(&backup_dir(MANUAL_DIR)?, &backup_dir(AUTO_DIR)?)
}

#[tauri::command]
pub fn promote_auto_backup() -> Result<(), String> {
    let auto = backup_dir(AUTO_DIR)?;
    promote(&auto.join(AUTO_STAGING), &auto.join(AUTO_FINAL))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    /// A scratch directory per test, cleared first so a leftover from an
    /// earlier run cannot satisfy an assertion by accident.
    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("au-backup-fs-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn now_ms() -> i64 {
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO).as_millis() as i64
    }

    #[test]
    fn prepare_creates_both_folders_when_they_are_not_there() {
        let root = scratch("create");
        let manual = root.join("backups").join("manual");
        let auto = root.join("backups").join("auto");

        let area = prepare(&manual, &auto).expect("folders should be created");

        assert!(manual.is_dir(), "manual folder created");
        assert!(auto.is_dir(), "auto folder created");
        assert_eq!(area.manual_dir, as_string(&manual));
        assert_eq!(area.auto_staging, as_string(&auto.join(AUTO_STAGING)));
        assert_eq!(area.auto_final, as_string(&auto.join(AUTO_FINAL)));
        assert_eq!(area.last_auto_ms, None, "a fresh area has no history");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn prepare_is_idempotent() {
        // Called before every backup and again at startup for the schedule.
        let root = scratch("idempotent");
        let manual = root.join("manual");
        let auto = root.join("auto");

        prepare(&manual, &auto).unwrap();
        fs::write(auto.join(AUTO_FINAL), "yesterday").unwrap();
        let second = prepare(&manual, &auto).unwrap();

        assert!(second.last_auto_ms.is_some(), "the existing backup is reported");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_staging_file_from_a_crash_is_cleared_and_the_real_backup_survives() {
        // A partial staging file would make every later VACUUM INTO fail,
        // because the target already exists. Clearing it must not cost the
        // snapshot that is already in place.
        let root = scratch("stale");
        let manual = root.join("manual");
        let auto = root.join("auto");
        fs::create_dir_all(&auto).unwrap();
        fs::write(auto.join(AUTO_FINAL), "yesterday").unwrap();
        fs::write(auto.join(AUTO_STAGING), "half-written").unwrap();

        prepare(&manual, &auto).expect("stale staging should be removable");

        assert!(!auto.join(AUTO_STAGING).exists(), "staging cleared");
        assert_eq!(
            fs::read_to_string(auto.join(AUTO_FINAL)).unwrap(),
            "yesterday",
            "the real backup must be untouched"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn promote_replaces_the_previous_backup_in_one_step() {
        let root = scratch("promote");
        let auto = root.join("auto");
        fs::create_dir_all(&auto).unwrap();
        let staging = auto.join(AUTO_STAGING);
        let final_path = auto.join(AUTO_FINAL);
        fs::write(&final_path, "yesterday").unwrap();
        fs::write(&staging, "today").unwrap();

        promote(&staging, &final_path).expect("the rename should land");

        assert_eq!(fs::read_to_string(&final_path).unwrap(), "today");
        assert!(!staging.exists(), "staging is consumed by the rename");
        let age = modified_ms(&final_path).expect("the promoted file still reports its age");
        assert!(age > 0 && age <= now_ms(), "the new file is dated, not from the future: {age}");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn promote_without_a_staged_snapshot_refuses_rather_than_deleting() {
        // The dangerous case: nothing was written, so nothing may be removed.
        // Replacing the existing backup with an absent file is how a backup
        // subsystem ends up destroying the data it was built to protect.
        let root = scratch("refuse");
        let auto = root.join("auto");
        fs::create_dir_all(&auto).unwrap();
        let final_path = auto.join(AUTO_FINAL);
        fs::write(&final_path, "yesterday").unwrap();

        let result = promote(&auto.join(AUTO_STAGING), &final_path);

        assert!(result.is_err(), "must refuse without staging");
        assert_eq!(
            fs::read_to_string(&final_path).unwrap(),
            "yesterday",
            "the existing backup must be intact"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_backup_age_is_read_from_the_file_itself() {
        let root = scratch("age");
        let final_path = root.join(AUTO_FINAL);

        assert_eq!(modified_ms(&final_path), None, "no file, no age");

        fs::write(&final_path, "snapshot").unwrap();
        let age = modified_ms(&final_path).expect("a file that exists has an age");
        assert!(age > 0, "got {age}");
        assert!(age <= now_ms(), "the age must not be in the future: {age}");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_commands_resolve_the_real_installation_directory() {
        // The other tests hand `prepare` and `promote` paths they chose, so
        // nothing there checks the thing that makes these commands rather than
        // constants in TypeScript: `install_dir` has to land beside the
        // executable, because that is the folder the installer leaves alone.
        //
        // Called through the commands themselves, the folder ends up beside
        // the *test* binary instead of a real installation, and is removed
        // again afterwards - so the assertion covers the resolution the
        // shipped app depends on while touching nothing that matters here.
        let area = prepare_backup_area().expect("the backup area should resolve");

        let exe = std::env::current_exe().expect("a running test has an executable");
        let expected_root = exe.parent().expect("an executable has a directory").join(BACKUP_ROOT);

        assert!(
            Path::new(&area.manual_dir).starts_with(&expected_root),
            "manual dir should be under {:?}, got {}",
            expected_root,
            area.manual_dir
        );
        assert!(Path::new(&area.manual_dir).is_dir(), "manual folder created");
        assert!(Path::new(&area.auto_staging).parent().unwrap().is_dir(), "auto folder created");
        assert_eq!(area.last_auto_ms, None, "nothing backed up yet");

        // And the swap works end to end: write staging as `VACUUM INTO` would,
        // promote, and find the snapshot where the schedule reads its age.
        fs::write(&area.auto_staging, "snapshot").unwrap();
        promote_auto_backup().expect("a staged snapshot should promote");
        assert_eq!(fs::read_to_string(&area.auto_final).unwrap(), "snapshot");
        assert!(!Path::new(&area.auto_staging).exists(), "staging consumed");
        assert!(
            prepare_backup_area().unwrap().last_auto_ms.is_some(),
            "the promoted file is what the schedule sees as the last backup"
        );

        // Left behind otherwise: this is target/, not a user's installation,
        // and the next run would inherit a folder with a backup already in it.
        let _ = fs::remove_dir_all(&expected_root);
    }

    #[test]
    fn the_area_serialises_under_the_names_the_frontend_reads() {
        // The TypeScript interface in src/persistence/backupArea.ts declares
        // manualDir, autoStaging, autoFinal and lastAutoMs. Tauri ships the
        // command's return value through serde, so a field name that disagrees
        // here reaches JavaScript as `undefined` - and the first backup writes
        // to a path of "undefined", in an installed build only, because
        // neither the type checker nor any test in src/ crosses that boundary.
        //
        // This is the same failure the `legacy_location` / `legacyLocation`
        // pairing across migration.rs and dbLocation.ts would have been if the
        // two had drifted: one name in Rust, another in TypeScript, and only a
        // running application to notice.
        let root = scratch("serialised");
        let area = prepare(&root.join("manual"), &root.join("auto")).unwrap();

        let value = serde_json::to_value(&area).unwrap();
        let object = value.as_object().expect("the area serialises as an object");
        let keys: Vec<&str> = object.keys().map(String::as_str).collect();

        for expected in ["manualDir", "autoStaging", "autoFinal", "lastAutoMs"] {
            assert!(keys.contains(&expected), "missing {expected}; got {keys:?}");
        }
        assert_eq!(
            value["lastAutoMs"], serde_json::Value::Null,
            "an area that has never backed up reports no age, not zero"
        );

        // And with a backup present the age arrives as a number, which is the
        // shape `planAutoBackup` compares against a timestamp.
        fs::write(root.join("auto").join(AUTO_FINAL), "snapshot").unwrap();
        let area = prepare(&root.join("manual"), &root.join("auto")).unwrap();
        let value = serde_json::to_value(&area).unwrap();
        assert!(value["lastAutoMs"].as_i64().unwrap_or(0) > 0, "got {value}");

        let _ = fs::remove_dir_all(&root);
    }
}

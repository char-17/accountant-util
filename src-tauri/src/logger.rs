//! The log file: what went wrong, on whose machine, and when.
//!
//! The purpose is a support conversation about a computer nobody here can
//! open. Everything else follows from that:
//!
//!  - **Beside the executable, in `logs/`** - next to the backups, one folder
//!    the accountant can find and copy. The installer does not clear it (the
//!    same answer as the backups, verified in item 9), so a log survives an
//!    update, which is exactly when it is worth reading.
//!
//!  - **One file per day, fourteen days kept.** A single file grows without
//!    limit on a machine nobody checks, which is the failure rotation exists
//!    to prevent. Fourteen days covers "it happened last week" and stays a few
//!    hundred kilobytes at most.
//!
//!  - **One writer: Rust.** The frontend cannot reach this folder - the ACL
//!    grants `fs:allow-write-text-file` and nothing that could name the
//!    installation directory, whose path does not even exist before the
//!    installer has run - and a writer in JavaScript would be silent in
//!    precisely the case the log exists for: the webview failing to start.
//!    The frontend hands its lines over through `log_event`; Rust appends them.
//!
//!  - **No client names, ever.** The file gets sent to whoever is helping, so
//!    what goes in it is events and reasons, never data. Nothing in this
//!    module formats a client, a month, or an amount, and the callers are
//!    written the same way.
//!
//! A failure to write is never fatal. `record` returns nothing at all, and the
//! command reports an error the frontend is written to ignore: a log line is
//! diagnostics, and diagnostics must not be able to stop the program they were
//! meant to describe.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Local, NaiveDate};

use crate::paths::install_dir;

/// The folder, inside the installation directory, that holds the logs.
const LOG_ROOT: &str = "logs";

/// Days a daily file is kept: today plus thirteen earlier ones.
const KEEP_DAYS: i64 = 14;

/// Longest message kept, in characters. An unbounded line - a path repeated by
/// a loop, an error that quotes a whole statement - would defeat the point of
/// rotating by day.
const MAX_MESSAGE: usize = 2000;

fn log_dir() -> Result<PathBuf, String> {
    Ok(install_dir()?.join(LOG_ROOT))
}

/// The file one event belongs to: `log-2026-11-05.txt`.
fn file_name(at: DateTime<Local>) -> String {
    format!("log-{}.txt", at.format("%Y-%m-%d"))
}

/// The date a file name carries - and only for names this module writes.
///
/// Everything else in the folder belongs to somebody else, so an unrecognised
/// name is never a candidate for deletion. This is what keeps `prune` from
/// becoming the thing that deletes a file it did not create.
fn date_in(name: &str) -> Option<NaiveDate> {
    let rest = name.strip_prefix("log-")?.strip_suffix(".txt")?;
    NaiveDate::parse_from_str(rest, "%Y-%m-%d").ok()
}

/// One event becomes exactly one line.
///
/// The message is not trusted to stay on one line: a newline in it would
/// fabricate a second event in a file that is read by eye, and a fabricated
/// event is worse than a missing one. An unknown level is written as `info`
/// rather than refused - dropping the line the caller wanted recorded would be
/// the worse surprise, and the level is decoration on top of the text.
fn one_line(at: DateTime<Local>, level: &str, message: &str) -> String {
    let level = match level.trim().to_ascii_lowercase().as_str() {
        "warn" | "warning" => "warn",
        "error" => "error",
        _ => "info",
    };

    let mut message: String = message
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect();
    if message.chars().count() > MAX_MESSAGE {
        message = message.chars().take(MAX_MESSAGE).collect();
        message.push_str("...");
    }

    format!("{} [{level}] {message}\n", at.format("%Y-%m-%d %H:%M:%S"))
}

/// Drops the daily files that fell out of the window.
///
/// Runs on every write rather than at startup: the application may stay open
/// for weeks, and a write is the only moment that is guaranteed to happen.
/// Best effort throughout - a log line must never fail because a stale file
/// could not be removed - and limited to names `date_in` recognises.
fn prune(dir: &Path, today: NaiveDate) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(date) = date_in(name) else { continue };
        if today.signed_duration_since(date).num_days() >= KEEP_DAYS {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Appends one event to the daily file in `dir`, then prunes what is too old.
///
/// Takes the directory and the moment instead of reading them itself, which is
/// what lets the tests write into a scratch folder on a date they chose rather
/// than into the real installation on whatever today is.
fn append(dir: &Path, at: DateTime<Local>, level: &str, message: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dir)
        .map_err(|err| format!("Δεν ήταν δυνατή η δημιουργία του φακέλου καταγραφών: {err}"))?;

    let target = dir.join(file_name(at));
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&target)
        .map_err(|err| format!("Δεν ήταν δυνατό το άνοιγμα του αρχείου καταγραφών: {err}"))?;
    file.write_all(one_line(at, level, message).as_bytes())
        .map_err(|err| format!("Δεν ήταν δυνατή η εγγραφή στο αρχείο καταγραφών: {err}"))?;

    // After the write, and only ever able to fail the pruning: the line is
    // already on disk by the time anything else can go wrong.
    prune(dir, at.date_naive());

    Ok(target)
}

/// Writes one line of the application's own: startup, a command that failed,
/// the window closing.
///
/// Returns nothing and cannot fail. Startup runs before there is anybody to
/// report a failure to, so a log that could raise would be able to stop the
/// launch it was meant to describe.
pub fn record(level: &str, message: &str) {
    if let Ok(dir) = log_dir() {
        let _ = append(&dir, Local::now(), level, message);
    }
}

/// Hands a command's result back unchanged, having recorded a failure on the
/// way.
///
/// The commands keep returning `Err` - the frontend still shows its toast - and
/// this sits beside it, so a failure reaches the file as well as the screen.
/// Written as a pass-through rather than a `?` at each call site because the
/// caller needs both: the error for the user, the line for whoever reads the
/// folder afterwards.
pub fn record_failure<T>(result: Result<T, String>, what: &str) -> Result<T, String> {
    if let Err(err) = &result {
        record("error", &format!("{what}: {err}"));
    }
    result
}

/// What the frontend hands over. Same file, same rules; the difference is that
/// this one reports a failure back, because the caller is asking for a line
/// rather than recording one on its own.
#[tauri::command]
pub fn log_event(level: String, message: String) -> Result<(), String> {
    append(&log_dir()?, Local::now(), &level, &message).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, TimeZone};

    /// A scratch directory per test, cleared first so a leftover from an
    /// earlier run cannot satisfy an assertion by accident.
    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("au-logger-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 5 November 2026, 17:32:10 local time - a fixed moment, so the file name
    /// asserted against is the file name the code writes, whatever day the test
    /// happens to run on. The hour is deliberately far from any daylight
    /// saving change, where a local time could be ambiguous.
    fn moment() -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 11, 5, 17, 32, 10).unwrap()
    }

    #[test]
    fn a_line_lands_in_the_file_for_its_day() {
        let dir = scratch("line");

        let target = append(&dir, moment(), "warn", "Δοκιμή").expect("the line should be written");

        assert_eq!(target, dir.join("log-2026-11-05.txt"), "one file per day");
        let body = fs::read_to_string(&target).unwrap();
        assert!(
            body.contains("2026-11-05 17:32:10 [warn] Δοκιμή"),
            "timestamp, level and text, got {body:?}"
        );
        assert!(body.ends_with('\n'), "every event ends its line: {body:?}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_write_appends_rather_than_replacing() {
        // The day's file is read as a whole history; starting it over would
        // keep only the newest event of the day.
        let dir = scratch("append");
        append(&dir, moment(), "info", "πρώτη").unwrap();
        append(&dir, moment(), "error", "δεύτερη").unwrap();

        let body = fs::read_to_string(dir.join("log-2026-11-05.txt")).unwrap();
        assert_eq!(body.lines().count(), 2, "got {body:?}");
        assert!(body.contains("πρώτη") && body.contains("δεύτερη"), "got {body:?}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_message_cannot_become_two_events() {
        // A newline in a message would read as a second event, and a
        // fabricated event is worse than a missing one.
        let dir = scratch("oneline");
        append(&dir, moment(), "error", "πρώτη\nδεύτερη\rτρίτη").unwrap();

        let body = fs::read_to_string(dir.join("log-2026-11-05.txt")).unwrap();
        assert_eq!(body.lines().count(), 1, "one event, one line: {body:?}");
        assert!(body.contains("πρώτη δεύτερη τρίτη"), "joined, not lost: {body:?}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unknown_level_is_written_rather_than_dropped() {
        let dir = scratch("level");
        append(&dir, moment(), "TRACE", "μήνυμα").unwrap();
        append(&dir, moment(), " warn ", "προειδοποίηση").unwrap();

        let body = fs::read_to_string(dir.join("log-2026-11-05.txt")).unwrap();
        assert!(body.contains("[info] μήνυμα"), "unknown level falls back: {body:?}");
        assert!(body.contains("[warn] προειδοποίηση"), "padded level is read: {body:?}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn files_outside_the_window_are_deleted_and_the_rest_are_kept() {
        // Fourteen days means today plus thirteen: the file from fourteen days
        // ago is the first one that goes.
        let dir = scratch("prune");
        let today = moment().date_naive();
        for age in [0, 1, 13, 14, 40] {
            let date = today - Duration::days(age);
            fs::write(dir.join(format!("log-{date}.txt")), "old").unwrap();
        }
        // Not ours: a date this module would never write, and no date at all.
        fs::write(dir.join("log-not-a-date.txt"), "somebody else's").unwrap();
        fs::write(dir.join("notes.txt"), "somebody else's").unwrap();

        append(&dir, moment(), "info", "σημερινή").unwrap();

        assert!(
            !dir.join(format!("log-{}.txt", today - Duration::days(14))).exists(),
            "fourteen days old is out"
        );
        assert!(
            !dir.join(format!("log-{}.txt", today - Duration::days(40))).exists(),
            "long gone is out"
        );
        assert!(
            dir.join(format!("log-{}.txt", today - Duration::days(13))).exists(),
            "thirteen days old is the oldest that stays"
        );
        assert!(dir.join(format!("log-{today}.txt")).exists(), "today stays");
        assert!(
            dir.join("log-not-a-date.txt").exists(),
            "a name we do not write is never a candidate"
        );
        assert!(dir.join("notes.txt").exists(), "neither is somebody else's file");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn record_failure_reports_and_then_hands_the_error_back() {
        let ok: Result<(), String> = Ok(());
        assert!(record_failure(ok, "δοκιμή").is_ok(), "a success is passed through");

        let failed: Result<(), String> = Err("η αποτυχία".into());
        let returned = record_failure(failed, "Το πράγμα").unwrap_err();
        assert_eq!(returned, "η αποτυχία", "the caller still gets its own error");
    }

    #[test]
    fn the_command_writes_beside_the_executable() {
        // The other tests hand `append` a directory they chose. This one goes
        // through the command, so it covers the resolution the shipped
        // application depends on: the folder next to the running executable,
        // because that is the folder the installer leaves alone.
        log_event("info".into(), "δοκιμή εντολής".into()).expect("the log area should resolve");

        let exe = std::env::current_exe().expect("a running test has an executable");
        let logs = exe.parent().expect("an executable has a directory").join(LOG_ROOT);
        let today = Local::now().format("%Y-%m-%d").to_string();
        let file = logs.join(format!("log-{today}.txt"));

        let body = fs::read_to_string(&file)
            .unwrap_or_else(|err| panic!("today's file should exist beside the test binary: {err}"));
        assert!(body.contains("δοκιμή εντολής"), "got {body:?}");

        // Left behind otherwise: this is target/, not a user's installation.
        // Only our own file, and the directory only if nothing else is in it -
        // a second application writing here at the same time must not lose its
        // history to a test.
        let _ = fs::remove_file(file);
        let _ = fs::remove_dir(logs);
    }
}

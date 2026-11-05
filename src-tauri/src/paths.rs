//! Where the folders beside the executable come from.
//!
//! The backups and the logs both have to land in `$INSTDIR` - the folder the
//! installer leaves alone - and both get there the same way, through
//! `current_exe`. Two copies of that resolution would be two things to keep in
//! step, and this project has already been bitten once by a name that existed
//! in two languages and disagreed (`legacy_location` / `legacyLocation`, §6 of
//! the session note). One function, two callers.

use std::path::{Path, PathBuf};

/// The directory the running executable sits in.
///
/// `current_exe` rather than the resource directory: this has to be `$INSTDIR`
/// exactly, because that is the folder the installer leaves alone. On a normal
/// install that is `%LOCALAPPDATA%\Programs\Accountant Util\`; in development
/// it is `target\debug\`, inside the repository's ignored tree and harmless.
pub(crate) fn install_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe()
        .map_err(|err| format!("Δεν ήταν δυνατή η εύρεση του εκτελέσιμου: {err}"))?;
    exe.parent().map(Path::to_path_buf).ok_or_else(|| {
        "Δεν ήταν δυνατό να προσδιοριστεί ο φάκελος εγκατάστασης του προγράμματος.".to_string()
    })
}

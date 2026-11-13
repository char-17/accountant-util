mod backup_fs;
mod logger;
mod migration;
mod paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Registered last. It is inert until the frontend asks for an update,
        // and the endpoint and public key come from tauri.conf.json. The
        // updater exposes no init(): Builder is the only way in, and an empty
        // builder reads everything from that config.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Only relaunch() is granted. exit() is not, and the ACL audit reports
        // it as dead if a future change adds the grant without a call site.
        .plugin(tauri_plugin_process::init())
        // The first line of the log, written before the frontend exists: if
        // the webview never comes up, the folder still says the application
        // started and at which version - the first thing anybody would ask.
        // `record` cannot fail, so this cannot be the reason a launch fails.
        .setup(|app| {
            logger::record(
                "info",
                &format!("Εκκίνηση του προγράμματος, έκδοση {}", app.package_info().version),
            );
            Ok(())
        })
        // Not the close *request*: that one is held by the CloseGuard until
        // the accountant says yes, so logging it would record closes that
        // never happened. `Destroyed` is the close that actually took place.
        // A close on the way out of an update does not reach here either -
        // the updater exits the process directly - which is why the update
        // records its own line before handing over.
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                logger::record("info", "Κλείσιμο του παραθύρου.");
            }
        })
        // Registration order carries no meaning; migration runs on the first
        // launch only, the backup pair is called on demand - once before any
        // backup is written, once at startup to read the schedule state - and
        // log_event is the way the frontend reaches the file, since the ACL
        // gives it no write access to this folder.
        .invoke_handler(tauri::generate_handler![
            migration::migrate_legacy_database,
            migration::migrate_database,
            backup_fs::prepare_backup_area,
            backup_fs::promote_auto_backup,
            backup_fs::inspect_backup_database,
            backup_fs::restore_database_file,
            logger::log_event
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod migration;

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
        .invoke_handler(tauri::generate_handler![migration::migrate_legacy_database])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
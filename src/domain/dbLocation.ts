/**
 * Locating the database file, including a one-time migration.
 *
 * The Tauri SQL plugin resolves `sqlite:name.db` against the app's data
 * directory, whose name comes from the bundle identifier. Renaming the product
 * therefore moves the file, which would otherwise present the user with an
 * empty application after upgrading.
 *
 * The move itself is a Rust command: it needs the app data directory, which the
 * frontend has no permission to read, and a failure there has to be reported
 * rather than swallowed.
 */

import { invoke } from "@tauri-apps/api/core";

export const DB_FILE_NAME = "accountant.db";

export interface MigrationResult {
  /** True when a database was carried over from the previous identifier. */
  migrated: boolean;
  /**
   * Set when an older database exists but could not be moved. The caller shows
   * this: failing quietly would leave the user with an apparently empty app and
   * no clue that their data is still in the previous location.
   */
  warning: string | null;
  /** Where the un-moved database can be found, when there is one. */
  legacyLocation: string | null;
}

const NOTHING_TO_MIGRATE: MigrationResult = {
  migrated: false,
  warning: null,
  legacyLocation: null,
};

export async function migrateLegacyDatabase(): Promise<MigrationResult> {
  try {
    return await invoke<MigrationResult>("migrate_legacy_database");
  } catch (err) {
    // The app still starts and the old file is untouched, but the user has to be
    // told why the list looks empty.
    const reason = err instanceof Error ? err.message : String(err);
    console.error("Database migration command failed:", reason);
    return {
      ...NOTHING_TO_MIGRATE,
      warning:
        "Δεν ήταν δυνατός ο έλεγχος για παλιότερη βάση δεδομένων. " +
        `Αιτία: ${reason}`,
    };
  }
}
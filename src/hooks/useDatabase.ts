import { useState, useEffect } from "react";
import Database from "@tauri-apps/plugin-sql";
import { migrateLegacyDatabase, migrateDatabase, DB_FILE_NAME } from "../domain/dbLocation";
import { seedDefaultProfessions } from "../persistence/professionRepo";
import { logEvent } from "../utils/logging";

/**
 * Opens the database only after the native backend has completed the schema
 * migration. The backend owns the migration transaction and creates a
 * pre-migration snapshot before changing anything.
 */
export function useDatabase() {
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [migrationWarning, setMigrationWarning] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const legacy = await migrateLegacyDatabase();
        if (legacy.migrated) {
          console.info("Η βάση δεδομένων μεταφέρθηκε από την παλιά θέση.");
        }
        if (legacy.warning) {
          setMigrationWarning(legacy.warning);
          void logEvent(`warn`, `Προειδοποίηση μεταφοράς της βάσης δεδομένων: ${legacy.warning}`);
        }

        const warning = await migrateDatabase();
        if (warning) {
          setMigrationWarning(warning);
          void logEvent(`warn`, `Προειδοποίηση migration της βάσης: ${warning}`);
        }

        const database = await Database.load(`sqlite:${DB_FILE_NAME}`);
        // Defaults are data, not schema. They run after the transactional
        // migration has committed and never overwrite user customisations.
        try {
          await seedDefaultProfessions(database);
        } catch {
          // A database with no default professions remains usable.
        }
        setDb(database);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error("Database init error:", reason);
        void logEvent(`error`, `Η βάση δεδομένων δεν άνοιξε: ${reason}`);
        setError(reason);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  return { db, loading, error, migrationWarning };
}

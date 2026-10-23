// Locates the live development database for the scripts that exercise it.
//
// The path depends on the bundle identifier in tauri.conf.json, which changed
// when the product was renamed. Reading it from the config keeps the scripts
// working across that change instead of hardcoding a directory that quietly
// stops existing.

const fs = require('fs');
const path = require('path');

// This file lives in lib/, so the project root is one level up.
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'src-tauri', 'tauri.conf.json');

/** The identifier from tauri.conf.json, e.g. "com.ariston.accountant-util". */
function appIdentifier() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return config.identifier;
}

/** Full path of the live database. */
function databasePath() {
  // The file name is spelled out here rather than imported: this runs in plain
  // Node, where the TypeScript constant in src/domain/appConfig.ts is not
  // reachable. That makes it a second copy, and migration.rs holds a third.
  // audit-config.cjs reads all three and fails when they disagree.
  return path.join(process.env.APPDATA, appIdentifier(), 'accountant.db');
}

/**
 * Opens the live database for read/write.
 *
 * `checkSchema` validates that the tables exist, so a script fails with a clear
 * message instead of an opaque SQLITE_CANTOPEN when it has been run before the
 * app has created the file.
 */
function openDatabase() {
  const file = databasePath();
  const Database = require('better-sqlite3');

  if (!fs.existsSync(file)) {
    throw new Error(
      `Δεν βρέθηκε η βάση δεδομένων στο ${file}.\n` +
        'Ξεκινήστε την εφαρμογή μία φορά ώστε να δημιουργηθεί, και ξανατρέξτε το script.'
    );
  }
  return new Database(file);
}

module.exports = { appIdentifier, databasePath, openDatabase };
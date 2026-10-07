const Database = require('better-sqlite3');
const path = require('path');

const dbPath = require('./lib/dbPath.cjs').databasePath();
const db = new Database(dbPath);

// Remove stale bookkeeping from the prototype build and its leftover table.
// Schema now comes from the frontend (see src/hooks/useDatabase.ts).
db.exec('DROP TABLE IF EXISTS transactions');
db.exec('DROP TABLE IF EXISTS _sqlx_migrations');

console.log('Tables now:', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name));
console.log('Clients:', db.prepare('SELECT COUNT(*) AS c FROM clients').get().c);
console.log('Tasks:', db.prepare('SELECT COUNT(*) AS c FROM task_types').get().c);

db.close();

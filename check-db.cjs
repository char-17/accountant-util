const Database = require('better-sqlite3');
const path = require('path');

const dbPath = require('./lib/dbPath.cjs').databasePath();
console.log('DB path:', dbPath);

const db = new Database(dbPath, { readonly: true });

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
  .all();
console.log('Tables:', tables.map((t) => t.name));

console.log('Clients:', db.prepare('SELECT COUNT(*) AS c FROM clients').get().c);
console.log('Tasks:', db.prepare('SELECT COUNT(*) AS c FROM task_types').get().c);

const integrity = db.pragma('integrity_check');
console.log('Integrity:', integrity);

const migrations = db.prepare('SELECT * FROM _sqlx_migrations').all();
console.log('Recorded migrations:', migrations);

db.close();

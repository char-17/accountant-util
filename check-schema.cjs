const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Read-only check of the real app database after launch.
const dbPath = require('./lib/dbPath.cjs').databasePath();
const db = new Database(dbPath, { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
const cols = db.prepare('PRAGMA table_info(client_task_assignments)').all().map((c) => c.name);

console.log('Tables:', tables.join(', '));
console.log('\nclient_task_assignments columns:');
console.log('  ' + cols.join(', '));

console.log('\nExpected:');
for (const c of ['periodicity', 'due_day', 'reminder_days']) {
  console.log(`  ${c}: ${cols.includes(c) ? 'present' : 'MISSING'}`);
}
console.log(`  task_reminders table: ${tables.includes('task_reminders') ? 'present' : 'MISSING'}`);

console.log('\nData intact:');
console.log('  clients:', db.prepare('SELECT COUNT(*) AS c FROM clients').get().c);
console.log('  tasks:  ', db.prepare('SELECT COUNT(*) AS c FROM task_types').get().c);

db.close();

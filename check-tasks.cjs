const Database = require('better-sqlite3');
const path = require('path');

const dbPath = require('./lib/dbPath.cjs').databasePath();
const db = new Database(dbPath, { readonly: true });

console.log('Total tasks:', db.prepare('SELECT COUNT(*) AS c FROM task_types').get().c);
console.log('\nAll tasks:');
db.prepare('SELECT id, name, color, is_active FROM task_types ORDER BY id').all()
  .forEach((t) => console.log(`  #${t.id} "${t.name}" color=${t.color} active=${t.is_active}`));

db.close();

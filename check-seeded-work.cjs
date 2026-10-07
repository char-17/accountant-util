const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(
  require('./lib/dbPath.cjs').databasePath(),
  { readonly: true }
);

console.log('Seeded work per month:\n');
const rows = db.prepare(`
  SELECT m.year, m.month, c.name AS client, t.name AS task, m.status
  FROM monthly_task_status m
  JOIN clients c ON m.client_id = c.id
  JOIN task_types t ON m.task_type_id = t.id
  ORDER BY m.year, m.month, c.name
`).all();

for (const r of rows) {
  const period = `${r.year}-${String(r.month).padStart(2, '0')}`;
  console.log(`  ${period}  ${r.client.padEnd(26)} ${r.task}  [${r.status}]`);
}

db.close();

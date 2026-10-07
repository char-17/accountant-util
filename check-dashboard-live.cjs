const Database = require('better-sqlite3');
const path = require('path');

const dbPath = require('./lib/dbPath.cjs').databasePath();
const db = new Database(dbPath, { readonly: true });

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth() + 1;

console.log(`Current month: ${year}-${String(month).padStart(2, '0')}\n`);

const total = db.prepare('SELECT COUNT(*) AS c FROM monthly_task_status').get().c;
console.log('monthly_task_status total rows:', total);

if (total === 0) {
  console.log('\nSTILL EMPTY - the seed did not run.');
  process.exit(1);
}

console.log('\nby month:');
db.prepare(`
  SELECT year, month,
         COUNT(*) AS tasks,
         SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
  FROM monthly_task_status GROUP BY year, month
  ORDER BY year DESC, month DESC LIMIT 6
`).all().forEach((r) =>
  console.log(`  ${r.year}-${String(r.month).padStart(2, '0')}: ${r.tasks} tasks, ${r.completed} completed`)
);

console.log('\nWhat the dashboard will show for the current month:');
const s = db.prepare('SELECT COUNT(*) AS c FROM monthly_task_status WHERE year=? AND month=?').get(year, month).c;
const done = db.prepare("SELECT COUNT(*) AS c FROM monthly_task_status WHERE year=? AND month=? AND status='completed'").get(year, month).c;
const clients = db.prepare('SELECT COUNT(DISTINCT client_id) AS c FROM monthly_task_status WHERE year=? AND month=?').get(year, month).c;
console.log(`  Πελάτες:       ${clients}`);
console.log(`  Εργασίες:      ${s}`);
console.log(`  Ολοκληρωμένες: ${done}`);
console.log(`  Εκκρεμείς:     ${s - done}`);

db.close();

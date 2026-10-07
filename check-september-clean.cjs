// Confirms the September ghost rows are gone and that opening the app does not
// bring them back - the fix has to hold, not just the cleanup.
const Database = require('better-sqlite3');
const { databasePath } = require('./lib/dbPath.cjs');

const db = new Database(databasePath(), { readonly: true });

console.log('Κατανομή ανά μήνα μετά την εκτέλεση της εφαρμογής:\n');
const rows = db.prepare(`
  SELECT year, month, COUNT(*) AS total,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done
  FROM monthly_task_status
  GROUP BY year, month ORDER BY year, month
`).all();

for (const r of rows) {
  console.log(`  ${r.year}-${String(r.month).padStart(2, '0')}: ${r.total} εργασίες (${r.done} ολοκληρωμένες)`);
}

const sep = db.prepare('SELECT COUNT(*) AS c FROM monthly_task_status WHERE year = 2026 AND month = 9').get().c;
const clients = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c;
const tasks = db.prepare('SELECT COUNT(*) AS c FROM task_types').get().c;
const assignments = db.prepare('SELECT COUNT(*) AS c FROM client_task_assignments').get().c;

console.log('');
console.log(sep === 0
  ? '  OK  Ο Σεπτέμβριος παραμένει κενός μετά την εκτέλεση της εφαρμογής.'
  : `  FAIL Ξαναδημιουργήθηκαν ${sep} γραμμές - το fix δεν κρατά.`);
console.log(`  OK  Πελάτες: ${clients} | Εργασίες: ${tasks} | Αναθέσεις: ${assignments}`);

db.close();
process.exit(sep === 0 && clients === 44 && tasks === 34 && assignments === 7 ? 0 : 1);
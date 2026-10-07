const Database = require('better-sqlite3');
const path = require('path');

// Opens the live DB read/write to verify whether adding an assignment produces
// a monthly_task_status row WITHOUT changing months (the real user flow).
const dbPath = require('./lib/dbPath.cjs').databasePath();
const db = new Database(dbPath);

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};

const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);
const year = new Date().getFullYear();
const month = new Date().getMonth() + 1;

console.log(`Current period: ${year}-${String(month).padStart(2, '0')}  (today ${today})\n`);

const clientId = db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get().id;
const taskId = db.prepare('SELECT id FROM task_types WHERE is_active = 1 ORDER BY id LIMIT 1').get().id;

console.log('Before adding an assignment:');
const rowsBefore = db.prepare(
  'SELECT COUNT(*) AS c FROM monthly_task_status WHERE year=? AND month=?'
).get(year, month).c;
console.log(`  status rows for this period: ${rowsBefore}`);

console.log('\n1) create the assignment (what the UI does)');
const asgId = db.prepare(
  'INSERT INTO client_task_assignments (client_id, task_type_id, start_date, periodicity, due_day, reminder_days) VALUES (?,?,?,?,?,?)'
).run(clientId, taskId, today, 'monthly', 28, 5).lastInsertRowid;
check('assignment created', asgId > 0);

console.log('\n2) does the monthly worklist see it? (seed is NOT re-run)');
let visible = db.prepare(`
  SELECT COUNT(*) AS c FROM monthly_task_status m
  JOIN client_task_assignments a
    ON a.client_id = m.client_id AND a.task_type_id = m.task_type_id
  WHERE m.year = ? AND m.month = ? AND a.id = ?
`).get(year, month, asgId).c;
check('new assignment has a status row', visible === 1, `found ${visible} - invisible in "Εργασίες μήνα"`);

console.log('\n3) re-running the seed fixes it');
db.prepare(`
  INSERT OR IGNORE INTO monthly_task_status (client_id, task_type_id, year, month, status)
  SELECT a.client_id, a.task_type_id, ?, ?, 'pending'
  FROM client_task_assignments a
  JOIN task_types t ON a.task_type_id = t.id
  WHERE a.is_active = 1 AND t.is_active = 1
    AND a.start_date <= ? AND (a.end_date IS NULL OR a.end_date >= ?)
    AND (a.periodicity = 'monthly'
      OR (a.periodicity = 'quarterly' AND ((? - 1) % 3) = 0)
      OR (a.periodicity = 'yearly' AND ? = 1))
    AND NOT EXISTS (SELECT 1 FROM monthly_task_status m
      WHERE m.client_id = a.client_id AND m.task_type_id = a.task_type_id
        AND m.year = ? AND m.month = ?)
`).run(year, month, today, today, month, month, year, month);

visible = db.prepare(`
  SELECT COUNT(*) AS c FROM monthly_task_status m
  JOIN client_task_assignments a
    ON a.client_id = m.client_id AND a.task_type_id = m.task_type_id
  WHERE m.year = ? AND m.month = ? AND a.id = ?
`).get(year, month, asgId).c;
check('after re-seeding it is visible', visible === 1, `found ${visible}`);

// Clean up so the user's data is left as we found it.
db.prepare('DELETE FROM monthly_task_status WHERE client_id=? AND task_type_id=? AND year=? AND month=?')
  .run(clientId, taskId, year, month);
db.prepare('DELETE FROM client_task_assignments WHERE id = ?').run(asgId);
db.close();

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
console.log('(test data cleaned up)');

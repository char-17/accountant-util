const Database = require('better-sqlite3');
const path = require('path');

// End-to-end check of the flow the user reported as broken:
// add a task to a client -> it must appear in the month's worklist.
//
// Uses a scratch database so the user's real data is never touched.
const tmp = path.join(process.env.TEMP, 'e2e-assignment.db');
try { require('fs').unlinkSync(tmp); } catch {}
const db = new Database(tmp);

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};

db.exec(`
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
  CREATE TABLE task_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    description TEXT, color TEXT NOT NULL DEFAULT '#8B9DAD',
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE client_task_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL, task_type_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL, end_date TEXT,
    periodicity TEXT NOT NULL DEFAULT 'monthly',
    due_day INTEGER NOT NULL DEFAULT 28,
    reminder_days INTEGER NOT NULL DEFAULT 5
  );
  CREATE TABLE monthly_task_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL, task_type_id INTEGER NOT NULL,
    year INTEGER NOT NULL, month INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    completed_at TEXT, note TEXT,
    UNIQUE(client_id, task_type_id, year, month)
  );

  INSERT INTO clients (name) VALUES ('ΠΕΛΑΤΗΣ Α');
  INSERT INTO task_types (name, color) VALUES ('ΕΡΓΑΣΙΑ ΝΕΑ', '#7B8D6E');
`);

const year = 2026, month = 10;
const today = '2026-10-06';

const clientId = db.prepare('SELECT id FROM clients LIMIT 1').get().id;
const taskId = db.prepare('SELECT id FROM task_types LIMIT 1').get().id;

// Mirrors statusRepo.seedMonthFromAssignments
const seed = () => db.prepare(`
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
`).run(year, month, today, today, month, month, year, month).changes;

// Mirrors statusRepo.getMonthlyStatus (what MonthlyWorklist renders)
const worklist = () => db.prepare(`
  SELECT c.name AS clientName, t.name AS taskName, t.color AS taskColor, m.status
  FROM monthly_task_status m
  JOIN clients c ON m.client_id = c.id
  JOIN task_types t ON m.task_type_id = t.id
  WHERE m.year = ? AND m.month = ?
  ORDER BY c.name, t.name
`).all(year, month);

console.log('Step 1: empty state');
check('worklist starts empty', worklist().length === 0, `got ${worklist().length}`);

console.log('\nStep 2: assign the task to the client (the reported action)');
db.prepare(`
  INSERT INTO client_task_assignments (client_id, task_type_id, start_date, periodicity, due_day, reminder_days)
  VALUES (?,?,?,'monthly',28,5)
`).run(clientId, taskId, today);
check('assignment row exists',
  db.prepare('SELECT COUNT(*) AS c FROM client_task_assignments').get().c === 1);

console.log('\nStep 3: refresh the view (seed + read, as the app does)');
seed();
const afterAssign = worklist();
check('task appears in the worklist', afterAssign.length === 1, `got ${afterAssign.length}`);
check('with the right client', afterAssign[0]?.clientName === 'ΠΕΛΑΤΗΣ Α', String(afterAssign[0]?.clientName));
check('with the right task', afterAssign[0]?.taskName === 'ΕΡΓΑΣΙΑ ΝΕΑ', String(afterAssign[0]?.taskName));
check('starts pending', afterAssign[0]?.status === 'pending');

console.log('\nStep 4: a second task on the same client also shows');
db.prepare('INSERT INTO task_types (name, color) VALUES (\'ΕΡΓΑΣΙΑ Β\', \'#8B9DAD\')').run();
const task2 = db.prepare("SELECT id FROM task_types WHERE name = 'ΕΡΓΑΣΙΑ Β'").get().id;
db.prepare(`
  INSERT INTO client_task_assignments (client_id, task_type_id, start_date)
  VALUES (?,?,?)
`).run(clientId, task2, today);
seed();
check('two tasks now listed', worklist().length === 2, `got ${worklist().length}`);

console.log('\nStep 5: completing one updates the summary counters');
db.prepare(`
  INSERT INTO monthly_task_status (client_id, task_type_id, year, month, status, completed_at)
  VALUES (?,?,?,?,'completed', datetime('now'))
  ON CONFLICT(client_id, task_type_id, year, month)
  DO UPDATE SET status='completed', completed_at=datetime('now')
`).run(clientId, taskId, year, month);
seed(); // refresh, as the hook does after every mutation

const rows = worklist();
const completed = rows.filter((r) => r.status === 'completed').length;
check('one task completed', completed === 1, `got ${completed}`);
check('re-seeding did not reset it',
  rows.find((r) => r.taskName === 'ΕΡΓΑΣΙΑ ΝΕΑ')?.status === 'completed');

console.log('\nStep 6: assigning to a NEW client mid-month also appears');
db.prepare("INSERT INTO clients (name) VALUES ('ΠΕΛΑΤΗΣ Β')").run();
const client2 = db.prepare("SELECT id FROM clients WHERE name = 'ΠΕΛΑΤΗΣ Β'").get().id;
db.prepare(`
  INSERT INTO client_task_assignments (client_id, task_type_id, start_date)
  VALUES (?,?,?)
`).run(client2, taskId, today);
seed();
const finalRows = worklist();
check('new client work appears', finalRows.length === 3, `got ${finalRows.length}`);
check('new client is listed',
  finalRows.some((r) => r.clientName === 'ΠΕΛΑΤΗΣ Β' && r.taskName === 'ΕΡΓΑΣΙΑ ΝΕΑ'));

db.close();
require('fs').unlinkSync(tmp);
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

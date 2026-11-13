const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const tmp = path.join(os.tmpdir(), 'seed-test.db');
try { require('fs').unlinkSync(tmp); } catch {}
const db = new Database(tmp);

db.exec(`
  CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE task_types (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER DEFAULT 1);
  CREATE TABLE client_task_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER, task_type_id INTEGER, is_active INTEGER DEFAULT 1,
    start_date TEXT, end_date TEXT,
    periodicity TEXT DEFAULT 'monthly', due_day INTEGER DEFAULT 28, reminder_days INTEGER DEFAULT 5
  );
  CREATE TABLE monthly_task_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER, task_type_id INTEGER, year INTEGER, month INTEGER,
    status TEXT DEFAULT 'pending', completed_at TEXT, note TEXT,
    UNIQUE(client_id, task_type_id, year, month)
  );

  INSERT INTO clients VALUES (1,'Client A'), (2,'Client B');
  INSERT INTO task_types VALUES (1,'Monthly task',1), (2,'Quarterly task',1), (3,'Yearly task',1), (4,'Inactive task',0);

  -- Client 1: all three periodicities, all active, started long ago.
  INSERT INTO client_task_assignments
    (client_id, task_type_id, is_active, start_date, periodicity)
  VALUES
    (1,1,1,'2026-01-01','monthly'),
    (1,2,1,'2026-01-01','quarterly'),
    (1,3,1,'2026-01-01','yearly'),
    (1,4,1,'2026-01-01','monthly'),
    (2,1,1,'2026-06-01','monthly');
`);

let failures = 0;
const checkEq = (label, actual, expected) => {
  if (Object.is(actual, expected)) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`); }
};

// Mirrors seedMonthFromAssignments in src/persistence/statusRepo.ts
function seed(year, month, periodDate) {
  return db.prepare(`
    INSERT OR IGNORE INTO monthly_task_status (client_id, task_type_id, year, month, status)
    SELECT a.client_id, a.task_type_id, ?, ?, 'pending'
    FROM client_task_assignments a
    JOIN task_types t ON a.task_type_id = t.id
    WHERE a.is_active = 1
      AND t.is_active = 1
      AND a.start_date <= ?
      AND (a.end_date IS NULL OR a.end_date >= ?)
      AND (
        a.periodicity = 'monthly'
        OR (a.periodicity = 'quarterly' AND ((? - 1) % 3) = 0)
        OR (a.periodicity = 'yearly' AND ? = 1)
      )
      AND NOT EXISTS (
        SELECT 1 FROM monthly_task_status m
        WHERE m.client_id = a.client_id AND m.task_type_id = a.task_type_id
          AND m.year = ? AND m.month = ?
      )
  `).run(year, month, periodDate, periodDate, month, month, year, month).changes;
}

const countFor = (year, month) =>
  db.prepare('SELECT COUNT(*) AS c FROM monthly_task_status WHERE year = ? AND month = ?').get(year, month).c;

console.log('seeding January (quarter-start + yearly month):');
// Client 1 contributes monthly + quarterly + yearly = 3 rows.
// Client 2's assignment starts in June, and task type 4 is inactive, so
// neither should appear. 3 is the correct count.
checkEq('rows created', seed(2026, 1, '2026-01-01'), 3);
checkEq('total rows for January', countFor(2026, 1), 3);
checkEq('quarterly seeded in Jan',
  db.prepare("SELECT COUNT(*) AS c FROM monthly_task_status WHERE task_type_id = 2 AND month = 1").get().c, 1);
checkEq('yearly seeded in Jan',
  db.prepare("SELECT COUNT(*) AS c FROM monthly_task_status WHERE task_type_id = 3 AND month = 1").get().c, 1);
checkEq('assignment not yet started is skipped',
  db.prepare('SELECT COUNT(*) AS c FROM monthly_task_status WHERE client_id = 2').get().c, 0);
checkEq('inactive task type is skipped',
  db.prepare('SELECT COUNT(*) AS c FROM monthly_task_status WHERE task_type_id = 4').get().c, 0);

console.log('\nseeding February (monthly only):');
checkEq('rows created', seed(2026, 2, '2026-02-01'), 1);
checkEq('total rows for February', countFor(2026, 2), 1);
checkEq('no quarterly in Feb',
  db.prepare("SELECT COUNT(*) AS c FROM monthly_task_status WHERE task_type_id = 2 AND month = 2").get().c, 0);
checkEq('no yearly in Feb',
  db.prepare("SELECT COUNT(*) AS c FROM monthly_task_status WHERE task_type_id = 3 AND month = 2").get().c, 0);

console.log('\nseeding March (monthly only):');
seed(2026, 3, '2026-03-01');
checkEq('quarterly still absent in Mar',
  db.prepare("SELECT COUNT(*) AS c FROM monthly_task_status WHERE task_type_id = 2 AND month = 3").get().c, 0);

console.log('\nseeding April (quarter-start):');
seed(2026, 4, '2026-04-01');
checkEq('quarterly present in Apr',
  db.prepare("SELECT COUNT(*) AS c FROM monthly_task_status WHERE task_type_id = 2 AND month = 4").get().c, 1);

console.log('\nre-seeding is safe (idempotent):');
checkEq('second seed creates nothing', seed(2026, 1, '2026-01-01'), 0);
checkEq('row count unchanged', countFor(2026, 1), 3);

console.log('\ncompleted work survives re-seeding:');
db.prepare("UPDATE monthly_task_status SET status = 'completed' WHERE task_type_id = 1 AND month = 1").run();
seed(2026, 1, '2026-01-01');
checkEq('status still completed',
  db.prepare("SELECT status FROM monthly_task_status WHERE task_type_id = 1 AND month = 1").get().status, 'completed');

console.log('\nsummary counters are non-zero now:');
const rows = db.prepare('SELECT status, COUNT(*) AS c FROM monthly_task_status GROUP BY status').all();
console.log('   by status:', JSON.stringify(rows));

db.close();
require('fs').unlinkSync(tmp);
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

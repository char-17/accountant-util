const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// This test builds its own database, so it is unaffected by WAL mode.
const tmp = path.join(os.tmpdir(), 'startdate-test.db');
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
    status TEXT DEFAULT 'pending',
    UNIQUE(client_id, task_type_id, year, month)
  );
  INSERT INTO clients VALUES (24,'Client X'), (17,'Client Y');
  INSERT INTO task_types VALUES (11,'E3/N',1), (29,'ΓΕΜΗ',1), (2,'ΦΠΑ',1);

  -- Same shape as the real data: created today, mid-month.
  INSERT INTO client_task_assignments (client_id, task_type_id, is_active, start_date, periodicity)
  VALUES (24,11,1,'2026-10-06','monthly'),
         (24,29,1,'2026-10-06','monthly'),
         (17, 2,1,'2026-10-06','monthly');
`);

function seed(year, month, periodDate) {
  return db.prepare(`
    INSERT OR IGNORE INTO monthly_task_status (client_id, task_type_id, year, month, status)
    SELECT a.client_id, a.task_type_id, ?, ?, 'pending'
    FROM client_task_assignments a
    JOIN task_types t ON a.task_type_id = t.id
    WHERE a.is_active = 1 AND t.is_active = 1
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

const count = () => db.prepare('SELECT COUNT(*) AS c FROM monthly_task_status').get().c;

console.log('BUGGY: periodDate = 1st of the month');
const wrong = seed(2026, 10, '2026-10-01');
console.log(`  rows seeded: ${wrong}  (expected 3)`);
console.log(`  dashboard would show: ${count()} tasks`);

db.exec('DELETE FROM monthly_task_status');

console.log('\nFIXED: periodDate = today');
const right = seed(2026, 10, '2026-10-06');
console.log(`  rows seeded: ${right}  (expected 3)`);
console.log(`  dashboard would show: ${count()} tasks`);

const rows = db.prepare(`
  SELECT c.name AS client, t.name AS task
  FROM monthly_task_status m
  JOIN clients c ON m.client_id = c.id
  JOIN task_types t ON m.task_type_id = t.id
  WHERE m.year = 2026 AND m.month = 10
`).all();
console.log('\n  seeded work:');
rows.forEach((r) => console.log(`    ${r.client} -> ${r.task}`));

const ok = wrong === 0 && right === 3;
db.close();
require('fs').unlinkSync(tmp);
console.log(ok ? '\nBug reproduced and fix verified.' : '\nUnexpected result.');
process.exit(ok ? 0 : 1);

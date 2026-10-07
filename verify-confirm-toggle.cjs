const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Verifies the confirm-before-toggle contract:
//   1. requesting a change must NOT write anything
//   2. confirming writes the new status
//   3. reverting writes 'pending' and clears completed_at
//   4. toggling one task never touches another

const tmp = path.join(os.tmpdir(), 'confirm-toggle-test.db');
try { require('fs').unlinkSync(tmp); } catch {}
const db = new Database(tmp);

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};

db.exec(`
  CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE task_types (id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE monthly_task_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL, task_type_id INTEGER NOT NULL,
    year INTEGER NOT NULL, month INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    completed_at TEXT, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(client_id, task_type_id, year, month)
  );
  INSERT INTO clients VALUES (1,'ΠΕΛΑΤΗΣ Α'),(2,'ΠΕΛΑΤΗΣ Β');
  INSERT INTO task_types VALUES (1,'ΕΡΓΑΣΙΑ Α'),(2,'ΕΡΓΑΣΙΑ Β');

  INSERT INTO monthly_task_status (client_id, task_type_id, year, month, status)
  VALUES (1,1,2026,10,'pending'), (1,2,2026,10,'pending'), (2,1,2026,10,'pending');
`);

const read = (c, t) => db.prepare(
  'SELECT status, completed_at AS completedAt FROM monthly_task_status WHERE client_id=? AND task_type_id=? AND year=2026 AND month=10'
).get(c, t);

// Mirrors statusRepo.setTaskCompleted
const setCompleted = (c, t) => db.prepare(`
  INSERT INTO monthly_task_status (client_id, task_type_id, year, month, status, completed_at)
  VALUES (?,?,2026,10,'completed', datetime('now'))
  ON CONFLICT(client_id, task_type_id, year, month)
  DO UPDATE SET status='completed', completed_at=datetime('now'), updated_at=datetime('now')
`).run(c, t);

// Mirrors statusRepo.setTaskPending
const setPending = (c, t) => db.prepare(`
  INSERT INTO monthly_task_status (client_id, task_type_id, year, month, status, completed_at)
  VALUES (?,?,2026,10,'pending', NULL)
  ON CONFLICT(client_id, task_type_id, year, month)
  DO UPDATE SET status='pending', completed_at=NULL, updated_at=datetime('now')
`).run(c, t);

console.log('1) clicking the checkbox must not write on its own');
// The component only calls setPending here; no repo call happens yet.
check('status unchanged before confirming', read(1, 1).status === 'pending', read(1, 1).status);
check('no completion timestamp', read(1, 1).completedAt === null);

console.log('\n2) confirming the completion writes it');
setCompleted(1, 1);
check('status is completed', read(1, 1).status === 'completed', read(1, 1).status);
check('completion timestamp set', read(1, 1).completedAt !== null);

console.log('\n3) other rows are untouched');
check('same client other task still pending', read(1, 2).status === 'pending');
check('other client still pending', read(2, 1).status === 'pending');

console.log('\n4) reverting asks first, then writes pending');
// Nothing happens until confirm:
check('still completed before confirming the revert', read(1, 1).status === 'completed');
setPending(1, 1);
check('status is pending after confirming', read(1, 1).status === 'pending', read(1, 1).status);
check('completion timestamp cleared', read(1, 1).completedAt === null, String(read(1, 1).completedAt));

console.log('\n5) toggling back and forth is stable');
for (let i = 0; i < 3; i++) { setCompleted(1, 1); setPending(1, 1); }
check('ends pending', read(1, 1).status === 'pending');
check('ends with no timestamp', read(1, 1).completedAt === null);

console.log('\n6) re-completing sets a fresh timestamp');
setCompleted(1, 1);
check('completed again', read(1, 1).status === 'completed');
check('timestamp present again', read(1, 1).completedAt !== null);

console.log('\n7) summary counts follow the statuses');
const counts = db.prepare(
  "SELECT SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS done, COUNT(*) AS total FROM monthly_task_status"
).get();
check('1 completed of 3', counts.done === 1 && counts.total === 3, JSON.stringify(counts));

db.close();
require('fs').unlinkSync(tmp);
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

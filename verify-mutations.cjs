const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

// Exercises every write path the UI uses, in order, against a copy of the
// real database. Finds which mutations silently fail.
const src = require('./lib/dbPath.cjs').databasePath();
const tmp = path.join(os.tmpdir(), 'mutations-test.db');
try { require('fs').unlinkSync(tmp); } catch {}
new Database(src, { readonly: true }).backup(tmp).then(() => main());

function main() {
  const db = new Database(tmp);
  let failures = 0;
  const check = (label, cond, detail = '') => {
    if (cond) console.log(`  PASS  ${label}`);
    else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
  };

  const stamp = Date.now();
  const today = '2026-10-06';
  const year = 2026, month = 10;

  console.log('1) create client');
  let clientId;
  try {
    clientId = db.prepare(
      'INSERT INTO clients (name, tax_id, notes) VALUES (?,?,?)'
    ).run(`T${stamp}`, '123456789', 'note').lastInsertRowid;
    check('insert returns an id', clientId > 0);
  } catch (e) { check('insert returns an id', false, e.message); }

  console.log('\n2) create task type');
  let taskId;
  try {
    taskId = db.prepare('INSERT INTO task_types (name, color, description) VALUES (?,?,?)')
      .run(`TASK${stamp}`, '#7B8D6E', 'desc').lastInsertRowid;
    check('insert returns an id', taskId > 0);
  } catch (e) { check('insert returns an id', false, e.message); }

  console.log('\n3) create assignment (the "add task to client" flow)');
  let asgId;
  try {
    asgId = db.prepare(
      'INSERT INTO client_task_assignments (client_id, task_type_id, start_date, periodicity, due_day, reminder_days) VALUES (?,?,?,?,?,?)'
    ).run(clientId, taskId, today, 'monthly', 28, 5).lastInsertRowid;
    check('insert returns an id', asgId > 0);
  } catch (e) {
    check('insert returns an id', false, e.message);
    console.log('      -> THIS IS LIKELY THE FAILING STEP');
  }

  console.log('\n4) the assignment is visible to the query the UI uses');
  const joined = db.prepare(`
    SELECT a.id, a.periodicity, a.due_day AS dueDay, a.reminder_days AS reminderDays,
           c.name AS clientName, t.name AS taskName, t.color AS taskColor,
           (a.is_active = 1) AS isActive
    FROM client_task_assignments a
    JOIN task_types t ON a.task_type_id = t.id
    JOIN clients c ON a.client_id = c.id
    WHERE a.client_id = ?
  `).all(clientId);
  check('query returns the row', joined.length === 1, `got ${joined.length}`);
  check('clientName present', joined[0]?.clientName === `T${stamp}`, String(joined[0]?.clientName));
  check('taskName present', joined[0]?.taskName === `TASK${stamp}`, String(joined[0]?.taskName));

  console.log('\n5) seed the month from assignments');
  const seedChanges = db.prepare(`
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
  check('seed creates a row', seedChanges >= 1, `changes=${seedChanges}`);

  const statusRow = db.prepare(
    'SELECT status FROM monthly_task_status WHERE client_id=? AND task_type_id=? AND year=? AND month=?'
  ).get(clientId, taskId, year, month);
  check('status row exists', statusRow !== undefined);

  console.log('\n6) mark completed (the markCompleted path used by the dashboard)');
  db.prepare(`
    INSERT INTO monthly_task_status (client_id, task_type_id, year, month, status, completed_at, note)
    VALUES (?,?,?,?,'completed', datetime('now'), ?)
    ON CONFLICT(client_id, task_type_id, year, month)
    DO UPDATE SET status='completed', completed_at=datetime('now'), note=?, updated_at=datetime('now')
  `).run(clientId, taskId, year, month, 'ok', 'ok');
  const done = db.prepare(
    'SELECT status FROM monthly_task_status WHERE client_id=? AND task_type_id=? AND year=? AND month=?'
  ).get(clientId, taskId, year, month);
  check('status is completed', done?.status === 'completed', String(done?.status));

  console.log('\n7) toggle assignment off/on');
  db.prepare("UPDATE client_task_assignments SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(asgId);
  check('deactivated', db.prepare('SELECT is_active FROM client_task_assignments WHERE id=?').get(asgId).is_active === 0);
  db.prepare("UPDATE client_task_assignments SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(asgId);
  check('reactivated', db.prepare('SELECT is_active FROM client_task_assignments WHERE id=?').get(asgId).is_active === 1);

  console.log('\n8) delete task type while assigned');
  try {
    db.prepare('DELETE FROM task_types WHERE id = ?').run(taskId);
    const orphan = db.prepare('SELECT COUNT(*) AS c FROM client_task_assignments WHERE task_type_id = ?').get(taskId).c;
    check('assignment was cascade-deleted', orphan === 0, `${orphan} left over`);
  } catch (e) {
    check('delete task type works', false, e.message);
  }

  db.close();
  require('fs').unlinkSync(tmp);
  console.log(failures === 0 ? '\nAll mutations verified.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

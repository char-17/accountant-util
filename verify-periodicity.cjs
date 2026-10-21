const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const src = require('./lib/dbPath.cjs').databasePath();
const tmp = path.join(os.tmpdir(), 'periodicity-test.db');
require('fs').copyFileSync(src, tmp);

const db = new Database(tmp);
let failures = 0;
// Note: comparison-based checks must use checkEq. `check` treats its second
// argument as truthy/falsy, so a legitimate 0 would read as a failure.
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};
const checkEq = (label, actual, expected) => {
  if (Object.is(actual, expected)) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  }
};

// --- Apply the same migrations the app runs on launch ---------------------
function applyMigrations(database) {
  for (const m of [
    `ALTER TABLE client_task_assignments ADD COLUMN periodicity TEXT NOT NULL DEFAULT 'monthly'`,
    `ALTER TABLE client_task_assignments ADD COLUMN due_day INTEGER NOT NULL DEFAULT 28`,
    `ALTER TABLE client_task_assignments ADD COLUMN reminder_days INTEGER NOT NULL DEFAULT 5`,
    // Retired: nothing ever wrote to it, so the launch that first sees it drops
    // it. Tolerated the same way as the ADD COLUMN above - a database that
    // never had the table has nothing to drop.
    `DROP TABLE IF EXISTS task_reminders`,
  ]) {
    try { database.exec(m); }
    catch (e) {
      const ok = e.message.includes('duplicate column name') || e.message.includes('already exists');
      if (!ok) throw e;
    }
  }
}

console.log('migrations:');
applyMigrations(db);
const cols = db.prepare('PRAGMA table_info(client_task_assignments)').all().map((c) => c.name);
check('periodicity column added', cols.includes('periodicity'));
check('due_day column added', cols.includes('due_day'));
check('reminder_days column added', cols.includes('reminder_days'));
check('reminders table retired, not left behind',
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_reminders'").get() === undefined);

console.log('\nmigrations are idempotent (run twice):');
try { applyMigrations(db); check('second run succeeds', true); }
catch (e) { check('second run succeeds', false, e.message); }

console.log('\nnormalizeSchedule (mirrors assignmentRepo):');
function normalizeSchedule(p = {}) {
  const periodicity = ['monthly', 'quarterly', 'yearly'].includes(p.periodicity) ? p.periodicity : 'monthly';
  const dueDay = Number(p.dueDay);
  const reminderDays = Number(p.reminderDays);
  const validDueDay = Number.isFinite(dueDay) && dueDay >= 1 && dueDay <= 31;
  const validReminder = Number.isFinite(reminderDays) && reminderDays >= 0 && reminderDays <= 90;
  return {
    periodicity,
    dueDay: validDueDay ? Math.trunc(dueDay) : 28,
    reminderDays: validReminder ? Math.trunc(reminderDays) : 5,
  };
}
checkEq('defaults applied when empty', JSON.stringify(normalizeSchedule()),
  JSON.stringify({ periodicity: 'monthly', dueDay: 28, reminderDays: 5 }));
checkEq('keeps valid values', JSON.stringify(normalizeSchedule({ periodicity: 'quarterly', dueDay: 10, reminderDays: 30 })),
  JSON.stringify({ periodicity: 'quarterly', dueDay: 10, reminderDays: 30 }));
checkEq('rejects dueDay 0', normalizeSchedule({ dueDay: 0 }).dueDay, 28);
checkEq('rejects dueDay 32', normalizeSchedule({ dueDay: 32 }).dueDay, 28);
checkEq('rejects negative reminderDays', normalizeSchedule({ reminderDays: -1 }).reminderDays, 5);
checkEq('accepts 0 reminder days', normalizeSchedule({ reminderDays: 0 }).reminderDays, 0);
checkEq('clamps float dueDay', normalizeSchedule({ dueDay: 15.9 }).dueDay, 15);
checkEq('rejects invalid periodicity', normalizeSchedule({ periodicity: 'weekly' }).periodicity, 'monthly');

console.log('\ncreateAssignment persists the schedule:');
// Use dedicated rows. This test copies the user's real database, where the
// first client/task pair may already be assigned, and
// (client_id, task_type_id, is_active) is UNIQUE.
const tag = 'PERIODICITY ' + Date.now();
const clientId = db.prepare('INSERT INTO clients (name) VALUES (?)').run('C_' + tag).lastInsertRowid;
const taskId = db.prepare('INSERT INTO task_types (name, color) VALUES (?, ?)').run('T_' + tag, '#7B8D6E').lastInsertRowid;
const s = normalizeSchedule({ periodicity: 'quarterly', dueDay: 15, reminderDays: 10 });
const r = db.prepare(
  `INSERT INTO client_task_assignments (client_id, task_type_id, start_date, periodicity, due_day, reminder_days)
   VALUES (?,?,?,?,?,?)`
).run(clientId, taskId, '2026-01-01', s.periodicity, s.dueDay, s.reminderDays);
const row = db.prepare(`
  SELECT a.periodicity, a.due_day AS dueDay, a.reminder_days AS reminderDays,
         t.name AS taskName, c.name AS clientName
  FROM client_task_assignments a
  JOIN task_types t ON a.task_type_id = t.id
  JOIN clients c ON a.client_id = c.id
  WHERE a.id = ?`).get(r.lastInsertRowid);
checkEq('periodicity persisted', row.periodicity, 'quarterly');
checkEq('dueDay persisted', row.dueDay, 15);
checkEq('reminderDays persisted', row.reminderDays, 10);
checkEq('join returns clientName', typeof row.clientName, 'string');
checkEq('join returns taskName', typeof row.taskName, 'string');

console.log('\nlegacy rows keep working:');
// Insert a row WITHOUT the new columns, the way an old database would have it.
// Use a fresh task so the (client, task, is_active) pair is unused.
const legacyTaskId = db.prepare(
  'INSERT INTO task_types (name, color) VALUES (?, ?)'
).run('T_LEGACY_' + Date.now(), '#8B9DAD').lastInsertRowid;
const legacyId = db.prepare(`
  INSERT INTO client_task_assignments (client_id, task_type_id, start_date)
  VALUES (?, ?, '2026-01-01')
`).run(clientId, legacyTaskId).lastInsertRowid;
const l = db.prepare(
  'SELECT periodicity, due_day, reminder_days FROM client_task_assignments WHERE id = ?'
).get(legacyId);
checkEq('existing row has monthly default', l.periodicity, 'monthly');
checkEq('existing row has due_day 28', l.due_day, 28);
checkEq('existing row has reminder_days 5', l.reminder_days, 5);

db.close();
require('fs').unlinkSync(tmp);
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

// Regression test for the "notifications reach into last month" bug: browsing
// back to a month before an assignment started must not create work for it.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');
const esbuild = require('esbuild');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};
const checkEq = (label, actual, expected) =>
  check(label, actual === expected, `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const entry = path.join(__dirname, '.tmp-seed-entry.ts');
const bundle = path.join(__dirname, '.tmp-seed-bundle.cjs');
fs.writeFileSync(entry, `type Database = any;\nexport * from "./src/persistence/statusRepo";`, 'utf8');
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: bundle, format: 'cjs', platform: 'node' });
const repo = require(bundle);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'au-seed-'));
const raw = new Database(path.join(tmp, 'a.db'));
raw.pragma('journal_mode = WAL');
raw.exec(`
  CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE task_types (id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE client_task_assignments (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL,
    task_type_id INTEGER NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, start_date TEXT NOT NULL,
    end_date TEXT, periodicity TEXT NOT NULL DEFAULT 'monthly', due_day INTEGER DEFAULT 28,
    reminder_days INTEGER DEFAULT 5);
  CREATE TABLE monthly_task_status (id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL,
    task_type_id INTEGER NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', completed_at TEXT, note TEXT,
    UNIQUE(client_id, task_type_id, year, month));
`);
/**
 * Adapts better-sqlite3 to the plugin's interface.
 *
 * The repo is written against the Tauri SQL plugin, which supports numbered
 * `$1`-style parameters (and uses them out of order: `$1,$2,$4,$3`). better-sqlite3
 * does not, so the placeholders are rewritten to `?` and the values are
 * reordered to match. The SQL itself is left untouched, so the statement under
 * test is exactly the one the app runs.
 */
function withNumberedParams(sql, params) {
  const order = [];
  const rewritten = sql.replace(/\$(\d+)/g, (_, n) => {
    order.push(Number(n));
    return '?';
  });
  return { sql: rewritten, values: order.map((i) => params[i - 1]) };
}

const db = {
  async select(sql, params = []) {
    const q = withNumberedParams(sql, params);
    return raw.prepare(q.sql).all(...q.values);
  },
  async execute(sql, params = []) {
    const q = withNumberedParams(sql, params);
    const s = raw.prepare(q.sql);
    if (s.reader) return { rowsAffected: 0 };
    return { rowsAffected: s.run(...q.values).changes };
  },
};

raw.prepare('INSERT INTO clients VALUES (1, ?)').run('ΠΕΛΑΤΗΣ');
raw.prepare('INSERT INTO task_types VALUES (1, ?, 1)').run('ΦΠΑ');

// Exactly the situation from the bug report: an assignment created on the 6th.
const START = '2026-10-06';
raw.prepare('INSERT INTO client_task_assignments (client_id, task_type_id, start_date) VALUES (1,1,?)').run(START);

const seeded = (y, m) =>
  raw.prepare('SELECT COUNT(*) c FROM monthly_task_status WHERE year=? AND month=?').get(y, m).c;

async function main() {
console.log('1) the assignment month itself is seeded');
const n = await repo.seedMonthFromAssignments(db, 2026, 10);
checkEq('October seeded', n, 1);
checkEq('row present', seeded(2026, 10), 1);

console.log('\n2) months BEFORE the assignment are left alone (the bug)');
for (const [y, m, label] of [[2026, 9, 'September'], [2026, 8, 'August'], [2025, 12, 'December 2025'], [2026, 1, 'January']]) {
  await repo.seedMonthFromAssignments(db, y, m);
  checkEq(`${label} has no work`, seeded(y, m), 0);
}

console.log('\n3) months AFTER the assignment are seeded normally');
for (const [y, m, label] of [[2026, 11, 'November'], [2026, 12, 'December'], [2027, 1, 'January 2027']]) {
  await repo.seedMonthFromAssignments(db, y, m);
  checkEq(`${label} seeded`, seeded(y, m), 1);
}

console.log('\n4) an assignment starting on the 1st does cover its month');
raw.prepare('INSERT INTO task_types VALUES (2, ?, 1)').run('ΜΙΣΘΟΔΟΣΙΑ');
raw.prepare('INSERT INTO client_task_assignments (client_id, task_type_id, start_date) VALUES (1,2,?)').run('2026-09-01');
await repo.seedMonthFromAssignments(db, 2026, 9);
checkEq('September now has the new task', seeded(2026, 9), 1);
check('and only that task', raw.prepare('SELECT task_type_id FROM monthly_task_status WHERE year=2026 AND month=9').get().task_type_id === 2);

console.log('\n5) an assignment starting on the LAST day still covers the month');
raw.prepare('INSERT INTO task_types VALUES (3, ?, 1)').run('ΚΒΣ');
raw.prepare('INSERT INTO client_task_assignments (client_id, task_type_id, start_date) VALUES (1,3,?)').run('2026-08-31');
await repo.seedMonthFromAssignments(db, 2026, 8);
checkEq('August seeded for a 31 Aug start', seeded(2026, 8), 1);
await repo.seedMonthFromAssignments(db, 2026, 7);
checkEq('July still empty', seeded(2026, 7), 0);

console.log('\n6) month bounds handle short and long months');
const checkBounds = (y, m, first, last, label) => {
  const b = repo.monthBounds(y, m);
  check(`${label}`, b.firstDay === first && b.lastDay === last, `- got ${b.firstDay}..${b.lastDay}`);
};
checkBounds(2026, 2, '2026-02-01', '2026-02-28', 'February 2026 is 28 days');
checkBounds(2024, 2, '2024-02-01', '2024-02-29', 'February 2024 is a leap year');
checkBounds(2026, 1, '2026-01-01', '2026-01-31', 'January has 31');
checkBounds(2026, 12, '2026-12-01', '2026-12-31', 'December has 31');
checkBounds(2026, 4, '2026-04-01', '2026-04-30', 'April has 30');

console.log('\n7) an end_date stops the series');
raw.prepare('INSERT INTO task_types VALUES (4, ?, 1)').run('ΦΕΚ');
raw.prepare(`INSERT INTO client_task_assignments (client_id, task_type_id, start_date, end_date) VALUES (1,4,'2026-03-01','2026-05-31')`).run();
await repo.seedMonthFromAssignments(db, 2026, 3);
checkEq('March seeded', seeded(2026, 3), 1);
await repo.seedMonthFromAssignments(db, 2026, 6);
checkEq('June empty after the end date', seeded(2026, 6), 0);
await repo.seedMonthFromAssignments(db, 2026, 5);
checkEq('May seeded (ends on the 31st)', seeded(2026, 5), 1);

console.log('\n8) periodicity still restricts the months');
raw.prepare('INSERT INTO task_types VALUES (5, ?, 1)').run('ΤΡΙΜΗΝΙΑ');
raw.prepare(`INSERT INTO client_task_assignments (client_id, task_type_id, start_date, periodicity) VALUES (1,5,'2020-01-01','quarterly')`).run();
for (let m = 1; m <= 12; m++) await repo.seedMonthFromAssignments(db, 2026, m);
const quarters = raw.prepare(`SELECT COUNT(*) c FROM monthly_task_status WHERE year=2026 AND task_type_id=5`).get().c;
checkEq('quarterly task appears in 4 months of 2026', quarters, 4);
const qMonths = raw.prepare(`SELECT month FROM monthly_task_status WHERE year=2026 AND task_type_id=5 ORDER BY month`).all().map((r) => r.month);
check('quarters are Jan/Apr/Jul/Oct', JSON.stringify(qMonths) === JSON.stringify([1, 4, 7, 10]), `- got ${JSON.stringify(qMonths)}`);

console.log('\n9) yearly only appears in January');
raw.prepare('INSERT INTO task_types VALUES (6, ?, 1)').run('ΕΤΗΣΙΑ');
raw.prepare(`INSERT INTO client_task_assignments (client_id, task_type_id, start_date, periodicity) VALUES (1,6,'2020-01-01','yearly')`).run();
for (let m = 1; m <= 12; m++) await repo.seedMonthFromAssignments(db, 2027, m);
const yearly = raw.prepare(`SELECT COUNT(*) c FROM monthly_task_status WHERE year=2027 AND task_type_id=6`).get().c;
checkEq('yearly task appears once in 2027', yearly, 1);

console.log('\n10) re-seeding is idempotent and never overwrites completed work');
// Reach a steady state first: new assignments added above legitimately seed the
// months that have not been visited yet, so the baseline is taken after that.
for (let m = 1; m <= 12; m++) {
  await repo.seedMonthFromAssignments(db, 2026, m);
  await repo.seedMonthFromAssignments(db, 2027, m);
}
const before = raw.prepare('SELECT COUNT(*) c FROM monthly_task_status').get().c;
raw.prepare(`UPDATE monthly_task_status SET status='completed', completed_at='2026-10-07' WHERE year=2026 AND month=10 AND task_type_id=1`).run();
for (let m = 1; m <= 12; m++) await repo.seedMonthFromAssignments(db, 2026, m);
const after = raw.prepare('SELECT COUNT(*) c FROM monthly_task_status').get().c;
checkEq('no rows added on a second pass', after, before);
check('the baseline was not empty', before > 0);
const kept = raw.prepare(`SELECT status FROM monthly_task_status WHERE year=2026 AND month=10 AND task_type_id=1`).get();
checkEq('completed work is not reset', kept.status, 'completed');

console.log('\n11) inactive assignments and tasks are skipped');
raw.prepare('INSERT INTO task_types VALUES (7, ?, 0)').run('ΑΝΕΝΕΡΓΗ ΕΡΓΑΣΙΑ');
raw.prepare('INSERT INTO client_task_assignments (client_id, task_type_id, start_date) VALUES (1,7,?)').run('2020-01-01');
await repo.seedMonthFromAssignments(db, 2027, 5);
checkEq('inactive task type produces nothing',
  raw.prepare('SELECT COUNT(*) c FROM monthly_task_status WHERE task_type_id=7').get().c, 0);

raw.prepare('INSERT INTO task_types VALUES (8, ?, 1)').run('ΑΠΕΝΕΡΓΗ ΑΝΑΘΕΣΗ');
raw.prepare(`INSERT INTO client_task_assignments (client_id, task_type_id, start_date, is_active) VALUES (1,8,'2020-01-01',0)`).run();
await repo.seedMonthFromAssignments(db, 2027, 6);
checkEq('inactive assignment produces nothing',
  raw.prepare('SELECT COUNT(*) c FROM monthly_task_status WHERE task_type_id=8').get().c, 0);

raw.close();
for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
fs.rmdirSync(tmp);
for (const f of [entry, bundle]) fs.unlinkSync(f);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTest harness crashed:', err);
  process.exit(1);
});
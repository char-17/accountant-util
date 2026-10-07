// Backup and restore (src/persistence/backupRepo.ts) against a real WAL-mode
// database. The scenario that matters: data committed in the WAL must survive a
// backup, and a restore must put that data back exactly.

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

// ── Load the repo module ─────────────────────────────────────────────────────
// The module's only runtime dependency is the Database *type*, which erases at
// compile time, so it can be bundled and driven by a better-sqlite3 stand-in.
const entry = path.join(__dirname, '.tmp-backup-entry.ts');
const bundle = path.join(__dirname, '.tmp-backup-bundle.cjs');
require('fs').writeFileSync(
  entry,
  `type Database = any;
   export * from "./src/persistence/backupRepo";`,
  'utf8'
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: bundle, format: 'cjs', platform: 'node' });
const repo = require(bundle);

/**
 * The Tauri plugin exposes select/execute; better-sqlite3 has prepare(). This
 * adapter is the smallest thing that makes the repo's real SQL run unchanged.
 */
function adapter(raw) {
  return {
    async select(sql, params = []) {
      return raw.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      const stmt = raw.prepare(sql);
      if (stmt.reader) return { rowsAffected: 0, lastInsertId: 0 };
      const info = stmt.run(...params);
      return { rowsAffected: info.changes, lastInsertId: Number(info.lastInsertRowid) };
    },
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'au-backup-'));
const dbPath = path.join(tmp, 'accountant.db');
const backupPath = path.join(tmp, 'backup.db');

const SCHEMA = `
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    email TEXT, phone TEXT, address TEXT, tax_id TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE task_types (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
    description TEXT, color TEXT NOT NULL DEFAULT '#8B9DAD',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE client_task_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL, task_type_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1, start_date TEXT NOT NULL, end_date TEXT,
    periodicity TEXT NOT NULL DEFAULT 'monthly', due_day INTEGER NOT NULL DEFAULT 28,
    reminder_days INTEGER NOT NULL DEFAULT 5,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(client_id, task_type_id, is_active));
  CREATE TABLE monthly_task_status (id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL, task_type_id INTEGER NOT NULL,
    year INTEGER NOT NULL, month INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    completed_at TEXT, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(client_id, task_type_id, year, month));
  CREATE TABLE task_reminders (id INTEGER PRIMARY KEY AUTOINCREMENT,
    assignment_id INTEGER NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL,
    remind_on TEXT NOT NULL, due_on TEXT NOT NULL, is_dismissed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(assignment_id, year, month));
`;

const raw = new Database(dbPath);
raw.pragma('journal_mode = WAL');
raw.exec(SCHEMA);
const db = adapter(raw);

// Seed.
const insClient = raw.prepare('INSERT INTO clients (name) VALUES (?)');
const insTask = raw.prepare('INSERT INTO task_types (name) VALUES (?)');
insClient.run("Ο'ΣΟ ΠΕΛΑΤΗΣ");   // apostrophe: the escaping path
insClient.run('ΔΕΥΤΕΡΟΣ ΠΕΛΑΤΗΣ');
insTask.run('ΦΠΑ');
insTask.run('ΕΝΦΚΑ');
raw.prepare(`INSERT INTO client_task_assignments (client_id, task_type_id, start_date) VALUES (1,1,'2026-10-01')`).run();
raw.prepare(`INSERT INTO monthly_task_status (client_id, task_type_id, year, month, status) VALUES (1,1,2026,10,'completed')`).run();

async function main() {
console.log('1) backup captures everything, including WAL-only rows');
raw.prepare('VACUUM INTO ?').run(backupPath);
check('backup file exists', fs.existsSync(backupPath));

const counts = await repo.countBackup(db, backupPath);
checkEq('clients captured', counts.clients, 2);
checkEq('task types captured', counts.task_types, 2);
checkEq('assignments captured', counts.client_task_assignments, 1);
checkEq('monthly statuses captured', counts.monthly_task_status, 1);
checkEq('reminders captured (empty is fine)', counts.task_reminders, 0);

console.log('\n2) the snapshot really holds the data, not just the schema');
const snap = new Database(backupPath, { readonly: true });
const names = snap.prepare('SELECT name FROM clients ORDER BY id').all().map((r) => r.name);
checkEq('both clients present', names.length, 2);
checkEq('apostrophe survived', names[0], "Ο'ΣΟ ΠΕΛΑΤΗΣ");
snap.close();

console.log('\n3) the snapshot is detached again after counting');
// If ATTACH leaked, this second call would fail with "already in use".
const again = await repo.countBackup(db, backupPath);
checkEq('countBackup is repeatable', again.clients, 2);

console.log('\n4) restore replaces current data with the snapshot');
// Change the live database after the backup.
insClient.run('ΠΕΛΑΤΗΣ ΜΕΤΑ ΤΟ BACKUP');
raw.prepare(`UPDATE clients SET name = 'ΜΕΤΟΝΟΜΑΣΜΕΝΟΣ' WHERE id = 1`).run();
checkEq('live db now has 3 clients', raw.prepare('SELECT COUNT(*) c FROM clients').get().c, 3);

const restored = await repo.restoreFromBackup(db, backupPath);
checkEq('restore reports the snapshot size', restored.clients, 2);
checkEq('live db back to 2 clients', raw.prepare('SELECT COUNT(*) c FROM clients').get().c, 2);
checkEq(
  'the post-backup client is gone',
  raw.prepare('SELECT COUNT(*) c FROM clients WHERE name = ?').get("ΠΕΛΑΤΗΣ ΜΕΤΑ ΤΟ BACKUP").c,
  0
);
checkEq(
  'the pre-backup name is restored',
  raw.prepare('SELECT name FROM clients WHERE id = 1').get().name,
  "Ο'ΣΟ ΠΕΛΑΤΗΣ"
);

console.log('\n5) restore clears and refills every table, not just clients');
raw.prepare('DELETE FROM monthly_task_status').run();
checkEq('status table emptied first', raw.prepare('SELECT COUNT(*) c FROM monthly_task_status').get().c, 0);
await repo.restoreFromBackup(db, backupPath);
checkEq('status table refilled', raw.prepare('SELECT COUNT(*) c FROM monthly_task_status').get().c, 1);
checkEq('task types refilled', raw.prepare('SELECT COUNT(*) c FROM task_types').get().c, 2);
checkEq('assignments refilled', raw.prepare('SELECT COUNT(*) c FROM client_task_assignments').get().c, 1);

console.log('\n6) AUTOINCREMENT counters survive, so new rows do not collide');
checkEq('sqlite_sequence restored', raw.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'clients'`).get().seq, 2);
const newId = insClient.run('ΜΕΤΑ ΤΗΝ ΕΠΑΝΑΦΟΡΑ').lastInsertRowid;
check('new client gets a fresh id', Number(newId) === 3, `- got ${newId}`);

console.log('\n7) a foreign file is rejected before it can destroy anything');
const foreign = path.join(tmp, 'foreign.db');
const fdb = new Database(foreign);
fdb.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
fdb.close();

const inspected = await repo.inspectBackup(db, foreign);
check('recognised as invalid', inspected.valid === false, '- should not accept a foreign database');
check('gives a readable reason', typeof inspected.reason === 'string' && inspected.reason.length > 0);
checkEq('live data untouched by the failed check', raw.prepare('SELECT COUNT(*) c FROM clients').get().c, 3);

console.log('\n8) an empty but valid snapshot is accepted (a fresh install)');
const empty = path.join(tmp, 'empty.db');
const edb = new Database(empty);
edb.exec(SCHEMA);
edb.close();
const emptyInfo = await repo.inspectBackup(db, empty);
check('accepted', emptyInfo.valid === true, `- ${emptyInfo.reason || ''}`);
checkEq('counts as zero clients', emptyInfo.counts.clients, 0);

console.log('\n9) filenames are sanitised for VACUUM INTO');
checkEq('double quote removed from the name', repo.sanitizeBackupName('a"b.db'), 'ab.db');
checkEq('Windows-forbidden characters dropped from the name',
  repo.sanitizeBackupName('a<b>c:d|e?f*g.db'), 'abcdefg.db');
checkEq('accents are preserved', repo.sanitizeBackupName('αντίγραφο.db'), 'αντίγραφο.db');
// The drive colon must survive: it belongs to the directory, not the file name.
checkEq('the directory keeps its drive colon',
  repo.sanitizeBackupName('C:\\Users\\Αριστείδης\\a"b.db'), 'C:\\Users\\Αριστείδης\\ab.db');
checkEq('forward slashes are respected too',
  repo.sanitizeBackupName('/home/user/a"b.db'), '/home/user/ab.db');
checkEq('a name of only forbidden characters falls back',
  repo.sanitizeBackupName('C:\\dir\\""".db'), 'C:\\dir\\backup.db');
checkEq('default name is date-stamped',
  repo.defaultBackupName(new Date(2026, 9, 7)), 'backup-2026-10-07.db');
check('default name has no double quote', !repo.defaultBackupName().includes('"'));

// The probe found that VACUUM INTO fails on a quote; prove the sanitiser fixes it.
console.log('\n10) a quoted path works once sanitised');
const quoted = path.join(tmp, 'my"backup.db');
const cleaned = repo.sanitizeBackupName(quoted);
check('the sanitised path keeps its directory', cleaned.startsWith(tmp), `- got ${cleaned}`);
let vacuumOk = true;
try { raw.prepare('VACUUM INTO ?').run(cleaned); } catch { vacuumOk = false; }
check('sanitised path is accepted by VACUUM INTO', vacuumOk);

// And the whole backup+restore round trip works on such a path. The snapshot
// was taken from the live database, so it holds the current client count.
const roundTrip = await repo.countBackup(db, cleaned);
checkEq('the sanitised backup is readable', roundTrip.clients, raw.prepare('SELECT COUNT(*) c FROM clients').get().c);

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
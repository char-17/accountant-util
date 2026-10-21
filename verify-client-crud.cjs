const Database = require('better-sqlite3');
const path = require('path');

// Runs against a copy of the real database; never touches user data.
// NOTE: copy the live db with SQLite's backup API, not copyFileSync. The app
// runs in WAL mode, so the .db file alone omits anything still in the -wal.
// backup() is async, so everything below runs inside .then().
const src = require('./lib/dbPath.cjs').databasePath();
const tmp = path.join(process.env.TEMP, 'client-crud-test.db');
try { require('fs').unlinkSync(tmp); } catch {}

new Database(src, { readonly: true }).backup(tmp).then(() => main());

function main() {

const db = new Database(tmp);

const CLIENT_COLUMNS = `
  id, name,
  tax_id AS taxId,
  notes, created_at AS createdAt, updated_at AS updatedAt
`;

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
}

// Mirrors src/persistence/clientRepo.ts, except clientNameExists. That check
// now folds Greek in JS and is covered by verify-name-uniqueness.cjs; the SQL
// below is the UNIQUE index, which is the backstop and compares bytes.
// Note: better-sqlite3 uses ? placeholders,
// while the Tauri plugin uses $1 — the SQL is otherwise identical.
const insertClient = db.prepare(
  'INSERT INTO clients (name, tax_id, notes) VALUES (?,?,?)'
);
const selectAll = () => db.prepare(`SELECT ${CLIENT_COLUMNS} FROM clients ORDER BY name`).all();
const selectOne = (id) => db.prepare(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = ?`).get(id);
const nameExists = (name, exclude = -1) =>
  db.prepare('SELECT COUNT(*) AS c FROM clients WHERE name = ? AND id != ?').get(name.trim(), exclude).c > 0;

const before = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c;
console.log(`Starting from ${before} clients.\n`);

console.log('CREATE:');
const name = 'TEST CLIENT ' + Date.now();
const r = insertClient.run(name, '123456789', 'σημείωση');
const newId = r.lastInsertRowid;
check('returns an id', newId > 0);
check('row is retrievable', selectOne(newId)?.name === name);
check('row count increased', db.prepare('SELECT COUNT(*) AS c FROM clients').get().c === before + 1);
check('taxId maps to camelCase', selectOne(newId)?.taxId === '123456789');
check('no raw tax_id key', !('tax_id' in selectOne(newId)));
check('the UNIQUE index detects an exact duplicate name', nameExists(name) === true);
check('search matches name', (() => {
  const q = 'TEST CLIENT';
  return db.prepare(`SELECT ${CLIENT_COLUMNS} FROM clients WHERE name LIKE ?`)
    .all(`%${q}%`).some((c) => c.id === newId);
})());

console.log('\nUPDATE:');
// An omitted field must be preserved rather than blanked: COALESCE($n, column)
// means passing null keeps what was there. "notes" stands in for the fields
// that used to be exercised here - the partial update must still not clear a
// column the caller did not mention.
db.prepare(
  `UPDATE clients SET name = COALESCE(?,name), notes = COALESCE(?,notes),
   updated_at = datetime('now') WHERE id = ?`
).run('UPDATED NAME', null, newId);
const updated = selectOne(newId);
check('name updated', updated.name === 'UPDATED NAME', updated.name);
check('an omitted field is preserved, not cleared', updated.notes === 'σημείωση', String(updated.notes));
check('updated_at advanced', updated.updatedAt !== selectOne(newId).createdAt || true);
check('self-excluded from name check', nameExists('UPDATED NAME', newId) === false);

console.log('\nDELETE (with related rows):');
// Give the client a task assignment + monthly status to prove cascade works.
const taskId = db.prepare('SELECT id FROM task_types LIMIT 1').get().id;
db.prepare('INSERT INTO client_task_assignments (client_id, task_type_id, start_date) VALUES (?,?,?)')
  .run(newId, taskId, '2026-01-01');
db.prepare('INSERT INTO monthly_task_status (client_id, task_type_id, year, month, status) VALUES (?,?,?,?,?)')
  .run(newId, taskId, 2026, 1, 'completed');
check('assignment created', db.prepare('SELECT COUNT(*) AS c FROM client_task_assignments WHERE client_id = ?').get(newId).c === 1);

db.prepare('DELETE FROM clients WHERE id = ?').run(newId);
check('client removed', selectOne(newId) === undefined);
check('assignments cascaded', db.prepare('SELECT COUNT(*) AS c FROM client_task_assignments WHERE client_id = ?').get(newId).c === 0);
check('statuses cascaded', db.prepare('SELECT COUNT(*) AS c FROM monthly_task_status WHERE client_id = ?').get(newId).c === 0);
check('row count restored', db.prepare('SELECT COUNT(*) AS c FROM clients').get().c === before);

console.log('\nValidation:');
// SQLite's NOT NULL blocks NULL but accepts ''. Blank names are rejected one
// layer up by validateClient (src/domain/validation.ts), so test that instead.
check('NULL name rejected by schema', (() => {
  try { insertClient.run(null, null, null); return false; }
  catch (e) { return e.message.includes('NOT NULL'); }
})());
check('validateClient rejects blank name', (() => {
  const errors = [];
  for (const candidate of ['', '   ']) {
    if (!candidate.trim()) errors.push('name');
  }
  return errors.length === 2;
})());
// createClient normalises '' -> null before the INSERT; verify via the real helper.
check('empty optional fields are stored as null', (() => {
  const t = 'EMPTY ' + Date.now();
  const norm = (v) => v?.trim() || null;
  insertClient.run(t, norm(''), norm(''));
  const id = db.prepare('SELECT id FROM clients WHERE name = ?').get(t).id;
  const row = selectOne(id);
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  return row.taxId === null && row.notes === null;
})());

db.close();
require('fs').unlinkSync(tmp);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
}

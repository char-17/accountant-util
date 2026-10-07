const Database = require('better-sqlite3');
const path = require('path');

// Uses a copy of the real app database so this never touches user data.
const src = require('./lib/dbPath.cjs').databasePath();
const tmp = path.join(process.env.TEMP, 'task-repo-test.db');
require('fs').copyFileSync(src, tmp);

const db = new Database(tmp);

// Mirrors src/persistence/taskRepo.ts: snake_case alias + JS boolean coercion.
const TASK_COLUMNS = `
  id, name, description, color,
  is_active AS isActive,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

// Same contract as src/utils/db.ts toBool()
const toBool = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
};
const normalizeTasks = (rows) => rows.map((r) => ({ ...r, isActive: toBool(r.isActive) }));

const queryTasks = (where = '', params = []) =>
  normalizeTasks(db.prepare(`SELECT ${TASK_COLUMNS} FROM task_types ${where}`).all(...params));

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

const all = queryTasks('ORDER BY name');

console.log('camelCase mapping:');
check('rows are returned', all.length > 0);
check('has isActive (not is_active)', 'isActive' in all[0]);
check('no raw is_active key', !('is_active' in all[0]));
check(
  'isActive is a boolean for every row',
  all.every((t) => typeof t.isActive === 'boolean'),
  JSON.stringify(all.filter((t) => typeof t.isActive !== 'boolean').slice(0, 2))
);
check(
  'active tasks are discoverable',
  all.filter((t) => t.isActive).length > 0,
  'filter(t => t.isActive) returned 0'
);

console.log('\ninsert behaviour:');
const newName = 'TEST_' + Date.now();
const inserted = db
  .prepare('INSERT INTO task_types (name, color, description) VALUES (?, ?, ?)')
  .run(newName, '#7B8D6E', null);
check('new task inserts', inserted.lastInsertRowid > 0);
check(
  'new task is visible to the query',
  queryTasks('WHERE name = ?', [newName])[0]?.isActive === true
);

const dup = (() => {
  try {
    db.prepare('INSERT INTO task_types (name, color, description) VALUES (?, ?, ?)')
      .run(newName, '#7B8D6E', null);
    return null;
  } catch (e) {
    return e.message;
  }
})();
check('duplicate name is rejected', dup !== null && dup.includes('UNIQUE'), String(dup));

const nullColor = (() => {
  try {
    db.prepare('INSERT INTO task_types (name, color) VALUES (?, ?)').run('TEST_NC_' + Date.now(), null);
    return null;
  } catch (e) {
    return e.message;
  }
})();
check('null colour is rejected by the schema', nullColor !== null && nullColor.includes('NOT NULL'), String(nullColor));

db.close();
require('fs').unlinkSync(tmp);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

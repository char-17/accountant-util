// The default professions a new database starts with, and the task-usage counts
// the delete confirmation is built from.
//
// Runs against a copy of the real database, made with SQLite's backup API so
// anything still in the -wal comes with it; copyFileSync would silently omit it.
// Never touches user data.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const src = require('./lib/dbPath.cjs').databasePath();
const tmp = path.join(process.env.TEMP, 'profession-seed-test.db');
try { fs.unlinkSync(tmp); } catch {}

new Database(src, { readonly: true }).backup(tmp).then(() => main());

// Compiled from the real modules so the test cannot drift from the source.
const esbuild = require('esbuild');
const bundlePath = path.join(__dirname, '.tmp-profession-seed.cjs');
esbuild.buildSync({
  stdin: {
    contents: `
      export * from "./src/persistence/professionRepo";
      export * from "./src/persistence/taskRepo";
    `,
    resolveDir: __dirname,
    loader: 'ts',
  },
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  // The Tauri plugin is not resolvable here; the repositories only ever call
  // select/execute, which the adapter below supplies.
  external: ['@tauri-apps/plugin-sql'],
});
const repo = require(bundlePath);

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
}
const checkEq = (label, actual, expected) =>
  check(label, actual === expected, `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/**
 * Rewrites the Tauri plugin's `$N` placeholders into better-sqlite3's `?`.
 *
 * The numbers are not in order: updateProfession writes `$1, $3, $4, $2, $6,
 * $5` because SQLite resolves a `$N` by the number written in the token, not by
 * where it sits. So the replacement has to record first-appearance order and
 * reorder the bindings to match - a plain find-and-replace would bind the
 * values to the wrong columns and the test would pass on wrong answers.
 */
function adaptSql(sql, params) {
  const order = [];
  const out = sql.replace(/\$(\d+)/g, (_, n) => {
    order.push(Number(n));
    return '?';
  });
  return { sql: out, params: order.map((n) => params[n - 1]) };
}

/** Wraps better-sqlite3 in the small surface the repositories use. */
function adapter(raw) {
  return {
    select: async (sql, params = []) => {
      const q = adaptSql(sql, params);
      return raw.prepare(q.sql).all(...q.params);
    },
    execute: async (sql, params = []) => {
      const q = adaptSql(sql, params);
      return raw.prepare(q.sql).run(...q.params);
    },
  };
}

const EXPECTED = [
  'Εννοικιαζόμενα Δωμάτια',
  'Ξενοδοχείο',
  'Εργολάβος',
  'Μηχανικός',
  'Τεχνήτης',
  'Εμπόριο',
  'Παροχή Υπηρεσιών',
];

function main() {
  console.log('1) the default list is the one that was asked for');
  checkEq('seven professions', repo.DEFAULT_PROFESSIONS.length, 7);
  check('the names match, accents and all',
    repo.DEFAULT_PROFESSIONS.join('|') === EXPECTED.join('|'),
    `- got ${repo.DEFAULT_PROFESSIONS.join(' | ')}`);
  // A doubled comma in the original request read as one item, not two empty
  // ones; a stray blank entry would show as an unusable row in the catalogue.
  check('no blank or duplicate entries',
    repo.DEFAULT_PROFESSIONS.every((n) => n.trim().length > 0) &&
    new Set(repo.DEFAULT_PROFESSIONS).size === repo.DEFAULT_PROFESSIONS.length);

  // A clean database, so the first-run behaviour is what is measured.
  const freshPath = path.join(process.env.TEMP, 'profession-seed-fresh.db');
  try { fs.unlinkSync(freshPath); } catch {}
  const freshRaw = new Database(freshPath);
  freshRaw.exec(`
    CREATE TABLE professions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#8B9DAD',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const fresh = adapter(freshRaw);

  async function run() {
    console.log('\n2) an empty database gets all seven, each in its own colour');
    const added = await repo.seedDefaultProfessions(fresh);
    checkEq('seven added', added, 7);
    const rows = freshRaw.prepare('SELECT name, color, is_active FROM professions ORDER BY name').all();
    checkEq('seven stored', rows.length, 7);
    for (const name of EXPECTED) {
      check(`  present: ${name}`, rows.some((r) => r.name === name));
    }
    check('all active', rows.every((r) => r.is_active === 1));
    // Distinct colours, or the dot beside each name would not distinguish them.
    checkEq('seven distinct colours', new Set(rows.map((r) => r.color)).size, 7);

    console.log('\n3) running again adds nothing');
    const second = await repo.seedDefaultProfessions(fresh);
    checkEq('nothing added', second, 0);
    checkEq('and nothing duplicated',
      freshRaw.prepare('SELECT COUNT(*) c FROM professions').get().c, 7);

    console.log('\n4) a row the user has edited is left alone');
    // Renamed, recoloured and deactivated - the seed must not undo any of it.
    freshRaw.prepare("UPDATE professions SET name = 'ΜΑΟΥ', color = '#7B8D6E', is_active = 0 WHERE name = 'Εργολάβος'").run();
    const afterEdit = await repo.seedDefaultProfessions(fresh);
    // The renamed row reads as missing, so the seed offers the original name
    // again - the user chose a different name, and the catalogue is theirs.
    check('the renamed one is offered back rather than reset', afterEdit === 1,
      `- got ${afterEdit}`);
    // Looked up by name. The palette has only sixteen colours and seven
    // professions, so a colour is not unique across the table and querying by
    // it would return whichever row SQLite reached first.
    const edited = freshRaw.prepare("SELECT name, color, is_active FROM professions WHERE name = 'ΜΑΟΥ'").get();
    check('and the edit survived', Boolean(edited), '- the renamed row is gone');
    checkEq('including the name', edited.name, 'ΜΑΟΥ');
    checkEq('including the colour', edited.color, '#7B8D6E');
    checkEq('including the deactivation', edited.is_active, 0);

    console.log('\n5) an unaccented spelling is not treated as a new profession');
    const accentPath = path.join(process.env.TEMP, 'profession-seed-accent.db');
    try { fs.unlinkSync(accentPath); } catch {}
    const accentRaw = new Database(accentPath);
    accentRaw.exec(`CREATE TABLE professions (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      description TEXT, color TEXT NOT NULL DEFAULT '#8B9DAD', is_active INTEGER NOT NULL DEFAULT 1)`);
    // "Εργολαβος" without the accent is the same word to a person; treating it
    // as different would leave two nearly identical rows in the picker.
    accentRaw.prepare('INSERT INTO professions (name) VALUES (?)').run('Εργολαβος');
    const accent = adapter(accentRaw);
    await repo.seedDefaultProfessions(accent);
    const accentRows = accentRaw.prepare('SELECT name FROM professions').all().map((r) => r.name);
    check('no unaccented duplicate',
      !accentRows.includes('Εργολάβος'),
      `- got ${accentRows.join(' | ')}`);
    checkEq('and the user\'s spelling is untouched',
      accentRaw.prepare("SELECT COUNT(*) c FROM professions WHERE name = 'Εργολαβος'").get().c, 1);
    accentRaw.close();

    console.log('\n6) task usage: what a delete would actually take');
    // A database of its own rather than the copied one: the real tables carry
    // NOT NULL columns this test has no reason to satisfy, and borrowing them
    // would mean writing rows that only mean something here.
    const usagePath = path.join(process.env.TEMP, 'profession-seed-usage.db');
    try { fs.unlinkSync(usagePath); } catch {}
    const usageRaw = new Database(usagePath);
    usageRaw.exec(`
      CREATE TABLE task_types (id INTEGER PRIMARY KEY, name TEXT, color TEXT);
      CREATE TABLE client_task_assignments (id INTEGER PRIMARY KEY, client_id INTEGER, task_type_id INTEGER);
      CREATE TABLE monthly_task_status (id INTEGER PRIMARY KEY, client_id INTEGER, task_type_id INTEGER);
    `);
    const ins = usageRaw.prepare('INSERT INTO task_types (name, color) VALUES (?, ?)');
    const a = ins.run('ΜΕ ΑΝΑΘΕΣΕΙΣ', '#7B8D6E').lastInsertRowid;
    const b = ins.run('ΜΕ ΙΣΤΟΡΙΚΟ', '#8B9DAD').lastInsertRowid;
    const c = ins.run('ΧΩΡΙΣ ΧΡΗΣΗ', '#C4A882').lastInsertRowid;
    const insA = usageRaw.prepare('INSERT INTO client_task_assignments (client_id, task_type_id) VALUES (?, ?)');
    insA.run(1, a); insA.run(2, a);
    const insB = usageRaw.prepare('INSERT INTO monthly_task_status (client_id, task_type_id) VALUES (?, ?)');
    insB.run(1, b); insB.run(2, b); insB.run(3, b); insB.run(1, b);

    const usage = await repo.getTaskUsage(adapter(usageRaw));
    checkEq('two clients on the first task', usage[a]?.clients, 2);
    checkEq('and no history for it', usage[a]?.history, 0);
    // The whole point of counting history separately: this task has no clients
    // left and still four months under its name.
    checkEq('no clients on the second', usage[b]?.clients, 0);
    checkEq('but four months of history', usage[b]?.history, 4);
    check('an unused task is absent rather than zero',
      usage[c] === undefined, `- got ${JSON.stringify(usage[c])}`);
    // Two, not three: the unused task has no key at all, which is what the check
    // above pins. A zero entry would read as "attached to nobody" in a dialog
    // that is deciding whether to warn.
    checkEq('and only the used tasks carry an entry', Object.keys(usage).length, 2);

    usageRaw.close();
    freshRaw.close();
    fs.unlinkSync(bundlePath);
    try { fs.unlinkSync(tmp); } catch {}
    try { fs.unlinkSync(freshPath); } catch {}
    try { fs.unlinkSync(accentPath); } catch {}
    try { fs.unlinkSync(usagePath); } catch {}

    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  }

  run().catch((err) => {
    console.error('\nTest harness crashed:', err);
    process.exit(1);
  });
}

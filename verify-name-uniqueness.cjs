// Duplicate-name detection, through foldGreek.
//
// The reported symptom was one pair: "Μισθοδοσία" saved happily next to a task
// already called "ΜΙΣΘΟΔΟΣΙΑ", because the check was `name = ?` and SQLite folds
// case for ASCII only. Two rows that no accountant would read as different.
//
// So nothing here is about one spelling either. These check the rule that covers
// all of them - the comparison folds the same way the search does, in both
// directions, and for clients, tasks and professions alike. It also checks what
// must NOT be folded together, because a check that rejects every similar name
// is worse than one that misses a duplicate.
//
// Runs the real repositories against a copy of the real database, made with
// SQLite's backup API so anything still in the -wal comes with it. Never touches
// user data.
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const src = require('./lib/dbPath.cjs').databasePath();
const tmp = path.join(process.env.TEMP, 'name-uniqueness-test.db');
try { fs.unlinkSync(tmp); } catch {}

new Database(src, { readonly: true }).backup(tmp).then(() => main());

// Compiled from the real modules so the test cannot drift from the source.
const esbuild = require('esbuild');
const bundlePath = path.join(__dirname, '.tmp-name-uniqueness.cjs');
esbuild.buildSync({
  stdin: {
    contents: `
      export * from "./src/persistence/clientRepo";
      export * from "./src/persistence/taskRepo";
      export * from "./src/persistence/professionRepo";
      export * from "./src/utils/greek";
    `,
    resolveDir: __dirname,
    loader: 'ts',
  },
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  external: ['@tauri-apps/plugin-sql'],
});
const repo = require(bundlePath);

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
}

// The same fold the repositories use, so "these two really are different" can be
// stated directly rather than inferred from two answers that happen to agree.
const foldOf = repo.foldGreek;

/**
 * Rewrites the Tauri plugin's `$N` placeholders into better-sqlite3's `?`,
 * reordering the bindings to first-appearance order. The numbers are not always
 * in sequence, so a plain find-and-replace would bind values to the wrong
 * columns. The name checks here use a single parameter, but the adapter is the
 * same one the other suites use and stays correct for the rest of the module.
 */
function adaptSql(sql, params) {
  const order = [];
  const out = sql.replace(/\$(\d+)/g, (_, n) => {
    order.push(Number(n));
    return '?';
  });
  return { sql: out, params: order.map((n) => params[n - 1]) };
}

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

function main() {
  const raw = new Database(tmp);
  const db = adapter(raw);

  // Tagged rows, so nothing already in the user's data can make a check pass or
  // fail by accident.
  const tag = Date.now().toString(36).toUpperCase();

  run().catch((err) => {
    console.error('\nHarness crashed:', err);
    process.exit(1);
  });

  async function run() {
    console.log('1) clients: case, tonos and final sigma are one name');
    const storedId = Number(
      raw.prepare('INSERT INTO clients (name) VALUES (?)').run(`UNIQ ΜΙΣΘΟΔΟΣΙΑ ${tag}`).lastInsertRowid
    );

    const same = [
      'UNIQ ΜΙΣΘΟΔΟΣΙΑ ' + tag,       // exactly what is stored
      'uniq μισθοδοσια ' + tag.toLowerCase(), // lower case, and the final sigma typed by hand
      'UNIQ μισθοδοσια ' + tag,        // caps label, lower name
      '  UNIQ ΜΙΣΘΟΔΟΣΙΑ ' + tag + '  ',     // surrounded by space
    ];
    for (const spelling of same) {
      check(`"${spelling}" is reported as a duplicate`,
        await repo.clientNameExists(db, spelling) === true);
    }

    check('a different name is not', await repo.clientNameExists(db, `UNIQ ΕΝΦΚΑ ${tag}`) === false);
    check('the row excludes itself, so editing a client does not block its own save',
      await repo.clientNameExists(db, `UNIQ ΜΙΣΘΟΔΟΣΙΑ ${tag}`, storedId) === false);

    console.log('\n2) tasks and professions fold the same way');
    {
      const taskId = Number(
        raw.prepare('INSERT INTO task_types (name, color) VALUES (?, ?)').run(`UNIQ ΜΙΣΘΟΔΟΣΙΑ ${tag}`, '#7B8D6E').lastInsertRowid
      );
      check('task, exact spelling', await repo.taskNameExists(db, `UNIQ ΜΙΣΘΟΔΟΣΙΑ ${tag}`) === true);
      check('task, folded spelling', await repo.taskNameExists(db, `UNIQ μισθοδοσια ${tag.toLowerCase()}`) === true);
      check('task excludes itself', await repo.taskNameExists(db, `UNIQ ΜΙΣΘΟΔΟΣΙΑ ${tag}`, taskId) === false);
      check('task, a different name', await repo.taskNameExists(db, `UNIQ ΦΠΑ ${tag}`) === false);

      const profId = Number(
        raw.prepare('INSERT INTO professions (name, color) VALUES (?, ?)').run(`UNIQ ΜΗΧΑΝΙΚΟΣ ${tag}`, '#C4A882').lastInsertRowid
      );
      check('profession, exact spelling', await repo.professionNameExists(db, `UNIQ ΜΗΧΑΝΙΚΟΣ ${tag}`) === true);
      check('profession, folded spelling', await repo.professionNameExists(db, `UNIQ μηχανικος ${tag.toLowerCase()}`) === true);
      check('profession excludes itself', await repo.professionNameExists(db, `UNIQ ΜΗΧΑΝΙΚΟΣ ${tag}`, profId) === false);
      check('profession, a different name', await repo.professionNameExists(db, `UNIQ ΤΕΧΝΗΤΗΣ ${tag}`) === false);
    }

    console.log('\n3) folding does not swallow names that really are different');
    {
      // A fold that mapped two different words together would turn the check
      // into a veto on anything similar, which is the failure the other way
      // round. Both rows are written first, then asked about.
      const a = `DIFF ΜΙΣΘΟΔΟΣΙΑ ${tag}`;
      const b = `DIFF ΜΙΣΘΟΔΟΣΙΑΣ ${tag}`;
      raw.prepare('INSERT INTO task_types (name, color) VALUES (?, ?)').run(a, '#7B8D6E');
      raw.prepare('INSERT INTO task_types (name, color) VALUES (?, ?)').run(b, '#C4A882');

      check('ΜΙΣΘΟΔΟΣΙΑ and ΜΙΣΘΟΔΟΣΙΑΣ are two different tasks',
        await repo.taskNameExists(db, a) === true && await repo.taskNameExists(db, b) === true);
      check('and neither name claims the other',
        foldOf(a) !== foldOf(b), `- ${foldOf(a)} vs ${foldOf(b)}`);

      check('ΕΝΦΚΑ does not claim ΕΝΦΚΑΣ',
        await repo.clientNameExists(db, `ENFKA ΕΝΦΚΑ ${tag}`) === false);
      check('a Latin name still differs by its letters',
        await repo.clientNameExists(db, `LATIN ALPHA ${tag}`) === false);
      check('a blank name matches nothing that exists',
        await repo.clientNameExists(db, '') === false);
    }

    console.log('\n4) the batch insert skips a folded duplicate, once');
    {
      const batchTag = tag + 'B';
      const before = raw.prepare('SELECT COUNT(*) c FROM clients').get().c;
      const result = await repo.bulkInsertClients(db, [
        { name: `BATCH ΜΙΣΘΟΔΟΣΙΑ ${batchTag}`, taxId: null, notes: null, professionId: null },
        // The same name spelled differently. Without the fold this would have
        // been written as a second row.
        { name: `batch μισθοδοσια ${batchTag.toLowerCase()}`, taxId: null, notes: null, professionId: null },
        { name: `BATCH ΕΝΦΚΑ ${batchTag}`, taxId: null, notes: null, professionId: null },
      ]);
      check('the folded pair is counted as one', result.inserted === 2, `- got ${JSON.stringify(result)}`);
      check('and one is skipped', result.skipped === 1, `- got ${result.skipped}`);
      check('the table grew by exactly two',
        raw.prepare('SELECT COUNT(*) c FROM clients').get().c === before + 2);
    }

    raw.close();
    try { fs.unlinkSync(tmp); } catch {}
    try { fs.unlinkSync(bundlePath); } catch {}
    console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  }
}

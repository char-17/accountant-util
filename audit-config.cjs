// Cross-checks the application values that live in src/domain/appConfig.ts
// against every other place the same value is written down.
//
// Why this exists: a constant can be shared inside one language and nowhere
// else. `lib/dbPath.cjs` runs in plain Node, where TypeScript is unavailable,
// and `src-tauri/src/migration.rs` is compiled by cargo. Those two have to
// spell the database file name out themselves. Three copies that cannot be
// merged are three copies that can drift, and the failure is silent: the tests
// would look for a database in one place while the application writes it in
// another, and every test would fail with a "not found" that says nothing
// about the cause.
//
// The second half checks the other direction: a value that has been moved into
// appConfig but is then written out again by hand at a call site. That is how
// the day and reminder bounds came to exist twice - once in the form and once
// in the normaliser - with nothing relating the two.

const fs = require('fs');
const path = require('path');

const APP_CONFIG = 'src/domain/appConfig.ts';

let problems = 0;
const ok = (label) => console.log(`  OK    ${label}`);
const drift = (label, detail) => {
  problems++;
  console.log(`  DRIFT ${label} ${detail}`);
};

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
/** The first capture group, or null when the pattern is absent. */
const grab = (source, pattern) => (source.match(pattern) || [])[1] ?? null;

// ── 1. The database file name, spelled out in three languages ────────────────

console.log('Database file name');

const appConfigSource = read(APP_CONFIG);
const ts = grab(appConfigSource, /export const DB_FILE_NAME = "([^"]+)"/);
const cjs = grab(read('lib/dbPath.cjs'), /appIdentifier\(\),\s*'([^']+)'\)/);
const rust = grab(read('src-tauri/src/migration.rs'), /const DB_FILE_NAME: &str = "([^"]+)"/);

for (const [language, value, file] of [
  ['TypeScript', ts, APP_CONFIG],
  ['Node', cjs, 'lib/dbPath.cjs'],
  ['Rust', rust, 'src-tauri/src/migration.rs'],
]) {
  if (!value) drift(`${language} copy`, `- no DB_FILE_NAME found in ${file}`);
}

if (ts && cjs && rust) {
  if (ts === cjs && cjs === rust) {
    ok(`all three agree on "${ts}"`);
  } else {
    drift('copies disagree', `- TypeScript "${ts}", Node "${cjs}", Rust "${rust}"`);
  }
}

// ── 2. Bounds that were moved and then written out again ─────────────────────

console.log('\nBounds');

/** name -> the literal it used to be, at the call sites that now import it. */
const BOUNDS = [
  {
    name: 'DUE_DAY_MAX',
    literal: grab(appConfigSource, /export const DUE_DAY_MAX = (\d+)/),
    files: ['src/components/ClientTab.tsx', 'src/persistence/assignmentRepo.ts'],
    // What a re-hardcoding looks like at each kind of call site. The `g` is
    // required by matchAll, and every stale match is reported, not just the
    // first: two stray literals are two separate mistakes.
    reHardcoded: [/max=\{(\d+)\}/g, /<=\s*(\d+)/g],
  },
  {
    name: 'REMINDER_DAYS_MAX',
    literal: grab(appConfigSource, /export const REMINDER_DAYS_MAX = (\d+)/),
    files: ['src/components/ClientTab.tsx', 'src/persistence/assignmentRepo.ts'],
    reHardcoded: [/max=\{(\d+)\}/g, /<=\s*(\d+)/g],
  },
];

for (const bound of BOUNDS) {
  if (!bound.literal) {
    drift(bound.name, `- not found in ${APP_CONFIG}`);
    continue;
  }
  for (const file of bound.files) {
    const source = read(file);
    const importsIt = new RegExp(`\\b${bound.name}\\b`).test(source);
    if (!importsIt) {
      drift(bound.name, `- ${file} does not import it`);
      continue;
    }
    // A file may import the constant and still carry a stale literal beside it.
    const stale = bound.reHardcoded
      .flatMap((pattern) => [...source.matchAll(pattern)])
      .filter((m) => m[1] === bound.literal);
    if (stale.length > 0) {
      drift(bound.name, `- ${file} still writes ${bound.literal} by hand`);
    } else {
      ok(`${bound.name} imported by ${file}, no stray literal`);
    }
  }
}

console.log(
  problems === 0
    ? '\nApplication values agree everywhere they are written down.'
    : `\n${problems} drift problem(s). Three copies of one value is already one too many; a disagreement is the reason the audit exists.`
);
process.exit(problems === 0 ? 0 : 1);

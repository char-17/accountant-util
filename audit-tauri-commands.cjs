// Cross-checks the Tauri commands the frontend invokes against the ones the
// Rust side registers.
//
// Why this exists: a command name is a string in one language and an
// identifier in another, with nothing between them. Typecheck cannot see it -
// `invoke<BackupArea>("prepare_backup_area")` type-checks whatever string is
// inside the quotes. ESLint cannot see it. `audit-tauri-acl.cjs` cannot see it
// either: that audit compares plugin permissions against capability entries,
// and application commands are registered through `generate_handler!` and
// appear in no capability file at all.
//
// So a renamed or mistyped command is invisible in every check this project
// runs, and only fails when someone clicks the button in an installed build -
// where the error arrives as a rejected promise and, for anything launched
// from a timer, as nothing at all. Two directions are checked, plus one:
//
//   GAP    invoked but not registered   -> throws when the user asks for it
//   STALE  declared but not registered  -> can never run, wherever it is called
//   DEAD   registered but never called  -> dead code kept alive by a registration
//
// A command registered and declared but invoked under a different spelling
// shows up as GAP, because the name the frontend uses is what has to match.
//
// There is a second spelling layer to the same drift, and it is just as silent:
// the names match and the words still do not. An invoked command with arguments
// has to name the arguments its Rust signature declares - `invoke("log_event",
// { level, message })` against `pub fn log_event(level: String, message: String)`.
// Renaming one side is invisible in the name-only checks above, and only shows
// up as a rejected invoke on a machine where the frontend and the backend are
// finally allowed to talk. It is checked as direction four.

const fs = require('fs');
const path = require('path');

const SRC_DIR = 'src';
const RUST_DIR = path.join('src-tauri', 'src');

// invoke<MigrationResult>("migrate_legacy_database")
// invoke("promote_auto_backup")
//
// The generic is optional and the argument must be a plain string literal, so
// a computed name is deliberately not matched: nothing here builds one, and a
// pattern loose enough to catch that would also catch every other string in
// the file.
const INVOKE_RE = /\binvoke\s*(?:<[^<>]*>)?\s*\(\s*["']([a-z_][a-z0-9_]*)["']\s*(?:,\s*\{([^}]*)\})?/g;

// #[tauri::command]
// pub fn prepare_backup_area() -> ...
// pub fn log_event(level: String, message: String) -> ...
//
// The attribute has to sit directly above the function. Doc comments go above
// the attribute - see backup_fs.rs and migration.rs - so nothing is allowed
// between them: allowing arbitrary lines would reach for the next function in
// the file and report a registration that does not exist. The parameter list is
// captured alongside the name, because the frontend has to spell the same words
// back: `invoke("log_event", { level, message })`, and a rename on either side
// is the silent kind of drift this audit was written to catch.
const COMMAND_RE = /#\[tauri::command\]\s*(?:pub\s+)?fn\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/g;

// .invoke_handler(tauri::generate_handler![a::b, c::d])
const HANDLER_RE = /generate_handler!\[([\s\S]*?)\]/g;

// Rust spells arguments snake_case and the frontend spells them camelCase; the
// transformation Tauri performs between the two is the one this compares, so a
// multi-word parameter has to be spelled identically on both sides.
function camelCase(name) {
  return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Tauri injects some command arguments itself; the frontend never names them.
const INJECTABLE = new Set(["app", "app_handle", "manager", "state"]);

function sameArgs(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

function listSources(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(p, ext));
    else if (ext.test(entry.name)) out.push(p);
  }
  return out;
}

function matches(source, re) {
  const found = [];
  for (const m of source.matchAll(re)) found.push(m[1]);
  return found;
}

// ── What the frontend invokes ─────────────────────────────────────────────────

const tsFiles = listSources(SRC_DIR, /\.(ts|tsx)$/);
const called = new Map(); // name -> [file that invokes it]
const invokedArgs = new Map(); // name -> [args the frontend passed]
for (const file of tsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const m of source.matchAll(INVOKE_RE)) {
    const list = called.get(m[1]) || [];
    list.push(file);
    called.set(m[1], list);

    // The arguments the invocation was made with, in the order it made them.
    // An invocation with no object carries none, which is right for the
    // commands this project invokes without arguments.
    const args = [];
    for (const piece of (m[2] || '').split(',')) {
      const key = piece.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
      if (key) args.push(camelCase(key[1]));
    }
    invokedArgs.set(m[1], args);
  }
}

// ── What Rust declares and registers ──────────────────────────────────────────

const rustFiles = listSources(RUST_DIR, /\.rs$/);
const declared = new Set();
const declaredArgs = new Map(); // command -> the argument names its signature declares, in order
const registered = new Set();
const registrationSite = new Map(); // name -> file

for (const file of rustFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const m of source.matchAll(COMMAND_RE)) {
    declared.add(m[1]);
    declaredArgs.set(m[1], m[2].split(',').map((p) => p.trim().split(/[\s:]+/).filter(Boolean)[0]).filter(Boolean));
  }

  for (const block of matches(source, HANDLER_RE)) {
    // `migration::migrate_legacy_database` -> `migrate_legacy_database`. The
    // path is irrelevant to dispatch; only the last segment is the name the
    // frontend sends.
    for (const entry of block.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const name = trimmed.split('::').pop().trim();
      registered.add(name);
      registrationSite.set(name, file);
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

let problems = 0;

console.log(
  `Tauri command cross-check: ${called.size} invoked in ${tsFiles.length} files ` +
    `vs ${registered.size} registered in ${rustFiles.length} files\n`
);

// Direction one: invoked but not registered.
for (const [name, users] of [...called.entries()].sort()) {
  if (registered.has(name)) {
    console.log(`  OK    ${name.padEnd(34)} <- ${users[0]}`);
  } else {
    problems++;
    console.log(`  GAP   ${name.padEnd(34)} <- ${users.join(', ')}; not in generate_handler!`);
  }
}

// Direction two: declared without a registration. Only reported when nothing
// invokes it, because otherwise direction one has already said so.
for (const name of [...declared].sort()) {
  if (registered.has(name)) continue;
  if (called.has(name)) continue;
  problems++;
  console.log(`  STALE ${name.padEnd(34)} <- #[tauri::command] but never registered`);
}

// Direction three: registered but never invoked.
for (const name of [...registered].sort()) {
  if (called.has(name)) continue;
  problems++;
  console.log(`  DEAD  ${name.padEnd(34)} <- registered in ${registrationSite.get(name)}, called nowhere`);
}

// Direction four: an invocation must name the arguments its signature takes.
// A command that takes no argument is invoked without an object, and both sides
// end up with nothing to say - which is the same answer the comparison makes.
for (const [name, args] of [...invokedArgs.entries()].sort()) {
  const declaredHere = declaredArgs.get(name);
  if (!declaredHere) continue; // no declaration: already reported as a GAP
  const declaredNames = declaredHere.filter((p) => !INJECTABLE.has(p));
  const invokedNames = args.filter((a) => !INJECTABLE.has(a));
  if (sameArgs(invokedNames, declaredNames)) continue;
  problems++;
  console.log(
    `  NAME   ${name.padEnd(34)} <- invoke args [${args.join(', ')}] do not match the Rust signature [${declaredHere.join(', ')}]`
  );
}

console.log(
  problems === 0
    ? '\nEvery command the frontend invokes is registered, and none is registered for nothing.'
    : `\n${problems} command problem(s). A GAP throws when the user asks for it; a DEAD registration is code that cannot be reached.`
);
process.exit(problems === 0 ? 0 : 1);

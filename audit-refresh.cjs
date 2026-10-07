// Traces which refresh functions run after each UI action.
// The DB writes work (verify-mutations.cjs), so stale UI means a missing
// refresh. This walks the handler wiring in src/App.tsx.

const readApp = () => require('fs').readFileSync('src/App.tsx', 'utf8');
const app = readApp();

// Extract the body of a handler function by brace matching.
function body(name) {
  const idx = app.indexOf(`const ${name}`);
  if (idx === -1) return null;
  let depth = 0, started = false, out = '';
  for (let i = app.indexOf('{', idx); i < app.length; i++) {
    const ch = app[i];
    if (ch === '{') { depth++; started = true; }
    if (ch === '}') depth--;
    out += ch;
    if (started && depth === 0) break;
  }
  return out;
}

const REFRESHERS = ['refreshClients', 'refreshTasks', 'refreshStatus', 'refreshAssignments'];
let problems = 0;

function audit(label, handlerName, expected) {
  const b = body(handlerName);
  if (b === null) {
    console.log(`  ??  ${label}: handler "${handlerName}" not found`);
    problems++;
    return;
  }
  const called = REFRESHERS.filter((r) => b.includes(r));
  const missing = expected.filter((r) => !called.includes(r));
  if (missing.length === 0) {
    console.log(`  OK   ${label}  -> ${called.join(', ') || '(none)'}`);
  } else {
    problems++;
    console.log(`  GAP  ${label}  -> missing: ${missing.join(', ')}`);
  }
}

console.log('Refresh coverage after each mutation:\n');

// Handlers may delegate to another handler, so follow one level of indirection
// (handleClientUpdated -> handleRefresh) instead of matching names literally.
function resolved(name, depth = 0) {
  const b = body(name);
  if (b === null) return null;
  const found = REFRESHERS.filter((r) => b.includes(r));
  if (found.length > 0 || depth >= 3) return found;
  // Find a delegated handler: "const X = ... => { ... Y(); ... }"
  for (const m of b.matchAll(/(?:^|\s)([A-Za-z_][\w]*)\s*\(/g)) {
    if (m[1] === name) continue;
    const nested = resolved(m[1], depth + 1);
    if (nested && nested.length > 0) return nested;
  }
  return found;
}

function auditLinked(label, handlerName, expected) {
  const called = resolved(handlerName) || [];
  const missing = expected.filter((r) => !called.includes(r));
  if (missing.length === 0) {
    console.log(`  OK   ${label}  -> ${called.join(', ') || '(none)'}`);
  } else {
    problems++;
    console.log(`  GAP  ${label}  -> missing: ${missing.join(', ')}`);
  }
}

// A client edit can touch its assignments, reminders and monthly counts.
auditLinked('client saved', 'handleClientUpdated',
  ['refreshClients', 'refreshTasks', 'refreshStatus', 'refreshAssignments']);

auditLinked('client created', 'handleClientCreated', ['refreshClients']);

auditLinked('client deleted', 'handleClientDeleted',
  ['refreshClients', 'refreshStatus', 'refreshAssignments']);

// A restore replaces every table, so everything on screen must reload.
auditLinked('backup restore', 'handleRefresh',
  ['refreshClients', 'refreshTasks', 'refreshStatus', 'refreshAssignments']);

auditLinked('task created', 'handleTaskCreated', ['refreshTasks', 'refreshAssignments']);

auditLinked('task deleted', 'handleTaskDeleted', ['refreshTasks', 'refreshAssignments']);

console.log('\nWhere the dashboard marks work complete:');
const hook = require('fs').readFileSync('src/hooks/useMonthlyStatus.ts', 'utf8');
const hasMarkCompleted = hook.includes('markCompleted');
console.log(`  useMonthlyStatus exposes markCompleted: ${hasMarkCompleted ? 'yes' : 'NO'}`);
if (!hasMarkCompleted) { problems++; }

const appUses = app.includes('markCompleted');
console.log(`  App.tsx calls markCompleted:             ${appUses ? 'yes' : 'NO'}`);
if (!appUses) {
  problems++;
  console.log('      -> the "Ολοκληρωμένες" counter can never move.');
}

console.log(`\n${problems === 0 ? 'No gaps found.' : problems + ' gap(s) found.'}`);

// Second class of bug: a component writes to the DB and only refreshes its
// own local state, so every view outside the component stays stale.
console.log('\nComponent-level writes that skip the parent refresh:\n');

const files = {
  'ClientTab.tsx': 'src/components/ClientTab.tsx',
  'TaskCatalog.tsx': 'src/components/TaskCatalog.tsx',
  'ClientList.tsx': 'src/components/ClientList.tsx',
};

let leaks = 0;
for (const [name, file] of Object.entries(files)) {
  const src = require('fs').readFileSync(file, 'utf8');

  // Find async functions that call a repo mutation.
  const fns = [...src.matchAll(/async function (\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}/g)];
  for (const [, fnName, fnBody] of fns) {
    const mutates = /Repo\.(create|update|deactivate|activate|delete|set)/.test(fnBody);
    if (!mutates) continue;

    // Does it notify the parent (onUpdate / onImportComplete / onCreate)?
    const notifies = /\bonUpdate\s*\(|\bonImportComplete\s*\(|\bonCreate\s*\(/.test(fnBody);
    const localOnly = /loadAssignments\s*\(|setAssignments\s*\(/.test(fnBody);

    if (notifies) {
      console.log(`  OK   ${name}.${fnName} notifies the parent`);
    } else if (localOnly) {
      leaks++;
      console.log(`  LEAK ${name}.${fnName} writes then only refreshes locally`);
    } else {
      console.log(`  OK   ${name}.${fnName} (no local list to refresh)`);
    }
  }
}

console.log(leaks === 0 ? '\nNo local-only writes.' : `\n${leaks} write(s) will not update other views.`);
process.exit(problems === 0 && leaks === 0 ? 0 : 1);

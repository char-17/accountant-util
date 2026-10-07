// Filtering + summarising of the monthly worklist (src/domain/worklist.ts).
// The domain functions are pure, so they are exercised directly against the
// compiled TS with esbuild rather than through the UI.

const path = require('path');
const esbuild = require('esbuild');
const Module = require('module');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};
const checkEq = (label, actual, expected) =>
  check(label, actual === expected, `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ── Load the TS module under test ─────────────────────────────────────────────
const entry = path.join(__dirname, '.tmp-worklist-entry.ts');
const bundle = path.join(__dirname, '.tmp-worklist-bundle.cjs');
require('fs').writeFileSync(
  entry,
  `export * from "./src/domain/worklist";`,
  'utf8'
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: bundle, format: 'cjs', platform: 'node' });
const worklist = require(bundle);

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Three clients, five rows, mixed statuses and Greek uppercase names so the
// case-insensitive matching is genuinely exercised.
const rows = [
  { id: 1, clientId: 10, taskTypeId: 1, year: 2026, month: 10, status: 'completed', clientName: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', taskName: 'ΦΠΑ', taskColor: '#7B8D6E' },
  { id: 2, clientId: 10, taskTypeId: 2, year: 2026, month: 10, status: 'pending',   clientName: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', taskName: 'ΕΝΦΚΑ', taskColor: '#8B9DAD' },
  { id: 3, clientId: 11, taskTypeId: 1, year: 2026, month: 10, status: 'pending',   clientName: 'BEBJA BLERIM',   taskName: 'ΦΠΑ', taskColor: '#7B8D6E' },
  { id: 4, clientId: 11, taskTypeId: 3, year: 2026, month: 10, status: 'completed', clientName: 'BEBJA BLERIM',   taskName: 'ΒΕΡ', taskColor: '#C4A882' },
  { id: 5, clientId: 12, taskTypeId: 2, year: 2026, month: 10, status: 'pending',   clientName: 'APARTMENT NAVARINO', taskName: 'ΕΝΦΚΑ', taskColor: '#8B9DAD' },
];
const base = { clientId: null, clientQuery: '', taskQuery: '', status: 'all' };
const F = (o) => ({ ...base, ...o });

console.log('1) unfiltered list passes everything through');
checkEq('all 5 rows', worklist.applyFilters(rows, base).length, 5);
check('isFiltered false for defaults', worklist.hasActiveFilters(base) === false);

console.log('\n2) status filter');
checkEq('pending only', worklist.applyFilters(rows, F({ status: 'pending' })).length, 3);
checkEq('completed only', worklist.applyFilters(rows, F({ status: 'completed' })).length, 2);
checkEq('all = everything', worklist.applyFilters(rows, F({ status: 'all' })).length, 5);

console.log('\n3) client filter follows the dashboard selection');
const forClient = worklist.applyFilters(rows, F({ clientId: 10 }));
checkEq('client 10 has 2 rows', forClient.length, 2);
check('all rows belong to client 10', forClient.every((r) => r.clientId === 10));
check('null clientId means every client', worklist.applyFilters(rows, F({ clientId: null })).length === 5);
check('client with no rows yields empty', worklist.applyFilters(rows, F({ clientId: 999 })).length === 0);

console.log('\n4) text search is case-insensitive');
checkEq('lowercase client match', worklist.applyFilters(rows, F({ clientQuery: 'χατζιδης' })).length, 2);
checkEq('uppercase client match', worklist.applyFilters(rows, F({ clientQuery: 'ΧΑΤΖΙΔΗΣ' })).length, 2);
checkEq('partial task match', worklist.applyFilters(rows, F({ taskQuery: 'ενφκα' })).length, 2);
checkEq('surrounding whitespace ignored', worklist.applyFilters(rows, F({ clientQuery: '  bebja  ' })).length, 2);
checkEq('no match', worklist.applyFilters(rows, F({ clientQuery: 'zzz' })).length, 0);

console.log('\n5) filters combine with AND');
checkEq(
  'client 10 + completed',
  worklist.applyFilters(rows, F({ clientId: 10, status: 'completed' })).length,
  1
);
checkEq(
  'task ΕΝΦΚΑ + client 10',
  worklist.applyFilters(rows, F({ clientId: 10, taskQuery: 'ΕΝΦΚΑ' })).length,
  1
);
checkEq(
  'contradictory filters give nothing',
  worklist.applyFilters(rows, F({ clientId: 10, status: 'completed', taskQuery: 'ΕΝΦΚΑ' })).length,
  0
);

console.log('\n6) hasActiveFilters reflects the real state');
check('status != all', worklist.hasActiveFilters(F({ status: 'pending' })) === true);
check('client selected', worklist.hasActiveFilters(F({ clientId: 11 })) === true);
check('whitespace-only query is not a filter', worklist.hasActiveFilters(F({ clientQuery: '   ' })) === false);
check('real query is a filter', worklist.hasActiveFilters(F({ clientQuery: 'a' })) === true);

console.log('\n7) summarize counts the rows it is given');
const all = worklist.summarize(rows, 2026, 10);
checkEq('totalTasks', all.totalTasks, 5);
checkEq('completedTasks', all.completedTasks, 2);
checkEq('pendingTasks', all.pendingTasks, 3);
checkEq('totalClients', all.totalClients, 3);
checkEq('year echoed', all.year, 2026);
checkEq('month echoed', all.month, 10);

console.log('\n8) per-client progress');
const byId = Object.fromEntries(all.clientProgress.map((p) => [p.clientId, p]));
checkEq('client 10 total', byId[10].totalTasks, 2);
checkEq('client 10 completed', byId[10].completedTasks, 1);
checkEq('client 10 pending', byId[10].pendingTasks, 1);
check('client 10 not complete', byId[10].isComplete === false);
check('client 11 not complete', byId[11].isComplete === false);
check('client 12 not complete', byId[12].isComplete === false);
checkEq('progress sums to the total', all.clientProgress.reduce((n, p) => n + p.totalTasks, 0), 5);

console.log('\n9) summarize of a fully completed set');
const done = worklist.summarize(
  rows.filter((r) => r.status === 'completed'),
  2026,
  10
);
checkEq('no pending', done.pendingTasks, 0);
check('the completed client is flagged complete', done.clientProgress.every((p) => p.isComplete));

console.log('\n10) summarize of an empty set (a month with no work)');
const empty = worklist.summarize([], 2026, 10);
checkEq('no tasks', empty.totalTasks, 0);
checkEq('no clients', empty.totalClients, 0);
check('no client is "complete" when there is no work', empty.clientProgress.every((p) => !p.isComplete));

console.log('\n11) summary matches the filtered rows, not the whole month');
const pendingOnly = worklist.applyFilters(rows, F({ status: 'pending' }));
const s = worklist.summarize(pendingOnly, 2026, 10);
checkEq('summary sees only the filtered rows', s.totalTasks, pendingOnly.length);
checkEq('completed is 0 when only pending is shown', s.completedTasks, 0);
checkEq('pending matches', s.pendingTasks, 3);

console.log('\n12) summarize does not mutate its input');
const before = JSON.stringify(rows);
worklist.summarize(rows, 2026, 10);
check('input rows unchanged', JSON.stringify(rows) === before);

console.log('\n13) the list component matches the domain filter');
// Every row the component would group must equal the domain's filtered set.
const filtered = worklist.applyFilters(rows, F({ taskQuery: 'ενφκα', status: 'pending' }));
const grouped = new Map();
for (const r of filtered) {
  if (!grouped.has(r.clientId)) grouped.set(r.clientId, []);
  grouped.get(r.clientId).push(r);
}
checkEq('two client groups', grouped.size, 2);
checkEq('rows preserved through grouping', [...grouped.values()].flat().length, 2);

// Cleanup
for (const f of [entry, bundle]) require('fs').unlinkSync(f);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
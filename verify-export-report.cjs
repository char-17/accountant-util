// CSV report generation (src/domain/exportReport.ts). Excel compatibility is
// the whole point of this file, so the escaping cases are checked explicitly.

const path = require('path');
const esbuild = require('esbuild');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};
const checkEq = (label, actual, expected) =>
  check(label, actual === expected, `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const entry = path.join(__dirname, '.tmp-export-entry.ts');
const bundle = path.join(__dirname, '.tmp-export-bundle.cjs');
require('fs').writeFileSync(entry, `export * from "./src/domain/exportReport";`, 'utf8');
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: bundle, format: 'cjs', platform: 'node' });
const report = require(bundle);

const statuses = [
  { id: 1, clientId: 1, taskTypeId: 1, year: 2026, month: 10, status: 'completed', completedAt: '2026-10-07T08:30:00', note: 'με έγγραφα', clientName: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', taskName: 'ΦΠΑ', taskColor: '#7B8D6E' },
  { id: 2, clientId: 2, taskTypeId: 1, year: 2026, month: 10, status: 'pending', clientName: 'BEBJA BLERIM', taskName: 'ΕΝΦΚΑ', taskColor: '#8B9DAD' },
];
const summary = {
  year: 2026, month: 10, totalClients: 2, totalTasks: 2,
  completedTasks: 1, pendingTasks: 1,
  clientProgress: [
    { clientId: 1, clientName: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', totalTasks: 1, completedTasks: 1, pendingTasks: 0, isComplete: true },
    { clientId: 2, clientName: 'BEBJA BLERIM', totalTasks: 1, completedTasks: 0, pendingTasks: 1, isComplete: false },
  ],
};
const base = { year: 2026, month: 10, statuses, summary };

console.log('1) plain values are left alone');
checkEq('simple text', report.csvCell('ΑΒΓ'), 'ΑΒΓ');
checkEq('number', report.csvCell(42), '42');
checkEq('zero is kept', report.csvCell(0), '0');

console.log('\n2) the separator forces quoting');
checkEq('semicolon', report.csvCell('Α;Β'), '"Α;Β"');
// A comma is not the separator here, so it needs no quoting. Greek Excel
// expects ';' and would break the row if we split on ','.
checkEq('comma is safe unquoted', report.csvCell('Α,Β'), 'Α,Β');

console.log('\n3) inner quotes are doubled (RFC 4180)');
checkEq('one quote', report.csvCell('Α"Β'), '"Α""Β"');
checkEq('two quotes', report.csvCell('"'), '""""');

console.log('\n4) newlines are quoted so a cell cannot become a row');
checkEq('newline', report.csvCell('Α\nΒ'), '"Α\nΒ"');
checkEq('carriage return', report.csvCell('Α\rΒ'), '"Α\rΒ"');

console.log('\n5) empty and null become empty cells');
checkEq('empty string', report.csvCell(''), '');
checkEq('null', report.csvCell(null), '');
checkEq('undefined', report.csvCell(undefined), '');

console.log('\n6) formula injection is defused');
// Without this, a name like "=cmd" runs when the file is opened in Excel.
// The guard is checked on the parsed value, since quoting can wrap it.
for (const evil of ['=1+1', '+1', '-1', '@SUM(A1)', '=HYPERLINK("x")', '=cmd|\' /C calc\'!A0']) {
  const parsed = parseCsvRow(report.csvCell(evil))[0];
  check(
    `${JSON.stringify(evil)} is not executable`,
    parsed.startsWith("'") && !/^[=+@]/.test(parsed),
    `- parsed as ${JSON.stringify(parsed)}`
  );
}
// A plain negative number-like value must stay intact when it is not a formula.
checkEq('a normal negative number is untouched', report.csvCell(-5), "-5");

console.log('\n7) a row joins on the Greek separator');
checkEq('two values', report.csvRow(['a', 'b']), 'a;b');
checkEq('mixed types', report.csvRow(['a', 1, null]), 'a;1;');

console.log('\n8) the report structure');
const csv = report.buildCsvReport(base);
const lines = csv.split('\r\n');

// Parses one RFC 4180 row back into fields, so the round-trip test is real.
function parseCsvRow(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
check('contains the period', csv.includes('Οκτώβριος 2026'));
check('contains the client name', csv.includes('ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ'));
check('contains both task rows', csv.includes('ΦΠΑ') && csv.includes('ΕΝΦΚΑ'));
check('labels completed work in Greek', csv.includes('Ολοκληρωμένη'));
check('labels pending work in Greek', csv.includes('Εκκρεμής'));
check('includes the totals block', csv.includes('Σύνοψη'));
check('includes per-client progress', csv.includes('Πρόοδος ανά πελάτη'));
check('marks the finished client', /ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ;1;1;Ναι/.test(csv), '- expected Ναι for the finished client');
check('marks the unfinished client', /BEBJA BLERIM;0;1;Όχι/.test(csv), '- expected Όχι');
check('ends with a newline', csv.endsWith('\r\n'));
const headerRow = lines.find((l) => l.startsWith('Πελάτης'));
checkEq('header row has 5 columns', parseCsvRow(headerRow).length, 5);
checkEq(
  'header labels are correct',
  parseCsvRow(headerRow).join('|'),
  'Πελάτης|Εργασία|Κατάσταση|Ημερομηνία ολοκλήρωσης|Σημείωση'
);
// Every data row must have the same shape as the header.
// The task rows are the ones carrying a status label; the progress block at the
// end repeats the client names in a different shape.
const dataRows = lines.filter((l) => l.includes('Ολοκληρωμένη') || l.includes('Εκκρεμής'));
checkEq('both task rows are present', dataRows.length, 2);
check('every task row has 5 columns', dataRows.every((l) => parseCsvRow(l).length === 5),
  `- got ${dataRows.map((l) => parseCsvRow(l).length).join(', ')}`);

console.log('\n9) no filter description when nothing is filtered');
check('no "Φίλτρα" row', !csv.includes('Φίλτρα'));

console.log('\n10) the filter description is recorded when filtered');
const filteredCsv = report.buildCsvReport({
  ...base,
  filterDescription: 'ναι (1 από 2)',
});
const filterRow = filteredCsv.split('\r\n').find((l) => l.startsWith('Φίλτρα'));
check('records the filter', Boolean(filterRow));
checkEq('filter text survives parsing', parseCsvRow(filterRow)[1], 'ναι (1 από 2)');

console.log('\n11) an empty month still produces a valid report');
const emptyCsv = report.buildCsvReport({
  year: 2026, month: 1, statuses: [],
  summary: { year: 2026, month: 1, totalClients: 0, totalTasks: 0, completedTasks: 0, pendingTasks: 0, clientProgress: [] },
});
check('says so explicitly', emptyCsv.includes('(καμία εργασία για την περίοδο)'));
check('still has the header row', emptyCsv.includes('Πελάτης'));
check('uses the right month', emptyCsv.includes('Ιανουάριος 2026'));
check('no per-client block when there are no clients', !emptyCsv.includes('Πρόοδος ανά πελάτη'));

console.log('\n12) a completed date is formatted for reading');
check('renders the completion date', csv.includes('7/') || csv.includes('07/'), `- expected a d/m/yyyy date`);

console.log('\n13) a malformed date does not produce "Invalid Date"');
const badDate = report.buildCsvReport({
  ...base,
  statuses: [{ ...statuses[0], completedAt: 'not-a-date' }],
});
check('invalid date becomes empty', !badDate.includes('Invalid Date') && !badDate.includes('not-a-date'));

console.log('\n14) filenames are sortable and Windows-safe');
const name = report.reportFileName('csv', new Date(2026, 9, 7));
checkEq('date-stamped name', name, 'report-2026-10-07.csv');
check('no characters Windows rejects', !/[:\\/?*"<>|]/.test(name), `- got ${name}`);

console.log('\n15) a note containing a separator survives the round trip');
const tricky = report.buildCsvReport({
  ...base,
  statuses: [{ ...statuses[0], note: 'μέσο; και "αυτά"' }],
});
check('note is quoted and doubled', tricky.includes('"μέσο; και ""αυτά"""'), '- expected the note fully quoted');
// Parsing the row back with standard rules must return the original note, and
// the separator inside it must not have split the row into extra columns.
const row = tricky.split('\r\n').find((l) => l.includes('μέσο'));
const cells = parseCsvRow(row);
checkEq('row kept its 5 columns', cells.length, 5);
checkEq('round trip preserves the note', cells[4], 'μέσο; και "αυτά"');
checkEq('other columns survive too', cells[0], 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ');

for (const f of [entry, bundle]) require('fs').unlinkSync(f);
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
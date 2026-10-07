// Report periods and grouping (src/domain/report.ts).
//
// The period arithmetic decides which months a report covers, and the grouping
// decides what the accountant reads. Both are pure, so they are tested directly
// rather than through the UI.

const path = require('path');
const esbuild = require('esbuild');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};
const checkEq = (label, actual, expected) =>
  check(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

const entry = path.join(__dirname, '.tmp-report-entry.ts');
const bundle = path.join(__dirname, '.tmp-report-bundle.cjs');
require('fs').writeFileSync(entry, `export * from "./src/domain/report";`, 'utf8');
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: bundle, format: 'cjs', platform: 'node' });
const report = require(bundle);

console.log('1) a month covers exactly that month');
checkEq('October', report.rangeForPeriod('month', 2026, 10), { year: 2026, fromMonth: 10, toMonth: 10 });

console.log('\n2) a quarter covers three months');
checkEq('Q4 starts in October', report.rangeForPeriod('quarter', 2026, 10), { year: 2026, fromMonth: 10, toMonth: 12 });
checkEq('Q1 starts in January', report.rangeForPeriod('quarter', 2026, 1), { year: 2026, fromMonth: 1, toMonth: 3 });
checkEq('Q2 starts in April', report.rangeForPeriod('quarter', 2026, 4), { year: 2026, fromMonth: 4, toMonth: 6 });
checkEq('Q3 starts in July', report.rangeForPeriod('quarter', 2026, 7), { year: 2026, fromMonth: 7, toMonth: 9 });
checkEq('March is still Q1', report.rangeForPeriod('quarter', 2026, 3), { year: 2026, fromMonth: 1, toMonth: 3 });

console.log('\n3) a year covers all twelve');
checkEq('year', report.rangeForPeriod('year', 2026, 5), { year: 2026, fromMonth: 1, toMonth: 12 });

console.log('\n4) a custom range is ordered, not rejected');
checkEq('reversed range is swapped', report.normalizeCustomRange(2026, 9, 3), { year: 2026, fromMonth: 3, toMonth: 9 });
checkEq('already ordered', report.normalizeCustomRange(2026, 2, 5), { year: 2026, fromMonth: 2, toMonth: 5 });
checkEq('out of range is clamped', report.normalizeCustomRange(2026, 0, 99), { year: 2026, fromMonth: 1, toMonth: 12 });

console.log('\n5) monthsInRange is inclusive');
checkEq('single month', report.monthsInRange({ year: 2026, fromMonth: 10, toMonth: 10 }), [10]);
checkEq('quarter', report.monthsInRange({ year: 2026, fromMonth: 10, toMonth: 12 }), [10, 11, 12]);

console.log('\n6) range labels read like a period, not a formula');
checkEq('one month', report.reportRangeLabel({ year: 2026, fromMonth: 10, toMonth: 10 }), 'Οκτ 2026');
checkEq('a quarter', report.reportRangeLabel({ year: 2026, fromMonth: 10, toMonth: 12 }), 'Οκτ – Δεκ 2026');
checkEq('a whole year', report.reportRangeLabel({ year: 2026, fromMonth: 1, toMonth: 12 }), 'Έτος 2026');

// ── Grouping ──────────────────────────────────────────────────────────────────

const row = (over) => ({
  id: over.id,
  clientId: over.clientId,
  taskTypeId: over.taskTypeId,
  year: 2026,
  month: over.month,
  status: over.status ?? 'completed',
  clientName: over.clientName,
  taskName: over.taskName,
  taskColor: '#7B8D6E',
  amount: over.amount ?? null,
  isPaid: over.isPaid ?? false,
  isInvoiced: over.isInvoiced ?? false,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

console.log('\n7) rows are grouped under their client');
const groups = report.buildReport([
  row({ id: 1, clientId: 10, taskTypeId: 1, month: 10, clientName: 'ΒΗΤΣΑ', taskName: 'ΦΠΑ', amount: 100 }),
  row({ id: 2, clientId: 11, taskTypeId: 2, month: 10, clientName: 'ΑΛΕΞΙΟΥ', taskName: 'ΕΝΦΚΑ', amount: 200 }),
  row({ id: 3, clientId: 10, taskTypeId: 1, month: 11, clientName: 'ΒΗΤΣΑ', taskName: 'ΦΠΑ', amount: 100 }),
]);
checkEq('two clients', groups.length, 2);
check('clients are sorted by name', groups[0].clientName === 'ΑΛΕΞΙΟΥ' && groups[1].clientName === 'ΒΗΤΣΑ');
checkEq('recurring task keeps one row per month', groups.find((g) => g.clientName === 'ΒΗΤΣΑ').rows.length, 2);

console.log('\n8) amounts are summed per client');
const vitsa = groups.find((g) => g.clientName === 'ΒΗΤΣΑ');
checkEq('total across two months', vitsa.totalAmount, 200);
checkEq('paid only counts paid rows', vitsa.paidAmount, 0);

console.log('\n9) paid and invoiced sums follow their own flags');
const paidGroups = report.buildReport([
  row({ id: 1, clientId: 1, taskTypeId: 1, month: 10, clientName: 'Α', taskName: 'ΦΠΑ', amount: 100, isPaid: true, isInvoiced: true }),
  row({ id: 2, clientId: 1, taskTypeId: 2, month: 10, clientName: 'Α', taskName: 'ΕΝΦΚΑ', amount: 50, isPaid: true }),
  row({ id: 3, clientId: 1, taskTypeId: 3, month: 10, clientName: 'Α', taskName: 'ΦΜΥ', amount: 25 }),
]);
checkEq('total', paidGroups[0].totalAmount, 175);
checkEq('paid', paidGroups[0].paidAmount, 150);
checkEq('invoiced', paidGroups[0].invoicedAmount, 100);

console.log('\n10) a null amount counts as zero, not as an error');
const withNull = report.buildReport([
  row({ id: 1, clientId: 1, taskTypeId: 1, month: 10, clientName: 'Α', taskName: 'ΦΠΑ' }),
]);
checkEq('null amount sums to zero', withNull[0].totalAmount, 0);

console.log('\n11) grand totals are stable');
const totals = report.reportTotals(paidGroups);
checkEq('amount', totals.amount, 175);
checkEq('paid', totals.paid, 150);
checkEq('unpaid is the remainder', totals.unpaid, 25);
checkEq('empty report is all zero', report.reportTotals([]), { amount: 0, paid: 0, invoiced: 0, unpaid: 0 });

for (const f of [entry, bundle]) require('fs').unlinkSync(f);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
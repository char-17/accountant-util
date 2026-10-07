// Money handling (src/domain/money.ts).
//
// The report prints sums the accountant reads as figures, so a float artefact
// such as 0.1 + 0.2 reaching the output is a real defect and not a rounding
// nicety. These checks pin the parsing and the summing rules.

const path = require('path');
const esbuild = require('esbuild');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};
const checkEq = (label, actual, expected) =>
  check(label, actual === expected, `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const entry = path.join(__dirname, '.tmp-money-entry.ts');
const bundle = path.join(__dirname, '.tmp-money-bundle.cjs');
require('fs').writeFileSync(entry, `export * from "./src/domain/money";`, 'utf8');
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: bundle, format: 'cjs', platform: 'node' });
const money = require(bundle);

console.log('1) parseAmount accepts what an accountant types');
checkEq('plain number', money.parseAmount('120'), 120);
checkEq('Greek decimal comma', money.parseAmount('1234,56'), 1234.56);
checkEq('thousands dot + comma', money.parseAmount('1.234,56'), 1234.56);
checkEq('trailing comma', money.parseAmount('120,'), 120);
checkEq('leading dot', money.parseAmount('.5'), 0.5);
checkEq('whitespace ignored', money.parseAmount('  80  '), 80);
checkEq('zero', money.parseAmount('0'), 0);

console.log('\n2) parseAmount rejects what it cannot mean');
checkEq('empty string is null, not zero', money.parseAmount(''), null);
checkEq('whitespace only is null', money.parseAmount('   '), null);
checkEq('letters are null', money.parseAmount('δώρο'), null);
checkEq('two decimals are null', money.parseAmount('1.2.3'), null);
checkEq('negative is null', money.parseAmount('-50'), null);
checkEq('currency symbol is null', money.parseAmount('50€'), null);

console.log('\n3) roundMoney keeps two decimals');
checkEq('0.145 rounds up', money.roundMoney(0.145), 0.15);
checkEq('0.1 + 0.2 is 0.3', money.roundMoney(0.1 + 0.2), 0.3);
checkEq('large value stays exact', money.roundMoney(1234567.891), 1234567.89);

console.log('\n4) sumMoney does not accumulate float error');
checkEq('0.1 + 0.2', money.sumMoney([0.1, 0.2]), 0.3);
checkEq('three cents', money.sumMoney([0.01, 0.01, 0.01]), 0.03);
checkEq('mixed with null', money.sumMoney([10, null, 5.5]), 15.5);
checkEq('empty list is zero', money.sumMoney([]), 0);
checkEq('ignores non-numbers', money.sumMoney([10, 'x', undefined, 2]), 12);

console.log('\n5) formatAmount is readable in Greek');
checkEq('two decimals always', money.formatAmount(120), '120,00');
checkEq('thousands grouped', money.formatAmount(1234.5), '1.234,50');
checkEq('null is empty', money.formatAmount(null), '');
checkEq('undefined is empty', money.formatAmount(undefined), '');

for (const f of [entry, bundle]) require('fs').unlinkSync(f);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
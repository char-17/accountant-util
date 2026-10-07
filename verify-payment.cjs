// The rule that ties a fee to a collection (src/domain/validation.ts).
//
// "Εισπραγμένο" without a number is the one state the report cannot express, so
// the rule is enforced in the domain and not only in the form: a value that
// reaches the database by any other path still has to satisfy it.

const path = require('path');
const esbuild = require('esbuild');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};

const entry = path.join(__dirname, '.tmp-payment-entry.ts');
const bundle = path.join(__dirname, '.tmp-payment-bundle.cjs');
require('fs').writeFileSync(entry, `export * from "./src/domain/validation";`, 'utf8');
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: bundle, format: 'cjs', platform: 'node' });
const { validatePayment } = require(bundle);

const messages = (state) => validatePayment(state).map((e) => e.message);

console.log('1) a collection needs an amount');
check('paid with an amount is allowed', validatePayment({ amount: 100, isPaid: true, isInvoiced: false }).length === 0);
check('paid with a null amount is refused', messages({ amount: null, isPaid: true, isInvoiced: false }).length === 1);
check('paid with an undefined amount is refused', messages({ amount: undefined, isPaid: true, isInvoiced: false }).length === 1);

console.log('\n2) the message says what to do');
const msg = messages({ amount: null, isPaid: true, isInvoiced: false })[0];
check('mentions the amount', /ποσό/.test(msg), `- got "${msg}"`);

console.log('\n3) an unpaid row may still have no amount');
check('pending with no amount is fine', validatePayment({ amount: null, isPaid: false, isInvoiced: false }).length === 0);
check('pending with an amount is fine', validatePayment({ amount: 50, isPaid: false, isInvoiced: false }).length === 0);

console.log('\n4) a negative amount is refused in every state');
check('negative while paid', messages({ amount: -1, isPaid: true, isInvoiced: false }).length === 1);
check('negative while unpaid', messages({ amount: -1, isPaid: false, isInvoiced: false }).length === 1);

console.log('\n5) invoicing is independent of the amount');
check('invoiced without an amount is allowed', validatePayment({ amount: null, isPaid: false, isInvoiced: true }).length === 0);

for (const f of [entry, bundle]) require('fs').unlinkSync(f);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
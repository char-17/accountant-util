// Runs every check in one command: types, lint, architecture audit, and the
// behavioural tests. Prints a summary and exits non-zero if anything failed.
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = __dirname;

// Verify scripts, in the order they build on each other.
const VERIFY = [
  'verify-recurrence.mjs',
  'verify-seed.cjs',
  'verify-seed-period.cjs',
  'verify-profession-seed.cjs',
  'verify-worklist-filters.cjs',
  'verify-export-report.cjs',
  'verify-backup-restore.cjs',
  'verify-ui-render.cjs',
  'verify-ui-interaction.cjs',
  'verify-periodicity.cjs',
  'verify-fix.cjs',
  'verify-startdate-fix.cjs',
  'verify-client-crud.cjs',
  'verify-mutations.cjs',
  'verify-e2e-assignment.cjs',
  'verify-confirm-toggle.cjs',
  'verify-money.cjs',
  'verify-report.cjs',
  'verify-payment.cjs',
];

// Scripts that inspect the code instead of running it; they are audits, and one
// of them deliberately reproduces a bug, so its "failure" is the expected pass.
const AUDIT = ['audit-refresh.cjs', 'audit-contrast.cjs', 'audit-style.cjs'];



const results = [];

function run(label, command, args) {
  const started = Date.now();
  const proc = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const ms = Date.now() - started;
  const ok = proc.status === 0;
  results.push({ label, ok, ms, out: `${proc.stdout || ''}${proc.stderr || ''}` });
  return ok;
}

// TypeScript and ESLint are checked first: a type error makes every behavioural
// test meaningless, and it is cheaper to find it here.
run('typecheck', 'npx', ['tsc', '--noEmit']);
run('lint', 'npx', ['eslint', 'src']);

for (const script of AUDIT) {
  if (fs.existsSync(path.join(root, script))) run(script, 'node', [script]);
}

for (const script of VERIFY) {
  if (fs.existsSync(path.join(root, script))) run(script, 'node', [script]);
}

const failed = results.filter((r) => !r.ok);

console.log('\n' + '='.repeat(64));
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  const time = r.ms >= 1000 ? `${(r.ms / 1000).toFixed(1)}s` : `${r.ms}ms`;
  console.log(`  ${mark}  ${r.label.padEnd(28)} ${time.padStart(7)}`);
}
console.log('='.repeat(64));

if (failed.length > 0) {
  console.log(`\n${failed.length} check(s) failed. Output:\n`);
  for (const f of failed) {
    console.log(`--- ${f.label} ---`);
    console.log(f.out.split('\n').slice(-25).join('\n'));
    console.log('');
  }
  process.exit(1);
}

console.log(`\nAll ${results.length} checks passed.`);
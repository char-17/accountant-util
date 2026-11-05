// When the automatic backup runs (src/domain/autoBackup.ts).
//
// The rule under test is one rule with two readings: at 3 PM, or on the next
// launch if 3 PM passed while the program was closed. Both readings are the
// same comparison - how old is the newest automatic backup, relative to
// today's 3 PM - so what is exercised here is the boundary between them, and
// the two ways the schedule can go wrong: taking a backup twice a day, or
// never taking one at all.

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};
const checkEq = (label, actual, expected) =>
  check(label, actual === expected,
    `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ── Load the module ───────────────────────────────────────────────────────────
// Pure functions with no runtime dependency, so bundling is the only step.
const entry = path.join(__dirname, '.tmp-schedule-entry.ts');
const bundle = path.join(__dirname, '.tmp-schedule-bundle.cjs');
fs.writeFileSync(entry, `export * from "./src/domain/autoBackup";`, 'utf8');
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile: bundle, format: 'cjs', platform: 'node' });
const { planAutoBackup, tomorrowAt } = require(bundle);

/** A local wall-clock time as a timestamp, which is the only clock in play. */
const at = (month, day, hour, minute = 0) => new Date(2026, month, day, hour, minute, 0, 0).getTime();
const HOUR = 15;

console.log('1) before 3 PM nothing is owed, even with an old backup present');
{
  const plan = planAutoBackup(at(9, 23, 9), at(9, 22, 15), HOUR);
  checkEq('not due in the morning', plan.dueNow, false);
  checkEq('waits for today\'s 3 PM', plan.nextAt, at(9, 23, 15));
}

console.log('\n2) a fresh install opened in the morning waits for 3 PM');
{
  const plan = planAutoBackup(at(9, 23, 9), null, HOUR);
  checkEq('not due', plan.dueNow, false);
  checkEq('scheduled for today', plan.nextAt, at(9, 23, 15));
}

console.log('\n3) 3 PM passed while the program was closed');
{
  // The clock that matters: yesterday's backup is older than today's 3 PM,
  // and it is now 6 PM. Whether the program was closed at 3 or first opened
  // at 6 is not distinguishable here, and must not have to be.
  const plan = planAutoBackup(at(9, 23, 18), at(9, 22, 15), HOUR);
  checkEq('due immediately', plan.dueNow, true);
  checkEq('reacting to today\'s 3 PM', plan.nextAt, at(9, 23, 15));
}

console.log('\n4) a fresh install opened in the evening backs up now');
{
  const plan = planAutoBackup(at(9, 23, 18), null, HOUR);
  checkEq('due immediately', plan.dueNow, true);
  checkEq('no waiting until tomorrow for a first backup', plan.nextAt, at(9, 23, 15));
}

console.log('\n5) opened after 3 PM on a day already backed up');
{
  // Without this, an evening launch takes a second backup and the folder keeps
  // one file only because the rename hides it.
  const plan = planAutoBackup(at(9, 23, 18), at(9, 23, 15), HOUR);
  checkEq('not due again', plan.dueNow, false);
  checkEq('scheduled for tomorrow', plan.nextAt, at(9, 24, 15));
}

console.log('\n6) the boundary: a backup taken exactly at 3 PM counts as today\'s');
{
  const plan = planAutoBackup(at(9, 23, 15, 0), at(9, 23, 15, 0), HOUR);
  checkEq('not due at the exact moment', plan.dueNow, false);
  checkEq('tomorrow', plan.nextAt, at(9, 24, 15));
}

console.log('\n7) one second before 3 PM it is still tomorrow\'s problem');
{
  const now = at(9, 23, 14, 59);
  const plan = planAutoBackup(now, at(9, 23, 14, 59), HOUR);
  checkEq('not due at 14:59', plan.dueNow, false);
  checkEq('due at 15:00 today', plan.nextAt, at(9, 23, 15));
}

console.log('\n8) a backup from two days ago is overdue, not ancient-and-ignored');
{
  const plan = planAutoBackup(at(9, 23, 15, 1), at(9, 21, 15), HOUR);
  checkEq('still due', plan.dueNow, true);
}

console.log('\n9) the daily chain keeps running while the program stays open');
{
  // What the hook does after each attempt: work out tomorrow, wait, repeat.
  // Three days without a restart, each one backed up once.
  const day1 = at(9, 23, 15);
  const next = tomorrowAt(day1, HOUR);
  checkEq('tomorrow is the next day', next, at(9, 24, 15));

  const day2 = tomorrowAt(next, HOUR);
  checkEq('and the day after', day2, at(9, 25, 15));

  // On each of those mornings the plan must still say "wait", and in each of
  // those evenings "due" - the file age moves forward one day at a time.
  const morning2 = planAutoBackup(at(9, 24, 8), at(9, 23, 15), HOUR);
  checkEq('the second morning waits', morning2.dueNow, false);
  const evening2 = planAutoBackup(at(9, 24, 16), at(9, 23, 15), HOUR);
  checkEq('the second evening is due', evening2.dueNow, true);
}

console.log('\n10) tomorrow never reuses today\'s moment');
{
  // The trap in scheduling after a failed attempt: lastAutoMs did not move, so
  // planAutoBackup still calls today overdue. tomorrowAt must not agree.
  const failedAt = at(9, 23, 15, 3);
  const retry = tomorrowAt(failedAt, HOUR);
  check('is later than the failed attempt', retry > failedAt, `- got ${retry}`);
  checkEq('same hour, next day', retry, at(9, 24, 15));
}

console.log('\n11) a month boundary does not skip a day');
{
  const last = at(9, 31, 15);       // 31 October 2026 (months are 0-based)
  const next = tomorrowAt(last, HOUR);
  checkEq('November 1st at the same hour', next, at(10, 1, 15));
}

console.log('\n12) the hour is the argument, not a baked-in 15');
{
  // The same moment under two schedules must land on two different times. A
  // function that ignored the argument would pass every test above while
  // quietly backing up at whatever hour it liked, because every fixture here
  // happens to ask about 3 PM.
  const early = planAutoBackup(at(9, 23, 2), null, 3);
  checkEq('a 3 AM schedule is not due at 2 AM', early.dueNow, false);
  checkEq('and waits for 3 AM', early.nextAt, at(9, 23, 3));

  const late = planAutoBackup(at(9, 23, 2), null, HOUR);
  checkEq('the 3 PM schedule at that same moment waits for 3 PM', late.nextAt, at(9, 23, 15));

  // Past the early hour, the earlier schedule is owed while the later one is
  // still not - which only holds if both read the hour they were given.
  const paid = planAutoBackup(at(9, 23, 4), null, 3);
  checkEq('4 AM is overdue for a 3 AM schedule', paid.dueNow, true);
  checkEq('but nowhere near due for a 3 PM one',
    planAutoBackup(at(9, 23, 4), null, HOUR).dueNow, false);
}

fs.unlinkSync(entry);
fs.unlinkSync(bundle);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

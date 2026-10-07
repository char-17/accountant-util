// Unit tests for src/domain/recurrence.ts, compiled on the fly so the test
// runs the real module rather than a copy of its logic.
import { transformSync } from "esbuild";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const src = path.join(process.cwd(), "src", "domain", "recurrence.ts");
const out = path.join(os.tmpdir(), `recurrence-${Date.now()}.mjs`);
const bundled = transformSync(fs.readFileSync(src, "utf8"), { loader: "ts", format: "esm" });
fs.writeFileSync(out, bundled.code);

const R = await import(pathToFileURL(out).href);
fs.unlinkSync(out);

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`); }
}
function checkTrue(label, cond, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
}

const D = (s) => new Date(s + "T00:00:00");

console.log('isDueInMonth:');
check('monthly is always due', R.isDueInMonth('monthly', 2026, 7), true);
check('quarterly is due in Jan', R.isDueInMonth('quarterly', 2026, 1), true);
check('quarterly is due in Apr', R.isDueInMonth('quarterly', 2026, 4), true);
check('quarterly is not due in Feb', R.isDueInMonth('quarterly', 2026, 2), false);
check('quarterly is not due in Mar', R.isDueInMonth('quarterly', 2026, 3), false);
check('yearly is due in Jan', R.isDueInMonth('yearly', 2026, 1), true);
check('yearly is not due in Jun', R.isDueInMonth('yearly', 2026, 6), false);

console.log('\ncurrentDeadline (monthly):');
{
  const a = { startDate: '2026-01-01', periodicity: 'monthly', dueDay: 28, reminderDays: 5 };
  const r = R.currentDeadline(a, D('2026-03-15'));
  check('due date is the 28th', r.dueOn, '2026-03-28');
  check('reminder is 5 days earlier', r.remindOn, '2026-03-23');
  check('days until due', r.daysUntilDue, 13);
  check('not overdue', r.isOverdue, false);
}
{
  const a = { startDate: '2026-01-01', periodicity: 'monthly', dueDay: 28, reminderDays: 5 };
  const r = R.currentDeadline(a, D('2026-03-30'));
  check('still points at this month after the deadline', r.dueOn, '2026-03-28');
  check('days until due is negative', r.daysUntilDue, -2);
  check('flagged overdue', r.isOverdue, true);
}
{
  // Clamping: day 31 in a 30-day month must not roll into the next month.
  const a = { startDate: '2026-01-01', periodicity: 'monthly', dueDay: 31, reminderDays: 0 };
  check('day 31 clamps to Apr 30', R.currentDeadline(a, D('2026-04-10')).dueOn, '2026-04-30');
  check('day 31 clamps to Feb 28 (non-leap)', R.currentDeadline(a, D('2026-02-10')).dueOn, '2026-02-28');
  check('day 31 clamps to Feb 29 (leap)', R.currentDeadline(a, D('2028-02-10')).dueOn, '2028-02-29');
}

console.log('\ncurrentDeadline (quarterly):');
{
  const a = { startDate: '2026-01-01', periodicity: 'quarterly', dueDay: 10, reminderDays: 3 };
  check('Feb maps back to the Jan quarter', R.currentDeadline(a, D('2026-02-15')).dueOn, '2026-01-10');
  check('May maps back to the Apr quarter', R.currentDeadline(a, D('2026-05-15')).dueOn, '2026-04-10');
  check('Jul maps back to the Jul quarter', R.currentDeadline(a, D('2026-07-15')).dueOn, '2026-07-10');
  check('Nov maps back to the Oct quarter', R.currentDeadline(a, D('2026-11-15')).dueOn, '2026-10-10');
}

console.log('\ncurrentDeadline (yearly):');
{
  const a = { startDate: '2026-01-01', periodicity: 'yearly', dueDay: 31, reminderDays: 30 };
  check('mid-year maps back to Jan', R.currentDeadline(a, D('2026-08-10')).dueOn, '2026-01-31');
  check('reminder 30 days earlier', R.currentDeadline(a, D('2026-08-10')).remindOn, '2026-01-01');
  check('before start returns null', R.currentDeadline(a, D('2025-08-10')), null);
}

console.log('\nrespects startDate:');
{
  const a = { startDate: '2026-06-01', periodicity: 'monthly', dueDay: 15, reminderDays: 2 };
  check('before start is null', R.currentDeadline(a, D('2026-05-20')), null);
  check('after start resolves', R.currentDeadline(a, D('2026-06-20')).dueOn, '2026-06-15');
}

console.log('\nnextDeadline (rolls forward after a missed due date):');
{
  const a = { startDate: '2026-01-01', periodicity: 'monthly', dueDay: 28, reminderDays: 5 };
  check('upcoming returns the current one', R.nextDeadline(a, D('2026-03-15')).dueOn, '2026-03-28');
  check('overdue rolls to the next month', R.nextDeadline(a, D('2026-03-30')).dueOn, '2026-04-28');
  check('rolls across a year boundary', R.nextDeadline(a, D('2026-12-30')).dueOn, '2027-01-28');
  check('quarterly rolls a quarter', R.nextDeadline(
    { startDate: '2026-01-01', periodicity: 'quarterly', dueDay: 10, reminderDays: 3 },
    D('2026-04-15')
  ).dueOn, '2026-07-10');
}

console.log('\nreminderState:');
{
  const mk = (days) => ({ year: 2026, month: 3, dueOn: '2026-03-28', remindOn: '2026-03-23', daysUntilDue: days, isOverdue: days < 0 });
  check('past due is overdue', R.reminderState(mk(-1), D('2026-03-29'), 5), 'overdue');
  check('exactly the reminder day is due_soon', R.reminderState(mk(5), D('2026-03-23'), 5), 'due_soon');
  check('inside the window is due_soon', R.reminderState(mk(2), D('2026-03-26'), 5), 'due_soon');
  check('day after the window is upcoming', R.reminderState(mk(6), D('2026-03-22'), 5), 'upcoming');
  check('far away is later', R.reminderState(mk(90), D('2025-12-28'), 5), 'later');
  check('today is due_soon', R.reminderState(mk(0), D('2026-03-28'), 5), 'due_soon');
}

console.log('\ndescribeDeadline:');
{
  const mk = (n) => ({ year: 2026, month: 3, dueOn: '2026-03-28', remindOn: '2026-03-23', daysUntilDue: n, isOverdue: n < 0 });
  check('yesterday', R.describeDeadline(mk(-1)), 'Λήγησε χθες');
  check('3 days late', R.describeDeadline(mk(-3)), 'Λήγησε πριν 3 ημέρες');
  check('today', R.describeDeadline(mk(0)), 'Λήγει σήμερα');
  check('tomorrow', R.describeDeadline(mk(1)), 'Λήγει αύριο');
  check('in 5 days', R.describeDeadline(mk(5)), 'Λήγει σε 5 ημέρες');
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

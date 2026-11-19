// Run against the local Vite development server with playwright-core available
// on the Node module path. The browser uses an isolated profile and SQLite in
// memory. No command goes to the native application or its database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { chromium } = require('playwright-core');

const db = new Database(':memory:');
const year = 2024;
const clients = ['Άλφα', 'Βήτα', 'Γάμμα'];
const tasks = ['Βιβλία', 'ΦΠΑ', 'Εξαμηνιαίος έλεγχος', 'Δήλωση'];
const rows = [];
const months = Array.from({ length: 12 }, (_, i) => i + 1);
const names = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μάι', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
const euros = cents => (cents / 100).toLocaleString('el-GR', { minimumFractionDigits: 2 }) + ' €';
const date = iso => iso ? iso.split('-').reverse().join('/') : '—';

function fixture() {
  const migration = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/migration.rs'), 'utf8');
  const statements = ['migrations', 'financial_migrations'].map(name => migration.split('let ' + name + ' = [')[1].split('];')[0]).join('\n');
  for (const [, sql] of statements.matchAll(/^\s*"(.+)",/gm)) {
    try { db.exec(sql); } catch (e) { if (!e.message.includes('duplicate column name')) throw e; }
  }
  clients.forEach((name, i) => db.prepare('INSERT INTO clients(id,name) VALUES(?,?)').run(i + 1, name));
  tasks.forEach((name, i) => db.prepare('INSERT INTO task_types(id,name) VALUES(?,?)').run(i + 1, name));
  const assignments = [
    [1, 1, 'monthly', months], [1, 2, 'quarterly', [1, 4, 7, 10]],
    [2, 1, 'monthly', months], [2, 3, 'semiannual', [1, 7]], [3, 4, 'yearly', [1]],
  ];
  const insert = db.prepare(`INSERT INTO monthly_task_status
    (client_id,task_type_id,year,month,status,amount,is_paid,paid_at,is_invoiced,invoiced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  for (const [client, task, recurrence, due] of assignments) {
    db.prepare(`INSERT INTO client_task_assignments(client_id,task_type_id,start_date,end_date,periodicity)
      VALUES (?,?,'2024-01-01','2024-12-31',?)`).run(client, task, recurrence);
    for (const month of due) {
      const flags = (month + client + task) % 4;
      const paid = Boolean(flags & 1);
      const invoiced = Boolean(flags & 2);
      const cents = month === 2 && client === 1 ? 0 : month === 8 && client === 1 ? null : (client * 10101 + month * 13 + task);
      const isoMonth = String(month).padStart(2, '0');
      const paidAt = paid ? (month === 12 ? '2025-01-02' : `2024-${isoMonth}-17`) : null;
      const invoicedAt = invoiced && month !== 8 ? (month === 2 ? '2024-02-29' : `2024-${isoMonth}-01`) : null;
      rows.push({ client, task, month, cents, paid, invoiced, paidAt, invoicedAt });
      insert.run(client, task, year, month, month % 2 || (month === 2 && client === 1) ? 'pending' : 'completed', cents === null ? null : cents / 100,
        Number(paid), paidAt, Number(invoiced), invoicedAt);
    }
  }
  // Adjacent year with its own stored service and a payment date in 2024.
  insert.run(1, 1, 2023, 12, 'completed', 888.88, 1, '2024-01-04', 0, null);
}

function query(kind, sql, params = []) {
  const values = [];
  const statement = db.prepare(sql.replace(/\$(\d+)/g, (_, n) => {
    values.push(params[Number(n) - 1]);
    return '?';
  }));
  if (kind === 'select') return statement.all(...values);
  const result = statement.run(...values);
  return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) };
}

const failures = [];
async function scenario(label, action) {
  try {
    await action();
    console.log('PASS', label);
  } catch (e) {
    failures.push(label);
    console.log('FAIL', label, e.message.split('\n').slice(0,18).join('\n'));
  }
}

async function run(page) {
  page.setDefaultTimeout(4000);
  // Hold the calendar at local half past midnight on leap day.
  await page.clock.setFixedTime(new Date('2024-02-29T00:30:00+02:00'));
  let holdRange;
  await page.exposeFunction('fixtureQuery', async (kind, sql, params) => {
    const result = query(kind, sql, params);
    if (holdRange && sql.includes('m.month BETWEEN') && params[1] === holdRange.from && params[2] === holdRange.to) {
      holdRange.started();
      await holdRange.gate;
    }
    return result;
  });
  await page.route('**/src/hooks/useDatabase.ts*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `const db = {
      select: (sql, p) => window.fixtureQuery('select', sql, p),
      execute: (sql, p) => window.fixtureQuery('execute', sql, p)
    }; export function useDatabase() { return {db,loading:false,error:null,migrationWarning:null}; }`,
  }));
  await page.goto('http://localhost:1420/');
  const button = name => page.getByRole('button', { name, exact: true });
  const period = name => button(name).click();
  const openReports = () => button('Αναφορές').click();
  const chooseMonth = async month => {
    await page.locator('.month-display').click();
    await page.locator('.month-option').nth(month - 1).click();
  };
  const clientFilter = page.getByRole('button', {name: /^Φίλτρο αναφορών ανά πελάτη:/});
  async function chooseClient(id) {
    await clientFilter.click();
    const name = id ? clients[id - 1] : 'Όλοι οι πελάτες';
    await page.getByRole('option', {name, exact:true}).click();
  }
  const from = page.getByLabel('Αναφορά από μήνα');
  const to = page.getByLabel('Αναφορά έως μήνα');
  const settle = () => page.evaluate(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  async function table() {
    await settle();
    await page.getByText('Φόρτωση...', { exact: true }).waitFor({state: 'hidden'});
    return page.locator('.report-table tbody tr').evaluateAll(trs => {
      const groups = [];
      for (const tr of trs) {
        if (tr.matches('.report-client-row')) {
          groups.push({ name: tr.cells[0].innerText.replace(/[▾▸]/g, '').trim(), total: tr.cells[1].innerText, unpaid: tr.querySelector(".report-outstanding")?.innerText, rows: [] });
        } else if (tr.matches(".report-service-row")) {
          groups.at(-1).rows.push(Array.from(tr.cells, td => td.innerText.trim()));
        }
      }
      return groups;
    });
  }
  const expected = (lo, hi, only, sort) => {
    const groups = [];
    for (const [index, name] of clients.entries()) {
      if (only && index + 1 !== only) continue;
      const chosen = rows.filter(r => r.client === index + 1 && r.month >= lo && r.month <= hi);
      if (!chosen.length) continue;
      chosen.sort((a, b) => a.month - b.month || (sort || 0) * (a.cents - b.cents));
      const sum = chosen.reduce((acc, r) => acc + (r.cents ?? 0), 0);
      groups.push({ name, sum, total: euros(sum), unpaid: euros(chosen.reduce((n,r) => n + (r.paid ? 0 : r.cents ?? 0), 0)), rows: chosen.map(r => [
        tasks[r.task - 1],
        r.cents == null ? 'Χωρίς ποσό' : euros(r.cents), r.paid ? euros(0) : r.cents == null ? '—' : euros(r.cents),
        date(r.paidAt), r.invoiced && !r.invoicedAt ? 'Τιμολογήθηκε · λείπει ημερομηνία' : date(r.invoicedAt),
      ])});
    }
    if (sort) groups.sort((a,b) => sort * (a.sum - b.sum));
    return groups.map(({sum, ...group}) => group);
  };
  async function verifyRange(lo, hi, only, sort) {
    assert.deepEqual(await table(), expected(lo, hi, only, sort));
    const title = lo === hi ? names[lo-1] : lo === 1 && hi === 12 ? 'Έτος' : names[lo-1] + ' – ' + names[hi-1];
    assert.equal(await page.locator('.reports-range-label').innerText(), title + ' 2024');
  }
  await openReports();
  await scenario('payment and invoice views use event dates across service months and year boundaries', async () => {
    const basis = page.getByRole('group', {name: 'Είδος αναφοράς'});
    for (const [label, column, flag] of [['Εισπράξεις','paid_at','is_paid'], ['Τιμολόγια','invoiced_at','is_invoiced']]) {
      await basis.getByRole('button', {name:label}).click();
      for (const [periodName, lo, hi] of [['Μηνιαία',1,1],['Τριμηνιαία',1,3],['Ετήσια',1,12],['Προσαρμοσμένη περίοδος',2,4]]) {
        await chooseMonth(1);
        await period(periodName);
        if (periodName === 'Προσαρμοσμένη περίοδος') { await from.selectOption('2'); await to.selectOption('4'); }
        const groups = await table();
        const records = db.prepare('SELECT amount FROM monthly_task_status WHERE '+flag+'=1 AND strftime(\'%Y\','+column+')=\'2024\' AND CAST(strftime(\'%m\','+column+') AS INTEGER) BETWEEN ? AND ?').all(lo,hi);
        assert.equal(groups.flatMap(g => g.rows).length, records.length);
        assert.deepEqual(await page.locator('.reports-totals dd').allInnerTexts(), [euros(records.reduce((n,r) => n + Math.round((r.amount ?? 0)*100),0))]);
        if (label === 'Εισπράξεις' && hi === 1) assert.ok(groups.flatMap(g => g.rows).some(row => row.includes('888,88 €') && row.includes('04/01/2024')));
      }
    }
    await basis.getByRole('button',{name:'Εργασίες'}).click();
    await period('Ετήσια');
    const unpaid = page.getByRole('checkbox',{name:'Τιμολογημένα προς είσπραξη'});
    await unpaid.check();
    const groups = await table();
    assert.ok(groups.length > 0);
    const filtered = rows.filter(row => row.invoiced && !row.paid);
    assert.equal(groups.flatMap(g => g.rows).length, filtered.length);
    assert.equal(await page.locator('.reports-totals dd').last().innerText(), euros(filtered.reduce((n,r)=>n+(r.cents ?? 0),0)));
    assert.ok(groups.every(group => group.total === group.unpaid));
    await unpaid.uncheck();
    await period('Μηνιαία');
  });
  await scenario('12 monthly reports, both financial dates and client subtotals', async () => {
    for (const m of months) { await chooseMonth(m); await verifyRange(m, m); }
  });
  await scenario('quarter for each of the 12 anchor months', async () => {
    await period('Τριμηνιαία');
    for (const m of months) {
      await chooseMonth(m);
      const lo = [1,4,7,10].find(first => m >= first && m < first + 3);
      await verifyRange(lo, lo + 2);
    }
  });
  await scenario('annual report, recurring tasks and year boundary', async () => {
    await period('Ετήσια');
    await verifyRange(1, 12);
  });
  await scenario('all 144 ordered custom month pairs, including reversed and single months', async () => {
    await period('Προσαρμοσμένη περίοδος');
    for (const start of months) {
      await from.selectOption(String(start));
      for (const end of months) {
        await to.selectOption(String(end));
        await verifyRange(Math.min(start, end), Math.max(start, end));
      }
    }
  });
  await period('Ετήσια');
  await scenario('individual clients, sorting both directions, collapse and expand', async () => {
    const search = page.getByRole('searchbox', {name: 'Αναζήτηση πελάτη...'});
    await search.fill('αλφ');
    await search.press('Enter');
    await verifyRange(1,12,1);
    for (const id of [1,2,3]) { await chooseClient(id); await verifyRange(1,12,id); }
    await chooseClient(null);
    const sort = page.locator('.report-sort-button');
    for (const direction of [1,-1,0]) { await sort.click(); await verifyRange(1,12,null,direction); }
    await page.locator('.report-client-toggle').first().click();
    const folded = await table();
    assert.equal(folded[0].rows.length, 0);
    assert.equal(folded[0].unpaid, expected(1,12)[0].unpaid);
    assert.deepEqual(folded.slice(1), expected(1,12).slice(1));
    await page.locator('.report-client-toggle').first().click();
    await verifyRange(1,12);
  });
  await scenario('five columns accessible at desktop and narrow widths, including print layout', async () => {
    for (const width of [1440,1024,390]) {
      await page.setViewportSize({width,height:900});
      assert.ok(await page.evaluate(() => {
        const picker = document.querySelector('.reports-filter-row').getBoundingClientRect();
        const table = document.querySelector('.report-table-wrap').getBoundingClientRect();
        return Math.abs(picker.left - table.left) <= 1 && picker.right <= table.right + 1;
      }));
      const headings = page.locator('.report-table thead th');
      assert.equal(await headings.count(),5);
      for (const heading of await headings.all()) { await heading.scrollIntoViewIfNeeded(); assert.ok(await heading.isVisible()); }
      const last = page.locator('.report-service-row').first().locator('td').last();
      await last.scrollIntoViewIfNeeded();
      assert.ok(await last.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left < innerWidth && r.right > 0;
      }));
    }
    await page.setViewportSize({width:1440,height:900});
    await period('Προσαρμοσμένη περίοδος');
    await from.selectOption('2');
    await to.selectOption('3');
    await verifyRange(2,3);
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('.reports-custom-group').isVisible(), false);
    assert.ok(await page.locator('.reports-range-label').isVisible());
    assert.ok(await page.locator('.report-table').isVisible());
    await verifyPrintColumns();
    await page.emulateMedia({media:'screen'});
    assert.ok(await from.isVisible() && await to.isVisible());
    await period('Ετήσια');
  });
  async function verifyPrintColumns() {
    for (const cell of await page.locator('.report-service-row').first().locator('td').all()) assert.ok(await cell.isVisible());
  }
  await page.emulateMedia({media:'screen'});
  await page.setViewportSize({width:1440,height:900});
  await scenario('previous year by service month, and entirely empty next year', async () => {
    await chooseMonth(1);
    await button('Προηγούμενος μήνας').click();
    assert.deepEqual((await table()).map(g => [g.total, g.rows[0].slice(1)]), [['888,88 €',['888,88 €','0,00 €','04/01/2024','—']]]);
    await button('Επόμενος μήνας').click();
    await chooseMonth(12);
    await button('Επόμενος μήνας').click();
    assert.deepEqual(await table(), []);
    assert.match(await page.locator('.reports-view').innerText(), /Δεν υπάρχουν εργασίες/);
    await button('Προηγούμενος μήνας').click();
  });
  await chooseMonth(2);
  await period('Ετήσια');
  await chooseClient(3);
  await period('Μηνιαία');
  await scenario('recover from a selected client absent in the new month', async () => {
    await settle();
    assert.match(await clientFilter.getAttribute('aria-label'), /Γάμμα/);
    assert.deepEqual(await table(), []);
    assert.equal(await page.locator('.reports-totals dd').last().innerText(), euros(0));
    await page.getByText('Καμία κίνηση για τον επιλεγμένο πελάτη στην περίοδο.').waitFor();
    await chooseClient(null);
    await verifyRange(2,2);
  });
  await button('Κεντρική').click();
  await openReports();
  await scenario('slow old request cannot overwrite a newer period', async () => {
    let resume, started;
    const pending = new Promise(r => { started = r; });
    holdRange = {from:1,to:12,started,gate:new Promise(r => { resume = r; })};
    try {
      await period('Ετήσια');
      await Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(Error('No annual request')), 3000))]);
      await period('Μηνιαία');
      await verifyRange(2,2);
    } finally { holdRange = null; resume(); }
    await verifyRange(2,2);
  });
  // Start the write-through scenario with a verified, current monthly report.
  await period('Ετήσια'); await period('Μηνιαία');
  await verifyRange(2,2);
  await button('Κεντρική').click();
  const task = page.locator('.worklist-client').filter({hasText:clients[0]}).locator('.worklist-item').filter({hasText:tasks[0]});
  const amount = task.locator('input[inputmode=decimal]');
  const paid = task.locator('.task-payment-check input').first();
  const invoiced = task.locator('.task-payment-check input').last();
  const saved = () => db.prepare('SELECT * FROM monthly_task_status WHERE client_id=1 AND task_type_id=1 AND year=2024 AND month=2').get();
  const dialog = page.getByRole('dialog');
  const correction = task.getByRole('button', {name:'Διόρθωση καταχώρισης'});
  async function confirm(name) {
    await dialog.getByRole('button', {name, exact:true}).click();
    await dialog.waitFor({state:'hidden'});
  }
  await scenario('review, cancel, and record a prepayment on leap day in Athens', async () => {
    await amount.fill('1.234,56');
    await paid.click();
    assert.equal(await dialog.getByLabel('Ποσό (€)').inputValue(), '1.234,56');
    assert.equal(await dialog.getByRole('textbox', {name:'Ημερομηνία είσπραξης', exact:true}).inputValue(),'29/02/2024');
    assert.ok((await dialog.innerText()).includes(clients[0]));
    await confirm('Άκυρο');
    assert.equal(saved().is_paid, 0);
    await paid.click();
    await confirm('Είσπραξη μόνο');
    assert.deepEqual([saved().status, saved().amount, saved().paid_at], ['pending',1234.56,'2024-02-29']);
    assert.equal(await amount.isEditable(),false);
    assert.ok(await task.getByText(/Εισπράχθηκαν 1.234,56/).isVisible());
  });
  await scenario('separate invoice confirmation and locked amount', async () => {
    await invoiced.click();
    assert.equal(await dialog.getByLabel('Ποσό (€)').isEditable(),false);
    await confirm('Καταχώριση τιμολογίου');
    assert.deepEqual([saved().status,saved().is_invoiced,saved().invoiced_at],['pending',1,'2024-02-29']);
  });
  await scenario('confirmed correction preserves the previous amount and dates', async () => {
    await correction.click();
    await dialog.getByLabel('Ποσό (€)').fill('120');
    const paidDate = dialog.getByRole('textbox', {name:'Ημερομηνία είσπραξης', exact:true});
    await paidDate.fill('31/02/2024');
    await dialog.getByRole('button', {name:'Επιβεβαίωση διόρθωσης'}).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(saved().paid_at, '2024-02-29');
    const picker = dialog.locator('.finance-date-field').filter({has: page.getByRole('textbox', {name:'Ημερομηνία είσπραξης', exact:true})}).locator('input[type="date"]');
    await picker.fill('2026-11-25', {force:true});
    assert.equal(await paidDate.inputValue(), '25/11/2026');
    await dialog.getByRole('textbox', {name:'Ημερομηνία είσπραξης', exact:true}).fill('02/03/2024');
    await confirm('Επιβεβαίωση διόρθωσης');
    const r = saved();
    const history = JSON.parse(r.corrections_json);
    assert.equal(history.length,1);
    assert.deepEqual([history[0].before.amount,history[0].after.amount,history[0].before.paidAt,history[0].after.paidAt],
      [1234.56,120,'2024-02-29','2024-03-02']);
    assert.deepEqual([r.amount,r.paid_at,r.invoiced_at],[120,'2024-03-02','2024-02-29']);
  });
  const changed = rows.find(r => r.client === 1 && r.task === 1 && r.month === 2);
  Object.assign(changed,{ cents:12000, paid:true, invoiced:true, paidAt:'2024-03-02', invoicedAt:'2024-02-29' });
  await openReports();
  await scenario('pending collection and invoice appear immediately and count once', async () => {
    await verifyRange(2,2);
    await chooseClient(1);
    const values = await page.locator('.reports-totals dd').allInnerTexts();
    assert.deepEqual(values,[12000,12000,12000,0].map(euros));
    await chooseClient(null);
  });
  await button('Κεντρική').click();
  const workStatus = task.locator('.worklist-item-main input');
  await workStatus.click();
  await confirm('Ναι, ολοκληρώθηκε');
  await openReports();
  await scenario('later task completion preserves the recorded finances', () => verifyRange(2,2));
  await button('Κεντρική').click();
  await workStatus.click();
  await confirm('Ναι, επανήλθε');
  await correction.click();
  await dialog.getByRole('checkbox',{name:'Εισπράχθηκε'}).uncheck();
  await dialog.getByRole('checkbox',{name:'Εκδόθηκε τιμολόγιο'}).uncheck();
  await confirm('Επιβεβαίωση διόρθωσης');
  Object.assign(changed,{paid:false,invoiced:false,paidAt:null,invoicedAt:null});
  await openReports();
  await scenario('withdrawn dates appear as dashes immediately', () => verifyRange(2,2));
  await button('Κεντρική').click();
  await scenario('combined completion and collection roll back together on failure', async () => {
    db.exec("CREATE TRIGGER reject_test BEFORE UPDATE OF amount ON monthly_task_status BEGIN SELECT RAISE(ABORT,'test write rejected'); END");
    try {
      await paid.click();
      await dialog.getByRole('button',{name:'Ολοκλήρωση και είσπραξη'}).click();
      await dialog.getByRole('alert').waitFor();
      assert.deepEqual([saved().status,saved().is_paid],['pending',0]);
    } finally { db.exec('DROP TRIGGER reject_test'); }
    await confirm('Ολοκλήρωση και είσπραξη');
    assert.deepEqual([saved().status,saved().is_paid,saved().paid_at],['completed',1,'2024-02-29']);
  });
  changed.paid = true;
  changed.paidAt = '2024-02-29';
  await openReports();
  db.prepare(`INSERT INTO client_task_assignments(client_id,task_type_id,start_date,end_date,is_active)
    VALUES(1,1,'2022-01-01','2022-12-31',0)`).run();
  await period('Ετήσια');
  await scenario('one billed row when an older inactive assignment also exists for the same service', async () => {
    const actual = (await table())[0];
    const correct = expected(1,12)[0];
    assert.equal(actual.total, correct.total, 'Άλφα: ' + actual.rows.length + ' lines and ' + actual.total +
      ', expected ' + correct.rows.length + ' lines and ' + correct.total);
    await verifyRange(1,12);
  });
  await scenario('past collections remain in the report after removing a client assignment', async () => {
    await button('Κεντρική').click();
    await page.locator('.panel-collapse-toggle[aria-controls="client-list-panel"]').click();
    await page.locator('.client-item').filter({hasText:clients[1]}).dblclick();
    await page.getByRole('dialog',{name:'Καρτέλα πελάτη Βήτα'}).waitFor();
    await button('Αφαίρεση της εργασίας Βιβλία').click();
    await button('Ναι, αφαίρεση').click();
    await page.getByRole('dialog',{name:'Αφαίρεση εργασίας'}).waitFor({state:'hidden'});
    await page.getByRole('dialog',{name:'Καρτέλα πελάτη Βήτα'}).getByRole('button',{name:'Κλείσιμο',exact:true}).click();
    assert.equal(db.prepare('SELECT count(*) n FROM monthly_task_status WHERE client_id=2 AND task_type_id=1 AND year=2024').get().n,12);
    assert.equal(db.prepare('SELECT count(*) n FROM client_task_assignments WHERE client_id=2 AND task_type_id=1').get().n,0);
    await openReports();
    await period('Μηνιαία'); await period('Ετήσια');
    await chooseClient(2);
    const [actual] = await table();
    const [correct] = expected(1,12,2);
    assert.equal(actual.total,correct.total,'Βήτα: ' + actual.rows.length + ' lines and ' + actual.total +
      ', expected ' + correct.rows.length + ' lines and ' + correct.total);
  });
}

(async () => {
  fixture();
  const browser = await chromium.launch({channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH});
  try {
    const page = await browser.newPage({locale:'en-US',timezoneId:'Europe/Athens',viewport:{width:1440,height:900}});
    await run(page);
  } finally { await browser.close(); db.close(); }
  if (failures.length) throw Error(failures.length + ' failing scenarios: ' + failures.join(' | '));
})().catch(err => { console.error(err.message); process.exitCode = 1; });

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
const date = iso => iso ? iso.split('-').reverse().map(Number).join('/') : '—';

function fixture() {
  const migration = fs.readFileSync(path.join(__dirname, '../../src-tauri/src/migration.rs'), 'utf8');
  const statements = migration.split('let migrations = [')[1].split('];')[0];
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
      rows.push({ client, task, month, cents, paidAt, invoicedAt });
      insert.run(client, task, year, month, month % 2 ? 'pending' : 'completed', cents === null ? null : cents / 100,
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
  const clientFilter = page.getByLabel('Φίλτρο αναφορών ανά πελάτη');
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
          groups.push({ name: tr.cells[0].innerText.replace(/[▾▸]/g, '').trim(), total: tr.cells[1].innerText, rows: [] });
        } else {
          groups.at(-1).rows.push([tr.querySelector('.report-service-label').innerText, tr.querySelector('.report-service-month').innerText,
            ...Array.from(tr.cells).slice(1).map(td => td.innerText)]);
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
      if (sort) chosen.sort((a, b) => sort * (a.cents - b.cents));
      const sum = chosen.reduce((acc, r) => acc + (r.cents ?? 0), 0);
      groups.push({ name, sum, total: euros(sum), rows: chosen.map(r => [
        tasks[r.task - 1], new Date(year, r.month - 1, 1).toLocaleDateString('el-GR', {month: 'short', year: 'numeric'}),
        euros(r.cents ?? 0), date(r.paidAt), date(r.invoicedAt),
      ])});
    }
    if (sort) groups.sort((a,b) => sort * (a.sum - b.sum));
    return groups.map(({sum, ...group}) => group);
  };
  async function verifyRange(lo, hi, only, sort) {
    assert.deepEqual(await table(), expected(lo, hi, only, sort));
    const title = lo === hi ? names[lo-1] : lo === 1 && hi === 12 ? 'Έτος' : names[lo-1] + ' – ' + names[hi-1];
    assert.equal(await page.locator('.reports-range-label').innerText(), title + ' 2024' + (hi > lo ? ' · ' + (hi-lo+1) + ' μήνες' : ''));
  }
  await openReports();
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
    for (const id of [1,2,3]) { await clientFilter.selectOption(String(id)); await verifyRange(1,12,id); }
    await clientFilter.selectOption('');
    const sort = page.locator('.report-sort-button');
    for (const direction of [1,-1,0]) { await sort.click(); await verifyRange(1,12,null,direction); }
    await page.locator('.report-client-toggle').first().click();
    const folded = await table();
    assert.equal(folded[0].rows.length, 0);
    assert.deepEqual(folded.slice(1), expected(1,12).slice(1));
    await page.locator('.report-client-toggle').first().click();
    await verifyRange(1,12);
  });
  await scenario('four columns accessible at desktop and narrow widths, including print layout', async () => {
    for (const width of [1440,1024,390]) {
      await page.setViewportSize({width,height:900});
      const headings = page.locator('.report-table thead th');
      assert.equal(await headings.count(),4);
      for (const heading of await headings.all()) { await heading.scrollIntoViewIfNeeded(); assert.ok(await heading.isVisible()); }
      const last = page.locator('.report-service-row').first().locator('td').last();
      await last.scrollIntoViewIfNeeded();
      assert.ok(await last.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left < innerWidth && r.right > 0;
      }));
    }
    await page.setViewportSize({width:1440,height:900});
    await page.emulateMedia({media:'print'});
    assert.ok(await page.locator('.report-table').isVisible());
    await verifyPrintColumns();
    await page.emulateMedia({media:'screen'});
  });
  async function verifyPrintColumns() {
    for (const cell of await page.locator('.report-service-row').first().locator('td').all()) assert.ok(await cell.isVisible());
  }
  await page.emulateMedia({media:'screen'});
  await page.setViewportSize({width:1440,height:900});
  await scenario('previous year by service month, and entirely empty next year', async () => {
    await chooseMonth(1);
    await button('Προηγούμενος μήνας').click();
    assert.deepEqual((await table()).map(g => [g.total, g.rows[0].slice(2)]), [['888,88 €',['888,88 €','4/1/2024','—']]]);
    await button('Επόμενος μήνας').click();
    await chooseMonth(12);
    await button('Επόμενος μήνας').click();
    assert.deepEqual(await table(), []);
    assert.match(await page.locator('.reports-view').innerText(), /Δεν υπάρχουν εργασίες/);
    await button('Προηγούμενος μήνας').click();
  });
  await chooseMonth(2);
  await period('Ετήσια');
  await clientFilter.selectOption('3');
  await period('Μηνιαία');
  await scenario('recover from a selected client absent in the new month', async () => {
    await settle();
    // Either a visible reset/filter or an automatic return to all clients is valid.
    if (await clientFilter.isVisible()) await clientFilter.selectOption('');
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
  const dates = task.locator('input[type=date]');
  const saved = () => db.prepare('SELECT * FROM monthly_task_status WHERE client_id=1 AND task_type_id=1 AND year=2024 AND month=2').get();
  const ready = () => amount.evaluate(el => new Promise(resolve => {
    const check = () => el.disabled ? requestAnimationFrame(check) : resolve();
    requestAnimationFrame(check);
  }));
  await amount.fill('1.234,56'); await amount.press('Enter'); await ready();
  await paid.click(); await ready();
  if (await invoiced.isChecked()) { await invoiced.click(); await ready(); }
  await invoiced.click(); await ready();
  await scenario('default collection and invoice dates use the local day in Athens', async () => {
    assert.deepEqual([saved().paid_at,saved().invoiced_at], ['2024-02-29','2024-02-29']);
  });
  await dates.nth(0).fill('2024-03-02'); await ready();
  await dates.nth(1).fill('2024-02-29'); await ready();
  await scenario('worklist persists edited amount and distinct financial dates', async () => {
    const r = saved();
    assert.deepEqual([r.amount,r.paid_at,r.invoiced_at],[1234.56,'2024-03-02','2024-02-29']);
  });
  Object.assign(rows.find(r => r.client === 1 && r.task === 1 && r.month === 2),
    { cents:123456, paidAt:'2024-03-02', invoicedAt:'2024-02-29' });
  await openReports();
  await scenario('opening Reports immediately reflects the saved edits', () => verifyRange(2,2));
  await period('Ετήσια'); await period('Μηνιαία');
  await scenario('after requery, the edited amount and both dates appear in the correct cells', () => verifyRange(2,2));
  await button('Κεντρική').click();
  await paid.click(); await ready();
  await invoiced.click(); await ready();
  await scenario('withdrawing collection and invoice clears the stored dates', async () => {
    const r = saved(); assert.deepEqual([r.is_paid,r.paid_at,r.is_invoiced,r.invoiced_at],[0,null,0,null]);
  });
  Object.assign(rows.find(r => r.client === 1 && r.task === 1 && r.month === 2),{paidAt:null,invoicedAt:null});
  await openReports(); await period('Ετήσια'); await period('Μηνιαία');
  await scenario('withdrawn dates appear as dashes after refresh', () => verifyRange(2,2));
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
    await clientFilter.selectOption('2');
    const [actual] = await table();
    const [correct] = expected(1,12,2);
    assert.equal(actual.total,correct.total,'Βήτα: ' + actual.rows.length + ' lines and ' + actual.total +
      ', expected ' + correct.rows.length + ' lines and ' + correct.total);
  });
}

(async () => {
  fixture();
  const browser = await chromium.launch({channel:'chromium',headless:true});
  try {
    const page = await browser.newPage({locale:'el-GR',timezoneId:'Europe/Athens',viewport:{width:1440,height:900}});
    await run(page);
  } finally { await browser.close(); db.close(); }
  if (failures.length) throw Error(failures.length + ' failing scenarios: ' + failures.join(' | '));
})().catch(err => { console.error(err.message); process.exitCode = 1; });

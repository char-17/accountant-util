// A screen-wide check for the things that only go wrong when more than one thing
// is on screen at a time: two controls claiming the same id, a label pointing at
// nothing or at several things, a duplicate React key, a button inside a button.
//
// These are all invisible in a component test that mounts one thing, which is
// exactly why they survive: the dashboard keeps the "new client" modal mounted
// behind the client tab, and nothing in the app renders them one at a time.
//
// Reads the tree and asserts; changes nothing.

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const src = path.join(__dirname, 'src');

// ── Harness, same shape as verify-ui-render ───────────────────────────────────
const entry = path.join(__dirname, '.tmp-duplicates-entry.ts');
const bundle = path.join(__dirname, '.tmp-duplicates-bundle.cjs');
require('fs').writeFileSync(
  entry,
  [
    'export { ClientList } from "./src/components/ClientList";',
    'export { ClientForm } from "./src/components/ClientForm";',
    'export { ClientTab } from "./src/components/ClientTab";',    'export { WorklistFiltersBar } from "./src/components/WorklistFiltersBar";',
    'export { ProfessionCatalog } from "./src/components/ProfessionCatalog";',
    'export { ReportsView } from "./src/components/ReportsView";',
    'export { MonthlySummary } from "./src/components/MonthlySummary";',
    'export { CloseGuard } from "./src/components/CloseGuard";',
  ].join('\n'),
  'utf8'
);
esbuild.buildSync({
  entryPoints: [entry], bundle: true, outfile: bundle,
  format: 'cjs', platform: 'node',
  external: ['react', 'react-dom', 'react-dom/client', '@tauri-apps/*'],
});
const ui = require(bundle);

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.Event = dom.window.Event;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react');
// ── Reporting ─────────────────────────────────────────────────────────────────
let failures = 0;
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
}

/** Everything the checks below look at, for one mounted tree. */
function audit(node) {
  const all = Array.from(node.querySelectorAll('*'));

  const ids = new Map();
  for (const el of all) {
    const id = el.getAttribute?.('id');
    if (!id) continue;
    if (!ids.has(id)) ids.set(id, []);
    ids.get(id).push(el);
  }
  const duplicates = [...ids].filter(([, els]) => els.length > 1);

  // A label's `for` has to resolve to exactly one element in the document.
  const badLabels = all
    .filter((el) => el.tagName === 'LABEL' && el.getAttribute('for'))
    .map((el) => {
      const target = el.getAttribute('for');
      const found = node.ownerDocument.querySelectorAll(`[id="${target.replace(/"/g, '\\"')}"]`);
      return { text: el.textContent.trim(), target, count: found.length };
    })
    .filter((l) => l.count !== 1);

  // aria-labelledby / aria-describedby / aria-controls must resolve too.
  const badRefs = all
    .filter((el) =>
      ['aria-labelledby', 'aria-describedby', 'aria-controls'].some((a) => el.getAttribute(a))
    )
    .map((el) => ({
      attr: el.getAttribute('aria-labelledby') ? 'aria-labelledby'
        : el.getAttribute('aria-describedby') ? 'aria-describedby' : 'aria-controls',
      value: el.getAttribute('aria-labelledby') || el.getAttribute('aria-describedby') || el.getAttribute('aria-controls'),
    }))
    .flatMap((r) => r.value.split(/\s+/).map((v) => ({ ...r, id: v })))
    .filter((r) => !r.id || node.ownerDocument.querySelectorAll(`[id="${r.id.replace(/"/g, '\\"')}"]`).length !== 1);

  // An interactive control inside another one cannot be reached by keyboard.
  const nested = [];
  for (const el of all) {
    if (!['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) continue;
    const parent = el.closest('button, a[href]');
    if (parent && parent !== el) {
      nested.push(`${el.tagName}.${el.className || '(no class)'} inside ${parent.tagName}.${parent.className || '(no class)'}`);
    }
  }

  return { duplicates, badLabels, badRefs, nested };
}

function report(label, node) {
  const r = audit(node);
  check(`${label}: no id claimed twice`,
    r.duplicates.length === 0,
    `- ${r.duplicates.map(([id, els]) => `${id} x${els.length}`).join(', ')}`);
  check(`${label}: every label points at exactly one element`,
    r.badLabels.length === 0,
    `- ${r.badLabels.map((l) => `"${l.text}" -> ${l.count} matches`).join(', ')}`);
  check(`${label}: every aria reference resolves`,
    r.badRefs.length === 0,
    `- ${r.badRefs.map((x) => `${x.attr}="${x.id}" (${node.ownerDocument.querySelectorAll(`[id="${x.id.replace(/"/g, '\\"')}"]`).length} matches)`).join(', ')}`);
  check(`${label}: no control nested inside another`,
    r.nested.length === 0,
    `- ${r.nested.join('; ')}`);
  return r;
}

const container = document.createElement('div');
document.body.appendChild(container);
let reactRoot;

async function render(label, element) {
  await act(async () => {
    if (reactRoot) reactRoot.unmount();
    container.innerHTML = '';
    reactRoot = createRoot(container);
    reactRoot.render(element);
  });
  await act(async () => {});
  return report(label, container);
}

const noop = async () => {};

const TASKS = [
  { id: 1, name: 'ΦΠΑ', color: '#7B8D6E', isActive: true },
  { id: 2, name: 'ΕΝΦΚΑ', color: '#8B9DAD', isActive: true },
];
const PROFESSIONS = [
  { id: 7, name: 'Ελεύθερος Επαγγελματίας', color: '#7B8D6E', isActive: true },
  { id: 8, name: 'Εταιρική Διαχείριση', color: '#C4A882', isActive: true },
];
const CLIENT = {
  id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', taxId: '094123456', notes: '',
  professionId: 8, createdAt: '', updatedAt: '',
};

async function main() {
  console.log('1) two client forms on screen at once');
  // This is the real situation, and it is not hypothetical: opening the client
  // tab leaves the dashboard mounted behind it, and the dashboard is what owns
  // the "new client" modal. Two copies of the form, two sets of ids.
  //
  // Rendered as two forms directly rather than through ClientList, because the
  // modal inside it only mounts from its own click state - going through it
  // would have tested one form and quietly passed.
  const form = (props) =>
    React.createElement(ui.ClientForm, {
      onSubmit: noop,
      professions: PROFESSIONS,
      ...props,
    });
  await render('two forms', React.createElement(
    'div',
    null,
    form({ submitLabel: 'Προσθήκη' }),
    form({
      submitLabel: 'Αποθήκευση αλλαγών',
      initialData: { name: CLIENT.name, professionId: CLIENT.professionId },
    })
  ));

  console.log('\n2) the filter bar with all three pickers');
  await render('filter bar', React.createElement(ui.WorklistFiltersBar, {
    filters: { clientId: null, taskTypeId: null, professionId: null, status: 'all' },
    onStatusChange: noop, onReset: noop,
    isFiltered: true, shownCount: 2, totalCount: 12,
    clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
    taskOptions: TASKS.map((t) => ({ id: t.id, name: t.name })),
    professionOptions: PROFESSIONS.map((p) => ({ id: p.id, name: p.name })),
    professionColors: Object.fromEntries(PROFESSIONS.map((p) => [p.id, p.color])),
    onClientSelect: noop, onTaskSelect: noop, onProfessionSelect: noop,
  }));

  console.log('\n3) the profession catalogue');
  await render('professions', React.createElement(ui.ProfessionCatalog, {
    professions: PROFESSIONS,
    clientCounts: { 7: 3 },
    onCreate: noop, onUpdate: noop, onDelete: noop,
    suggestColor: async () => '#7B8D6E',
  }));

  console.log('\n4) the report table');
  const report = await render('reports', React.createElement(ui.ReportsView, {
    groups: [
      { clientId: 1, clientName: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', totalAmount: 100, paidAmount: 50, invoicedAmount: 0, rows: [
        { key: 'a', taskName: 'ΦΠΑ', taskColor: '#7B8D6E', year: 2026, month: 10, isPaid: false, isInvoiced: false, amount: 100 }] },
      { clientId: 2, clientName: 'BEBJA BLERIM', totalAmount: 0, paidAmount: 0, invoicedAmount: 0, rows: [] },
    ],
    loading: false, year: 2026, month: 10, period: 'month',
    onPeriodChange: noop, customFrom: 1, customTo: 12,
    onCustomRangeChange: noop, isEmpty: false,
  }));

  // The period, the range it selected and the print action share one row, in
  // that order. Checked as structure: nothing about the markup is wrong until
  // it is laid out, and this is the shape being asked for.
  const controls = container.querySelector('.reports-controls');
  check('the controls row exists', Boolean(controls));
  check('the period buttons are in it', Boolean(controls?.querySelector('.reports-period')));
  check('the range label is in it', Boolean(controls?.querySelector('.reports-range-label')));
  check('the print button is in it', Boolean(controls?.querySelector('.reports-print')));
  check('reading left to right: period, range, print',
    /reports-period[\s\S]*reports-range-label[\s\S]*reports-print/.test(controls?.innerHTML || ''),
    `- got: ${(controls?.innerHTML || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}`);
  check('and the print button asks to print',
    controls?.querySelector('.reports-print')?.textContent === 'Εκτύπωση');
  // The buttons and the print action are what the @media print block hides.
  const css = fs.readFileSync(path.join(__dirname, 'src', 'App.css'), 'utf8');
  const printBlock = (css.match(/@media print \{[\s\S]*?\n\}/) || [''])[0];
  check('and the print stylesheet drops the buttons',
    /\.reports-print/.test(printBlock) && /\.reports-period/.test(printBlock));
  check('but keeps the range label, which is worth reading on paper',
    !/\.reports-range-label[^{]*\{[^}]*display:\s*none/.test(printBlock));
  check('the document title is the application, not the build template',
    /<title>Accountant Util<\/title>/.test(
      fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')));

  void report;

  console.log('\n5) the month summary, and the confirm dialog behind it');
  const confirming = await render('summary', React.createElement(
    'div',
    null,
    React.createElement(ui.MonthlySummary, {
      summary: { year: 2026, month: 10, totalClients: 1, totalTasks: 3, completedTasks: 1, pendingTasks: 2, clientProgress: [] },
      year: 2026, month: 10, isFiltered: false,
    }),
    // A second modal at the same time: the summary's client list can raise one
    // while the delete confirmation is up.
    React.createElement('div', { className: 'modal-backdrop' },
      React.createElement('div', { className: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Διαγραφή' },
        React.createElement('h3', { id: 'x' }, 'Διαγραφή'),
        React.createElement('button', { className: 'btn-danger' }, 'Ναι')
      )
    )
  ));

  console.log('\n6) the close guard alongside everything');
  await render('close guard', React.createElement(
    'div',
    null,
    React.createElement(ui.WorklistFiltersBar, {
      filters: { clientId: null, taskTypeId: null, professionId: null, status: 'all' },
      onStatusChange: noop, onReset: noop,
      isFiltered: false, shownCount: 0, totalCount: 0,
      clientOptions: [], taskOptions: [], professionOptions: [],
      onClientSelect: noop, onTaskSelect: noop, onProfessionSelect: noop,
    }),
    React.createElement(ui.CloseGuard, { win: { onCloseRequested: async () => () => {}, close: async () => {} } })
  ));

  console.log('\n7) two close guards, which no one would render on purpose');
  const guard = ui.CloseGuard;
  await render('two guards', React.createElement(
    'div', null,
    React.createElement(guard, { win: { onCloseRequested: async () => () => {}, close: async () => {} } }),
    React.createElement(guard, { win: { onCloseRequested: async () => () => {}, close: async () => {} } })
  ));

  await act(async () => { if (reactRoot) reactRoot.unmount(); });
  container.remove();
  for (const f of [entry, bundle]) fs.unlinkSync(f);

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('\nHarness crashed:', err); process.exit(1); });

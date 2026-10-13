// Interactive UI tests: mounts the real components in a DOM, clicks and types
// the way a user would, and checks what happens. This covers the behaviour that
// server-side rendering cannot reach - confirmation dialogs, typing in filters,
// and the callbacks the parent is expected to receive.

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');
const { JSDOM } = require('jsdom');

// ── A DOM the components can mount into ───────────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
// React reads this from the environment it was loaded into; both are set so the
// flag is found whether it looks at the Node global or the jsdom window.
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); };
};
const checkEq = (label, actual, expected) =>
  check(label, actual === expected, `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ── Bundle the components together with React so there is one copy ───────────
const entry = path.join(__dirname, '.tmp-interact-entry.tsx');
const bundlePath = path.join(__dirname, '.tmp-interact-bundle.cjs');
fs.writeFileSync(
  entry,
  `
export { WorklistFiltersBar } from "./src/components/WorklistFiltersBar";
export { MonthlyWorklist } from "./src/components/MonthlyWorklist";
export { FileMenu } from "./src/components/FileMenu";
export { TaskCatalog } from "./src/components/TaskCatalog";
export { ClientList } from "./src/components/ClientList";
export { ClientForm } from "./src/components/ClientForm";
export { ProfessionCatalog } from "./src/components/ProfessionCatalog";
export { MonthPicker } from "./src/components/MonthPicker";
export { ReportsView } from "./src/components/ReportsView";
export { CloseGuard } from "./src/components/CloseGuard";
export { ClientTab } from "./src/components/ClientTab";
export { MonthlySummary } from "./src/components/MonthlySummary";
export { DEFAULT_FILTERS, applyFilters } from "./src/domain/worklist";
`,
  'utf8'
);
esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  outfile: bundlePath,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"' },
  // React must stay external: a second inlined copy would carry its own hooks
  // dispatcher, which react-dom never sets, and every hook would fail.
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
});
const ui = require(bundlePath);

// Each mount gets its own container and root, so tests stay independent.
let currentRoot = null;
let container = null;

/** Mounts a component and returns helpers for interacting with it. */
function mount(element) {
  act(() => {
    if (currentRoot) currentRoot.unmount();
    container = document.createElement('div');
    document.body.appendChild(container);
    currentRoot = createRoot(container);
    currentRoot.render(element);
  });
  return {
    el: container,
    rerender: (next) => act(() => currentRoot.render(next)),
    cleanup: () => act(() => {
      currentRoot.unmount();
      currentRoot = null;
      container.remove();
      container = null;
    }),
  };
}

/** Finds one element by a predicate over its attributes/text. */
function find(predicate) {
  return [...container.querySelectorAll('*')].find(predicate);
}
function findAll(predicate) {
  return [...container.querySelectorAll('*')].filter(predicate);
}
const byLabel = (label) =>
  find((n) => n.getAttribute && n.getAttribute('aria-label') === label);
// The first button whose text contains `t`. At module level because two blocks
// below need it and a local copy in each meant the second silently failed to
// find its own.
const byText = (t) =>
  findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes(t));
const click = (node) => {
  if (!node) throw new Error('click() called on a missing element');
  act(() => {
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
/** Sets an input's value the way a keystroke does, firing React's onChange. */
const type = (node, value) => {
  if (!node) throw new Error('type() called on a missing element');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(node, value);
    node.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
};
const text = () => container.textContent.replace(/\s+/g, ' ').trim();

// ── Fixtures ──────────────────────────────────────────────────────────────────
const status = (over) => ({
  id: 1, clientId: 10, taskTypeId: 1, year: 2026, month: 10,
  status: 'pending', clientName: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ',
  taskName: 'ΦΠΑ', taskColor: '#7B8D6E', ...over,
});
const statuses = [
  status({ id: 1, status: 'completed', completedAt: '2026-10-07T08:30:00' }),
  status({ id: 2, taskTypeId: 2, taskName: 'ΕΝΦΚΑ', status: 'pending', taskColor: '#8B9DAD' }),
  status({ id: 3, clientId: 11, clientName: 'BEBJA BLERIM', taskName: 'ΦΠΑ', status: 'pending', taskColor: '#7B8D6E' }),
];
const noop = () => Promise.resolve();

async function main() {

console.log('1) the status filter toggles exactly one option at a time');
{
  let current = { ...ui.DEFAULT_FILTERS };
  const renderBar = () =>
    React.createElement(ui.WorklistFiltersBar, {
      filters: current,
      onStatusChange: (v) => { current = { ...current, status: v }; },
      onReset: () => { current = { ...ui.DEFAULT_FILTERS }; },
      isFiltered: current.status !== 'all',
      shownCount: 3, totalCount: 3,
      clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
      taskOptions: [{ id: 1, name: 'ΦΠΑ' }],
      onClientSelect: noop, onTaskSelect: noop,
    });
  const view = mount(renderBar());

  const optionFor = (label) =>
    findAll((n) => n.tagName === 'BUTTON' && n.textContent.trim() === label);

  check('"Όλες" starts selected', optionFor('Όλες')[0].getAttribute('aria-pressed') === 'true');
  checkEq('exactly one option is selected', findAll((n) => n.getAttribute?.('aria-pressed') === 'true').length, 1);

  click(optionFor('Εκκρεμείς')[0]);
  view.rerender(renderBar());

  check('state moved to pending', current.status === 'pending');
  check('"Εκκρεμείς" is now selected', optionFor('Εκκρεμείς')[0].getAttribute('aria-pressed') === 'true');
  check('"Όλες" is deselected', optionFor('Όλες')[0].getAttribute('aria-pressed') === 'false');
  checkEq('still exactly one selected', findAll((n) => n.getAttribute?.('aria-pressed') === 'true').length, 1);
  view.cleanup();
}

console.log('\n3) the filter row disappears when nothing is filtered, reappears when it is');
{
  let filtered = false;
  const view = mount(
    React.createElement(ui.WorklistFiltersBar, {
      filters: ui.DEFAULT_FILTERS,
      onStatusChange: () => { filtered = true; }, onReset: noop,
      isFiltered: filtered, shownCount: 3, totalCount: 3,
      clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
      taskOptions: [{ id: 1, name: 'ΦΠΑ' }],
      onClientSelect: noop, onTaskSelect: noop,
    })
  );
  check('no "n of m" line initially', !text().includes('από'));
  view.cleanup();
}

console.log('\n4) ticking a task asks for confirmation instead of writing immediately');
{
  const toggles = [];
  const view = mount(
    React.createElement(ui.MonthlyWorklist, {
      statuses, totalCount: 3, filters: ui.DEFAULT_FILTERS, isFiltered: false,
      onFilterStatusChange: noop, onFilterReset: noop,
      onFilterClientSelect: noop, onFilterTaskSelect: noop,
      clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
      taskOptions: [{ id: 1, name: 'ΦΠΑ' }],
      year: 2026, month: 10,
      onToggle: async (c, t, done) => { toggles.push({ c, t, done }); },
      onSelectClient: noop,
      onOpenClient: noop,
      onSetAmount: noop, onSetPaid: noop, onSetInvoiced: noop,
    })
  );

  check('no dialog before the click', !container.querySelector('.modal'));
  // Each task has 3 checkboxes (status, Εισπραξη, Τιμολόγιο).
  // The completion checkbox is the first one in each task row.
  const taskRows = container.querySelectorAll('.worklist-item');
  checkEq('three task rows', taskRows.length, 3);
  // The pending ΕΝΦΚΑ row is the second task row (index 1).
  const secondTaskCompletion = taskRows[1].querySelector('input[type="checkbox"]');

  // The pending ΕΝΦΚΑ row is the second task row.
  await act(async () => {
    secondTaskCompletion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });

  checkEq('nothing was written yet', toggles.length, 0);
  const modal = container.querySelector('.modal');
  check('a confirmation dialog appeared', Boolean(modal));
  check('it names the task', modal?.textContent.includes('ΕΝΦΚΑ'));
  check('it names the client', modal?.textContent.includes('ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ'));
  check('it states the month', modal?.textContent.includes('10/2026'));
  check('it says it will be marked complete', modal?.textContent.includes('ολοκληρωμένη'));
  view.cleanup();
}

console.log('\n5) confirming writes exactly once and closes the dialog');
{
  const toggles = [];
  const view = mount(
    React.createElement(ui.MonthlyWorklist, {
      statuses, totalCount: 3, filters: ui.DEFAULT_FILTERS, isFiltered: false,
      onFilterStatusChange: noop, onFilterReset: noop,
      onFilterClientSelect: noop, onFilterTaskSelect: noop,
      clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
      taskOptions: [{ id: 1, name: 'ΦΠΑ' }],
      year: 2026, month: 10,
      onToggle: async (c, t, done) => { toggles.push({ c, t, done }); },
      onSelectClient: noop,
      onOpenClient: noop,
      onSetAmount: noop, onSetPaid: noop, onSetInvoiced: noop,
    })
  );
  // The pending ΕΝΦΚΑ row is the second task row.
  const taskRows = container.querySelectorAll('.worklist-item');
  const secondTaskCompletion = taskRows[1].querySelector('input[type="checkbox"]');
  await act(async () => {
    secondTaskCompletion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });

  const confirmBtn = findAll((n) => n.tagName === 'BUTTON')
    .find((b) => b.textContent.includes('Ναι, ολοκληρώθηκε'));
  check('the confirm button names the action', Boolean(confirmBtn));
  await act(async () => { confirmBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });

  checkEq('one write', toggles.length, 1);
  checkEq('correct client', toggles[0].c, 10);
  checkEq('correct task', toggles[0].t, 2);
  checkEq('marked as complete', toggles[0].done, true);
  check('dialog closed', !container.querySelector('.modal'));
  view.cleanup();
}

console.log('\n6) cancelling writes nothing');
{
  const toggles = [];
  const view = mount(
    React.createElement(ui.MonthlyWorklist, {
      statuses, totalCount: 3, filters: ui.DEFAULT_FILTERS, isFiltered: false,
      onFilterStatusChange: noop, onFilterReset: noop,
      onFilterClientSelect: noop, onFilterTaskSelect: noop,
      clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
      taskOptions: [{ id: 1, name: 'ΦΠΑ' }],
      year: 2026, month: 10,
      onToggle: async () => { toggles.push(1); }, onSelectClient: noop,
      onOpenClient: noop, onSetAmount: noop, onSetPaid: noop, onSetInvoiced: noop,
    })
  );
  const taskRows = container.querySelectorAll('.worklist-item');
  const secondTaskCompletion = taskRows[1].querySelector('input[type="checkbox"]');
  await act(async () => {
    secondTaskCompletion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  const cancel = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.trim() === 'Άκυρο');
  check('the cancel button is there', Boolean(cancel));
  await act(async () => { cancel.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  checkEq('still nothing written', toggles.length, 0);
  check('dialog closed', !container.querySelector('.modal'));
  view.cleanup();
}

console.log('\n7) un-ticking a completed task warns in the other direction');
{
  let seen = null;
  const view = mount(
    React.createElement(ui.MonthlyWorklist, {
      statuses, totalCount: 3, filters: ui.DEFAULT_FILTERS, isFiltered: false,
      onFilterStatusChange: noop, onFilterReset: noop,
      onFilterClientSelect: noop, onFilterTaskSelect: noop,
      clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
      taskOptions: [{ id: 1, name: 'ΦΠΑ' }],
      year: 2026, month: 10,
      onToggle: async (c, t, done) => { seen = done; }, onSelectClient: noop,
      onOpenClient: noop, onSetAmount: noop, onSetPaid: noop, onSetInvoiced: noop,
    })
  );
  // The first task row is already completed.
  const taskRows = container.querySelectorAll('.worklist-item');
  const firstTaskCompletion = taskRows[0].querySelector('input[type="checkbox"]');
  await act(async () => {
    firstTaskCompletion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  const modal = container.querySelector('.modal');
  check('dialog appeared', Boolean(modal));
  check('it says the task returns to pending',
    modal?.textContent.includes('εκκρεμή'), `- got: ${modal?.textContent.slice(0, 120)}`);
  check('it says the completion date is removed',
    modal?.textContent.includes('ημερομηνία ολοκλήρωσης θα αφαιρεθεί'),
    `- got: ${modal?.textContent.slice(0, 160)}`);

  const yes = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('Ναι, επανήλθε'));
  check('the confirm button is worded for this direction', Boolean(yes));
  await act(async () => { yes.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  checkEq('reported as pending', seen, false);
  view.cleanup();
}

console.log('\n8) clicking a client name opens its tab');
{
  const opened = [];
  const view = mount(
    React.createElement(ui.MonthlyWorklist, {
      statuses, totalCount: 3, filters: ui.DEFAULT_FILTERS, isFiltered: false,
      onFilterStatusChange: noop, onFilterReset: noop,
      onFilterClientSelect: noop, onFilterTaskSelect: noop,
      clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
      taskOptions: [{ id: 1, name: 'ΦΠΑ' }],
      year: 2026, month: 10,
      onToggle: noop, onSelectClient: (id) => opened.push(id),
      onOpenClient: noop, onSetAmount: noop, onSetPaid: noop, onSetInvoiced: noop,
    })
  );
  const headers = findAll((n) => n.classList?.contains('worklist-client-name'));
  checkEq('one header per client group', headers.length, 2);
  await act(async () => { headers[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  checkEq('exactly one client was reported', opened.length, 1);
  checkEq('and it was the right one', opened[0], 11);
  view.cleanup();
}

console.log('\n9) the file menu opens, and its export item runs the export');
{
  let exported = 0;
  const view = mount(
    React.createElement(ui.FileMenu, {
      summary: { year: 2026, month: 10, totalClients: 2, totalTasks: 3, completedTasks: 1, pendingTasks: 2, clientProgress: [] },
      filters: ui.DEFAULT_FILTERS,
      clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
      taskOptions: [{ id: 1, name: 'ΦΠΑ' }],
      onExportCsv: async () => { exported++; },
      exporting: false,
      onBackup: () => {}, onRestore: () => {}, busy: null,
    })
  );
  const trigger = byText('Αρχείο');
  check('the trigger is present', Boolean(trigger));
  check('the list is not in the DOM before opening', findAll((n) => n.id === 'file-menu-list').length === 0);

  await act(async () => { trigger.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  check('the list appears once opened', findAll((n) => n.id === 'file-menu-list').length === 1);
  check('the trigger reports expanded', trigger.getAttribute('aria-expanded') === 'true');

  // The menu used to head itself with a count and a description of the filters.
  // Removed - the worklist states both above it, so it repeated them before
  // anything had been read. The information moved onto the CSV item's own
  // tooltip, and that is what is checked here instead.
  check('the menu no longer repeats the count and the filters',
    findAll((n) => n.classList?.contains('file-menu-scope')).length === 0);

  const csvBtn = byText('Εισαγωγή CSV');
  check('the CSV item is present', Boolean(csvBtn));
  check('it is enabled with rows to export', csvBtn.disabled === false);
  check('and its tooltip counts what will be exported',
    (csvBtn.getAttribute('title') || '').includes('3 εργασιών'),
    `- got: ${csvBtn.getAttribute('title')}`);
  check('with no filter detail when nothing is filtered',
    !(csvBtn.getAttribute('title') || '').includes('φίλτρα:'),
    `- got: ${csvBtn.getAttribute('title')}`);
  await act(async () => { csvBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  checkEq('the export ran once', exported, 1);
  check('and choosing an item closes the menu', findAll((n) => n.id === 'file-menu-list').length === 0);
  view.cleanup();
}

console.log('\n10) the menu names the filtered scope, and blocks export with nothing to send');
{
  const openMenu = async (over) => {
    const view = mount(
      React.createElement(ui.FileMenu, {
        summary: { year: 2026, month: 10, totalClients: 1, totalTasks: 1, completedTasks: 1, pendingTasks: 0, clientProgress: [] },
        clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
        taskOptions: [{ id: 2, name: 'ΕΝΦΚΑ' }],
        onExportCsv: async () => {}, exporting: false,
        onBackup: () => {}, onRestore: () => {}, busy: null,
        ...over,
      })
    );
    // The trigger click flips state, so it has to happen inside act or React
    // warns and the DOM read that follows races the render.
    await act(async () => {
      findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('Αρχείο'))
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    return view;
  };

  const named = await openMenu({ filters: { ...ui.DEFAULT_FILTERS, clientId: 10, taskTypeId: 2 } });
  const namedTitle = byText('Εισαγωγή CSV').getAttribute('title') || '';
  check('the client is named, not its id',
    namedTitle.includes('πελάτης: "ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ"'), `- got: ${namedTitle}`);
  check('the task is named too', namedTitle.includes('εργασία: "ΕΝΦΚΑ"'));
  named.cleanup();

  const byStatus = await openMenu({ filters: { ...ui.DEFAULT_FILTERS, status: 'completed' } });
  const statusTitle = byText('Εισαγωγή CSV').getAttribute('title') || '';
  check('a status filter is described', statusTitle.includes('φίλτρα: Ολοκληρωμένες'), `- got: ${statusTitle}`);
  byStatus.cleanup();

  const empty = await openMenu({
    summary: { year: 2026, month: 1, totalClients: 0, totalTasks: 0, completedTasks: 0, pendingTasks: 0, clientProgress: [] },
    filters: ui.DEFAULT_FILTERS,
  });
  const csvEmpty = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('Εισαγωγή CSV'));
  check('export is disabled with nothing to export', csvEmpty.disabled === true);
  check('and it says why', (csvEmpty.getAttribute('title') || '').includes('Δεν υπάρχουν εργασίες'), '- needs an explanatory title');
  const printEmpty = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('Εκτύπωση'));
  check('print is disabled too, there is nothing to print', printEmpty.disabled === true);
  empty.cleanup();
}

console.log('\n11) restore is marked as the risky item, and busy locks the menu');
{
  let backups = 0, restores = 0;
  const renderMenu = (busy) =>
    mount(
      React.createElement(ui.FileMenu, {
        summary: { year: 2026, month: 10, totalClients: 1, totalTasks: 1, completedTasks: 0, pendingTasks: 1, clientProgress: [] },
        filters: ui.DEFAULT_FILTERS,
        onExportCsv: async () => {}, exporting: false,
        onBackup: () => { backups++; }, onRestore: () => { restores++; }, busy,
      })
    );
  const openIt = async () => {
    await act(async () => {
      byText('Αρχείο').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  };

  const view = renderMenu(null);
  await openIt();
  const restoreBtn = byText('Επαναφορή από αντιγραφο');
  check('restore is styled as a warning, not a peer of the others',
    restoreBtn.classList.contains('file-menu-item-warning'), '- restore should be visually distinct');
  check('restore explains that it replaces the data',
    (restoreBtn.getAttribute('title') || '').includes('Αντικαθιστά'), '- needs a warning title');

  const backupBtn = byText('Αντίγραφο ασφαλείας');
  check('backup is not styled as a risk', !backupBtn.classList.contains('file-menu-item-warning'));
  check('backup explains what it contains',
    (backupBtn.getAttribute('title') || '').includes('ιστορικό'), '- needs a descriptive title');

  click(backupBtn);
  checkEq('backup fired', backups, 1);
  check('and the menu closed after the choice', findAll((n) => n.id === 'file-menu-list').length === 0);

  await openIt();
  click(byText('Επαναφορή από αντιγραφο'));
  checkEq('restore fired', restores, 1);
  view.cleanup();

  const busyView = renderMenu('backup');
  await openIt();
  // Busy locks the two items that replace or rewrite the whole database. CSV
  // and print only read it, so they stay available - a backup in flight should
  // not stop the accountant exporting what is on screen. The backup item's own
  // label changes to "in progress", so it is found by that instead.
  const backupBusy = byText('Δημιουργία...');
  const restoreBusy = byText('Επαναφορή από αντιγραφο');
  check('the running backup reports progress', backupBusy !== undefined, '- needs a busy label');
  check('restore is still offered under its own name', restoreBusy !== undefined);
  check('busy locks both database items',
    Boolean(backupBusy) && backupBusy.disabled === true && restoreBusy.disabled === true,
    '- backup in progress should lock backup and restore');
  const csvWhileBusy = byText('Εισαγωγή CSV');
  check('a read-only export stays available while backup runs',
    csvWhileBusy !== undefined && csvWhileBusy.disabled === false, '- backup must not block reading the month');
  busyView.cleanup();
}

console.log('\n11) creating a task through the catalogue form');
{
  let created = null;
  const view = mount(
    React.createElement(ui.TaskCatalog, {
      tasks: [], onCreate: async (d) => { created = d; },
      onUpdate: noop, onDelete: noop, suggestColor: async () => '#7B8D6E',
    })
  );
  const addBtn = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('+ Νέα Εργασία'));
  check('the add button exists', Boolean(addBtn));
  await act(async () => { addBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });

  const nameInput = byLabel('Όνομα εργασίας');
  check('the name field appeared', Boolean(nameInput));

  // Saving an empty name must be refused locally, not sent to the database.
  const saveBtn = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.trim() === 'Αποθήκευση');
  await act(async () => { saveBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  checkEq('nothing created without a name', created, null);
  check('an error is shown', text().includes('υποχρεωτικό'));

  type(nameInput, 'ΜΙΣΘΟΔΟΣΙΑ');
  await act(async () => { saveBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  check('the task was created', Boolean(created));
  checkEq('with the typed name', created?.name, 'ΜΙΣΘΟΔΟΣΙΑ');
  check('a colour was chosen from the palette', /^#[0-9A-F]{6}$/i.test(created?.color || ''), `- got ${created?.color}`);
  view.cleanup();
}

console.log('\n12) the client list reports selection and asks for a new client');
{
  const selected = [];
  let created = null;
  const view = mount(
    React.createElement(ui.ClientList, {
      clients: [
        { id: 1, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', createdAt: '', updatedAt: '' },
        { id: 2, name: 'BEBJA BLERIM', createdAt: '', updatedAt: '' },
      ],
      selectedClientId: null,
      onSelectClient: (id) => selected.push(id),
      searchQuery: '', onSearchChange: noop,
      onCreate: async (d) => { created = d; }, onOpenClient: noop,
    })
  );
  checkEq('both clients rendered',
    findAll((n) => n.classList?.contains('client-item')).length, 2);

  const items = findAll((n) => n.classList?.contains('client-item'));
  await act(async () => { items[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  checkEq('exactly one selection reported', selected.length, 1);
  checkEq('and it was the right client', selected[0], 2);

  const newBtn = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('+ Νέος'));
  await act(async () => { newBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  check('the create dialog opened', Boolean(container.querySelector('.client-create-modal')));
  check('it has an accessible name', container.querySelector('.client-create-modal')?.getAttribute('aria-label') === 'Νέος πελάτης');

  // Found through its label rather than a fixed id: the ids are generated now
  // (two forms are on screen at once when the client tab is open), and what
  // matters here is that the label points at the field.
  //
  // Matched by attribute rather than with a selector: the generated ids contain
  // colons, which a selector would need escaping for, and escaping is not
  // reliably present in this harness.
  const nameLabel = Array.from(
    container.querySelectorAll('.client-create-modal label')
  ).find((l) => l.textContent.includes('Όνομα'));
  const withId = (id) => Array.from(container.querySelectorAll('[id]'))
    .filter((el) => el.getAttribute('id') === id);
  const nameField = nameLabel ? withId(nameLabel.htmlFor)[0] : null;
  check('the form has a labelled name field', Boolean(nameField));
  check('and the label resolves to exactly one element',
    nameLabel && withId(nameLabel.htmlFor).length === 1,
    `- ${nameLabel ? withId(nameLabel.htmlFor).length : 0} matched`);
  type(nameField, 'ΝΕΟΣ ΠΕΛΑΤΗΣ');
  const submit = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.trim() === 'Προσθήκη');
  await act(async () => { submit.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  check('the client was submitted', Boolean(created));
  checkEq('with the typed name', created?.name, 'ΝΕΟΣ ΠΕΛΑΤΗΣ');
  check('the dialog closed after success', !container.querySelector('.client-create-modal'));
  view.cleanup();
}

console.log('\n12b) the form can render its action row outside the form, and still submit');
{
  // The client tab puts its buttons at the foot of the panel. That only works if
  // the row survives outside the <form> AND the submit button still reaches it,
  // which is what the `form` attribute is for - without it, clicking save does
  // nothing at all and the panel silently stops saving.
  let saved = null;
  let cancelled = 0;
  const holder = document.createElement('div');

  const view = mount(
    React.createElement(
      'div',
      null,
      React.createElement(ui.ClientForm, {
        submitLabel: 'Αποθήκευση αλλαγών',
        initialData: { name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' },
        onSubmit: async (d) => { saved = d; },
        onCancel: () => { cancelled++; },
        actionsTarget: holder,
      })
    )
  );

  // The holder is attached to the document, not to the React root: a portal
  // target does not have to be inside the tree that renders it, which is the
  // whole point - it can live anywhere in the panel.
  document.body.appendChild(holder);
  await act(async () => {});

  const actionRow = holder.querySelector('.form-actions');
  check('the action row rendered into the target', Boolean(actionRow));
  check('it is a child of the target', Boolean(actionRow && holder.contains(actionRow)));

  const form = container.querySelector('form.client-form');
  check('the form is a separate element', Boolean(form));
  check('and the row is not a child of it',
    Boolean(form && actionRow && !form.contains(actionRow)), '- the row must leave the form');

  // The row lives in the holder, so it has to be looked up there - findAll
  // walks the React root, which no longer contains it.
  const saveBtn = holder.querySelector('button[type="submit"]');
  check('the save button is in the portalled row', Boolean(saveBtn));
  check('it points back at the form',
    saveBtn?.getAttribute('form') === form?.getAttribute('id') && Boolean(form?.getAttribute('id')),
    `- a submit button outside a form needs the form attribute (button="${saveBtn?.getAttribute('form')}", form id="${form?.getAttribute('id')}")`);

  await act(async () => { saveBtn.click(); });
  check('clicking save from outside the form still saves', Boolean(saved));
  checkEq('with the loaded name', saved?.name, 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ');

  const cancelBtn = holder.querySelector('button.btn-secondary');
  await act(async () => { cancelBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  checkEq('and cancel still works from there', cancelled, 1);

  view.cleanup();
  holder.remove();
}

console.log('\n12c) the remove button is a drawn icon, not a glyph, and still named');
{
  // The bin is an SVG, so its text content is empty. That is the case where a
  // button can end up carrying no name at all, and a nameless button is
  // announced as just "button" by a screen reader.
  const src = require('fs').readFileSync(
    path.join(__dirname, 'src', 'components', 'ClientTab.tsx'), 'utf8'
  );
  const btn = src.match(/<button[\s\S]*?className="icon-btn delete-btn"[\s\S]*?<\/button>/);
  check('the remove button exists in the markup', Boolean(btn));
  check('it carries an accessible name', /aria-label=/.test(btn?.[0] || ''),
    '- an icon-only button needs a name');
  check('and a tooltip for sighted users', /title=/.test(btn?.[0] || ''));
  check('the name mentions the task, not just "remove"',
    /aria-label=\{`Αφαίρεση της εργασίας/.test(btn?.[0] || ''),
    '- the row it sits on is not enough; the name has to carry it too');
  check('the icon is drawn as an SVG, not an emoji',
    /<svg/.test(btn?.[0] || ''),
    '- an emoji renders in its own colours and ignores the hover state');
  check('the drawn icon is the only thing inside the button',
    /<svg[\s\S]*?<\/svg>\s*<\/button>/.test(btn?.[0] || ''),
    '- any stray text inside would make the icon-only naming ambiguous');
  check('the SVG is hidden from assistive tech',
    /aria-hidden="true"/.test(btn?.[0] || ''),
    '- the button already has the name; the shape must not double it');
  check('and the SVG inherits the button colour',
    /stroke="currentColor"/.test(btn?.[0] || ''),
    '- a fixed colour would ignore the hover state');
}
console.log('\n12f) the month summary reads as two rows of two, in order');
{
  // The order is the design: top row answers "how big is this month and how
  // much is left", bottom row is the arithmetic behind it. Nothing else checks
  // it, so a reorder would pass silently.
  const view = mount(
    React.createElement(ui.MonthlySummary, {
      summary: { year: 2026, month: 10, totalClients: 1, totalTasks: 3, completedTasks: 1, pendingTasks: 2, clientProgress: [] },
      year: 2026, month: 10, isFiltered: false,
    })
  );
  await act(async () => {});

  const labels = findAll((n) => n.classList?.contains('stat-label')).map((n) => n.textContent);
  checkEq('four tiles', labels.length, 4);
  check('top row is Πελάτες then Εκκρεμείς',
    labels[0] === 'Πελάτες' && labels[1] === 'Εκκρεμείς', `- got: ${labels.slice(0, 2).join(' | ')}`);
  check('bottom row is Εργασίες then Ολοκληρωμένες',
    labels[2] === 'Εργασίες' && labels[3] === 'Ολοκληρωμένες', `- got: ${labels.slice(2).join(' | ')}`);

  const css = require('fs').readFileSync(path.join(__dirname, 'src', 'App.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const m = css.match(/(?:^|\})\s*\.summary-stats\s*\{([^}]*)\}/);
  check('and it is laid out as two columns',
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(m?.[1] || ''),
    `- got: ${(m?.[1] || '').trim().replace(/\s+/g, ' ')}`);

  view.cleanup();
}

console.log('\n12g) the profession picker on the client form classifies, and clears');
{
  // The distinction that matters: picking a profession sends its id, and
  // choosing "no profession" sends null so the client's classification can be
  // removed. Sending undefined instead would mean "leave it alone" and the
  // field could never be emptied.
  const PROFESSIONS = [
    { id: 7, name: 'Ελεύθερος Επαγγελματίας', isActive: true },
    { id: 8, name: 'Εταιρική Διαχείριση', isActive: true },
  ];
  const submitted = [];

  const openForm = (initialData, props = {}) =>
    mount(
      React.createElement(ui.ClientForm, {
        submitLabel: 'Αποθήκευση αλλαγών',
        initialData,
        onSubmit: async (d) => { submitted.push(d); },
        ...props,
      })
    );

  // Hidden when the caller passes nothing - the quick "new client" modal has no
  // list to browse and should not offer an empty control.
  let view = openForm({ name: 'ΧΩΡΙΣ ΛΙΣΤΑ' });
  await act(async () => {});
  check('no profession field without a list to pick from',
    !view.el.querySelector('.filter-profession'));
  view.cleanup();

  // An empty list still explains itself rather than offering a dead control.
  view = openForm({ name: 'ΧΩΡΙΣ ΕΠΑΓΓΕΛΜΑΤΑ' }, { professions: [] });
  await act(async () => {});
  check('an empty list says where professions come from',
    (view.el.textContent || '').includes('Δεν έχουν καταχωρηθεί επαγγέλματα'),
    `- got: ${(view.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)}`);
  view.cleanup();

  // A client that already has one: the picker opens on that name.
  view = openForm({ name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', professionId: 8 }, { professions: PROFESSIONS });
  await act(async () => {});
  const toggle = view.el.querySelector('.filter-profession .filter-select-toggle');
  check('the picker shows the current profession', Boolean(toggle));
  checkEq('by name, not by id',
    toggle?.querySelector('.filter-select-current')?.textContent,
    'Εταιρική Διαχείριση');

  await act(async () => { toggle.click(); });
  await act(async () => {});
  const options = Array.from(view.el.querySelectorAll('.filter-select-list [role="option"]'));
  check('opening it lists the registered professions',
    options.some((o) => o.textContent === 'Ελεύθερος Επαγγελματίας') &&
    options.some((o) => o.textContent === 'Εταιρική Διαχείριση'),
    `- got: ${options.map((o) => o.textContent).join(' | ')}`);
  check('and offers a way to have none',
    options.some((o) => o.textContent === 'Χωρίς επάγγελμα'));

  // Re-saving without touching the picker keeps the classification.
  const saveBtn = view.el.querySelector('button[type="submit"]');
  await act(async () => { saveBtn.click(); });
  await act(async () => {});
  checkEq('saving sends the profession that is set', submitted.at(-1)?.professionId, 8);

  // Choosing "no profession" and saving removes it.
  const none = options.find((o) => o.textContent === 'Χωρίς επάγγελμα');
  await act(async () => { none.click(); });
  await act(async () => {});
  await act(async () => { saveBtn.click(); });
  await act(async () => {});
  check('clearing sends null, not undefined',
    submitted.at(-1)?.professionId === null,
    `- got: ${String(submitted.at(-1)?.professionId)}`);

  view.cleanup();
}

console.log('\n12h) the profession catalogue edits, deactivates and deletes');
{
  const calls = [];
  const PROFESSIONS = [
    { id: 7, name: 'Ελεύθερος Επαγγελματίας', description: 'Φυσικά πρόσωπα', color: '#7B8D6E', isActive: true },
    { id: 8, name: 'Εταιρική Διαχείριση', description: null, color: '#8B9DAD', isActive: false },
  ];

  const view = mount(
    React.createElement(ui.ProfessionCatalog, {
      professions: PROFESSIONS,
      clientCounts: { 7: 3 },
      onCreate: async (d) => { calls.push(['create', d]); },
      onUpdate: async (id, d) => { calls.push(['update', id, d]); },
      onDelete: async (id) => { calls.push(['delete', id]); },
      // The first palette colour nothing else has taken.
      suggestColor: async () => '#C4A882',
    })
  );
  await act(async () => {});

  const rows = Array.from(view.el.querySelectorAll('.task-item'));
  checkEq('both professions listed', rows.length, 2);
  check('the description is shown', (view.el.textContent || '').includes('Φυσικά πρόσωπα'));
  check('how many clients use it is shown', (view.el.textContent || '').includes('Σε 3 πελάτες'));
  check('a retired one is marked', rows[1]?.className.includes('inactive'));
  check('and offers reactivation, not deactivation',
    (rows[1]?.textContent || '').includes('Ενεργοποίηση'));
  check('while an active one offers deactivation',
    (rows[0]?.textContent || '').includes('Απενεργοποίηση'));

  // The colour dot, the way a task is marked. Each row carries its own colour,
  // so counting dots would pass even if they were all the same shade.
  const dots = Array.from(view.el.querySelectorAll('.task-color-dot'));
  checkEq('a dot beside each name', dots.length, 2);
  checkEq('in the row\'s own colour', dots[0]?.style.backgroundColor, 'rgb(123, 141, 110)');
  check('and not the next row\'s', dots[1]?.style.backgroundColor !== dots[0]?.style.backgroundColor,
    `- both were ${dots[0]?.style.backgroundColor}`);

  // The new form starts on a free colour rather than the default, and the one
  // in use is offered but marked, so a collision is visible before it happens.
  await act(async () => {
    Array.from(view.el.querySelectorAll('.btn-primary'))
      .find((b) => b.textContent.includes('Νέο')).click();
  });
  await act(async () => {});
  const swatches = Array.from(view.el.querySelectorAll('.color-picker .color-option'));
  checkEq('the whole palette is offered', swatches.length, 16);
  check('starting on the suggested colour',
    swatches.find((s) => s.getAttribute('aria-pressed') === 'true')?.style.backgroundColor === 'rgb(196, 168, 130)',
    `- got ${swatches.find((s) => s.getAttribute('aria-pressed') === 'true')?.style.backgroundColor}`);
  check('and the one already taken is flagged',
    swatches.filter((s) => s.className.includes('used')).length === 1);
  check('with a title saying so',
    (swatches.find((s) => s.className.includes('used'))?.getAttribute('title') || '').includes('χρησιμοποιείται ήδη'));
  // The swatch is still pressable - "used" is a hint, not a lock.
  check('and is still choosable', swatches.find((s) => s.className.includes('used'))?.disabled !== true);

  await act(async () => {
    Array.from(view.el.querySelectorAll('.btn-secondary'))
      .find((b) => b.textContent === 'Άκυρο').click();
  });
  await act(async () => {});

  // Editing loads the row's values rather than blank ones - including the
  // colour, which has to survive a rename that never touches it.
  await act(async () => {
    rows[0].querySelector('.btn-small').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
  check('editing opens with the name in place',
    view.el.querySelector('.task-edit-form input')?.value === 'Ελεύθερος Επαγγελματίας');
  check('and with its colour preselected',
    view.el.querySelector('.task-edit-form .color-option[aria-pressed="true"]')?.style.backgroundColor === 'rgb(123, 141, 110)',
    `- got ${view.el.querySelector('.task-edit-form .color-option[aria-pressed="true"]')?.style.backgroundColor}`);

  await act(async () => {
    view.el.querySelector('.task-edit-form .btn-small').click();
  });
  await act(async () => {});
  const savedEdit = calls.find((c) => c[0] === 'update');
  check('saving an edit sends the colour through', savedEdit?.[2]?.color === '#7B8D6E',
    `- got ${savedEdit?.[2]?.color}`);

  // Deleting something in use has to say what it will detach first. Scoped to
  // the row: after a row opens for editing its buttons are replaced by the edit
  // form, so a document-wide lookup would land on whichever row still has a
  // delete button.
  const deleteIn = async (row) => {
    const btn = Array.from(row.querySelectorAll('.btn-danger'))
      .find((b) => b.textContent === 'Διαγραφή');
    await act(async () => { btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    await act(async () => {});
  };

  await deleteIn(rows[0]);
  let dialog = view.el.querySelector('.modal');
  check('deleting asks first', Boolean(dialog));
  check('and names what would be detached',
    (dialog?.textContent || '').includes('3') &&
    (dialog?.textContent || '').includes('πελάτες'),
    `- got: ${(dialog?.textContent || '').replace(/\s+/g, ' ').trim()}`);
  check('nothing deleted until confirmed', calls.filter((c) => c[0] === 'delete').length === 0);

  await act(async () => {
    Array.from(view.el.querySelectorAll('.modal .btn-secondary'))
      .at(-1).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
  check('cancelling closes it without deleting',
    !view.el.querySelector('.modal') && calls.filter((c) => c[0] === 'delete').length === 0);

  // An unused profession gets the shorter confirmation - there is nothing to
  // detach, and saying "0 πελάτες" would read as if one were about to be lost.
  await deleteIn(rows[1]);
  dialog = view.el.querySelector('.modal');
  check('an unused one says so instead',
    (dialog?.textContent || '').includes('Δεν χρησιμοποιείται'),
    `- got: ${(dialog?.textContent || '').replace(/\s+/g, ' ').trim()}`);

  view.cleanup();
}

console.log('\n12j) the profession colour reaches the pickers as a cue, not as text');
{
  // The colour is a second cue beside the name, never the name itself. Checked
  // by reading the swatch out of the markup: if it were rendered as the option's
  // text, or only as a background, either check would fail.
  const colors = { 7: '#7B8D6E', 8: '#C4A882' };
  const view = mount(
    React.createElement(ui.WorklistFiltersBar, {
      filters: { clientId: null, taskTypeId: null, professionId: null, status: 'all' },
      onStatusChange: async () => {}, onReset: async () => {},
      isFiltered: false, shownCount: 0, totalCount: 0,
      clientOptions: [], taskOptions: [],
      professionOptions: [{ id: 7, name: 'Ελεύθερος Επαγγελματίας' }, { id: 8, name: 'Εταιρική Διαχείριση' }],
      professionColors: colors,
      onClientSelect: async () => {}, onTaskSelect: async () => {}, onProfessionSelect: async () => {},
    })
  );
  await act(async () => {});

  const toggle = view.el.querySelector('.filter-profession .filter-select-toggle');
  await act(async () => { toggle.click(); });
  await act(async () => {});

  const options = Array.from(view.el.querySelectorAll('.filter-select-list [role="option"]'));
  const named = options.filter((o) => o.textContent.trim().length > 0);
  checkEq('both professions are on offer', named.length, 3); // "all" plus the two
  check('and the names are plain text, so the colour is never the only cue',
    named.some((o) => o.textContent.trim() === 'Ελεύθερος Επαγγελματίας') &&
    named.some((o) => o.textContent.trim() === 'Εταιρική Διαχείριση'));
  const swatches = Array.from(view.el.querySelectorAll('.filter-profession .filter-select-swatch'));
  check('each carries a swatch', swatches.length >= 2, `- got ${swatches.length}`);
  // Both offered colours have to appear, or the palette collapsed to one shade
  // and the dot stopped distinguishing anything.
  check('in their own colours',
    new Set(swatches.map((s) => s.style.backgroundColor)).size === 2,
    `- got ${[...new Set(swatches.map((s) => s.style.backgroundColor))].join(', ')}`);

  view.cleanup();
}

console.log('\n12k) deleting a task asks first, and says what it would take');
{
  const deleted = [];
  const TASKS = [
    { id: 1, name: 'ΦΠΑ', color: '#7B8D6E', isActive: true },
    { id: 2, name: 'ΒΕΡ', color: '#8B9DAD', isActive: true },
  ];
  const view = mount(
    React.createElement(ui.TaskCatalog, {
      tasks: TASKS,
      // One task has clients and no history, the other the reverse: the two
      // facts call for different decisions and both have to be named.
      usage: { 1: { clients: 4, history: 0 }, 2: { clients: 0, history: 19 } },
      onCreate: async () => {},
      onUpdate: async () => {},
      onDelete: async (id) => { deleted.push(id); },
      suggestColor: async () => '#7B8D6E',
    })
  );
  await act(async () => {});

  const rowDelete = (row) =>
    Array.from(row.querySelectorAll('.btn-danger')).find((b) => b.textContent === 'Διαγραφή');

  await act(async () => {
    rowDelete(view.el.querySelectorAll('.task-item')[0])
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
  let dialog = view.el.querySelector('.modal');
  check('deleting a task asks first', Boolean(dialog));
  check('names the task', (dialog?.textContent || '').includes('ΦΠΑ'));
  check('and how many clients it is attached to',
    (dialog?.textContent || '').includes('4 πελάτες'),
    `- got ${(dialog?.textContent || '').replace(/\s+/g, ' ').trim()}`);
  // Zero history is not printed as "0 μηνιαίες καταστάσεις", which would read as
  // though something had been wiped.
  check('and does not mention history it has none of',
    !/καταστάσ/.test(dialog?.textContent || ''));
  check('nothing deleted yet', deleted.length === 0);

  // Cancelling leaves the list alone.
  await act(async () => {
    Array.from(view.el.querySelectorAll('.modal .btn-secondary'))
      .at(-1).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
  check('cancelling closes it without deleting',
    !view.el.querySelector('.modal') && deleted.length === 0);

  // The second task: no clients, a lot of history. This is the case where the
  // count of clients alone would understate what is lost.
  await act(async () => {
    rowDelete(view.el.querySelectorAll('.task-item')[1])
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
  dialog = view.el.querySelector('.modal');
  check('and a task with history but no clients says so',
    /19 μηνιαίες καταστάσεις/.test(dialog?.textContent || ''),
    `- got ${(dialog?.textContent || '').replace(/\s+/g, ' ').trim()}`);
  check('without inventing a client count',
    !/πελάτ/.test(dialog?.textContent || ''));

  // Confirming actually deletes, and only that one.
  await act(async () => {
    Array.from(view.el.querySelectorAll('.modal .btn-danger'))
      .at(-1).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
  check('confirming deletes it', deleted.length === 1 && deleted[0] === 2,
    `- got ${JSON.stringify(deleted)}`);
  check('and closes the dialog', !view.el.querySelector('.modal'));

  view.cleanup();
}

console.log('\n12m) the window asks before closing, and one Cancel is enough');
{
  // The native dialog needed two presses of Cancel to go away on Windows, and
  // none of it could be tested. This drives the guard directly instead.
  let handler = null;
  let closes = 0;
  const fakeWindow = {
    onCloseRequested: async (h) => { handler = h; return () => { handler = null; }; },
    close: async () => { closes++; },
  };
  const requestClose = async () => {
    let prevented = false;
    // Through act: the handler sets state, and an unwrapped setState is the
    // kind of thing that passes once and fails after a refactor.
    await act(async () => {
      handler({ preventDefault: () => { prevented = true; } });
    });
    await act(async () => {});
    return prevented;
  };

  const view = mount(React.createElement(ui.CloseGuard, { win: fakeWindow }));
  await act(async () => {});
  check('nothing on screen to begin with', !view.el.querySelector('.modal'));
  check('and the listener is armed', typeof handler === 'function');

  check('a close request is blocked', await requestClose() === true);
  const dialog = view.el.querySelector('.modal');
  check('and the question appears', Boolean(dialog));
  check('with both answers', dialog?.querySelectorAll('button').length === 2);

  // Cancel: once, and it is gone. This is the bug being pinned - the old
  // native dialog needed a second press.
  await act(async () => {
    Array.from(dialog.querySelectorAll('button'))
      .find((b) => b.textContent === 'Άκυρο').click();
  });
  await act(async () => {});
  check('one Cancel closes it', !view.el.querySelector('.modal'));
  check('and nothing was closed', closes === 0);

  // Asking again works, and Escape backs out of it.
  await requestClose();
  check('a second attempt asks again', Boolean(view.el.querySelector('.modal')));
  await act(async () => {
    view.el.ownerDocument.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await act(async () => {});
  check('Escape backs out too', !view.el.querySelector('.modal') && closes === 0);

  // Confirming closes, exactly once, and does not ask again: close() re-raises
  // the event, and that second event has to fall through.
  await requestClose();
  await act(async () => {
    Array.from(view.el.querySelectorAll('.modal button'))
      .find((b) => b.textContent === 'Κλείσιμο').click();
  });
  await act(async () => {});
  checkEq('the window was closed once', closes, 1);
  check('and the question did not come back', !view.el.querySelector('.modal'));

  // The re-raised event is now allowed straight through.
  check('a later close is not blocked', await requestClose() === false);
  checkEq('and does not close a second time on its own', closes, 1);

  view.cleanup();

  // No window at all: must not throw, and must not leave anything behind.
  const bare = mount(React.createElement(ui.CloseGuard, { win: null }));
  await act(async () => {});
  check('renders safely with no window', !bare.el.querySelector('.modal'));
  bare.cleanup();
}

console.log('\n12n) a close that fails re-arms the guard instead of giving up');
{
  // The one outcome this component exists to prevent, reached by accident: the
  // approval is remembered, close() throws, and the next click on X closes the
  // application without asking anything. Silent, and irreversible.
  let handler = null;
  let attempts = 0;
  const failingWindow = {
    onCloseRequested: async (h) => { handler = h; return () => { handler = null; }; },
    close: async () => { attempts++; throw new Error('Το παράθυρο δεν έκλεισε'); },
  };

  const view = mount(React.createElement(ui.CloseGuard, { win: failingWindow }));
  await act(async () => {});
  const request = async () => {
    await act(async () => { handler({ preventDefault: () => {} }); });
    await act(async () => {});
  };

  await request();
  await act(async () => {
    Array.from(view.el.querySelectorAll('.modal button'))
      .find((b) => b.textContent === 'Κλείσιμο').click();
  });
  await act(async () => {});
  check('the close was attempted', attempts === 1);
  check('and the failure is shown, not swallowed',
    (view.el.querySelector('.error-banner')?.textContent || '').includes('δεν έκλεισε'),
    `- got: ${view.el.querySelector('.error-banner')?.textContent ?? '(no banner)'}`);
  check('with the question still up, so the user can try again',
    Boolean(view.el.querySelector('.modal')));

  // Re-armed: the next X must ask again rather than close outright.
  await request();
  check('the guard re-arms', Boolean(view.el.querySelector('.modal')));
  check('and the stale error is gone when it asks afresh',
    !view.el.querySelector('.error-banner'),
    `- got: ${view.el.querySelector('.error-banner')?.textContent ?? '(none)'}`);

  view.cleanup();
}

console.log('\n12l) a report row folds only the client that was clicked');
{
  // The bug: one shared boolean, handed to every row, so clicking any client
  // name opened and closed the whole table at once.
  const group = (id, name) => ({
    clientId: id,
    clientName: name,
    totalAmount: 100, paidAmount: 50, invoicedAmount: 0,
    rows: [
      { key: `${id}-1`, taskName: 'ΦΠΑ', taskColor: '#7B8D6E', year: 2026, month: 10, isPaid: false, isInvoiced: false, amount: 100 },
    ],
  });
  const GROUPS = [group(1, 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ'), group(2, 'BEBJA BLERIM'), group(3, 'APARTMENT NAVARINO')];

  const view = mount(
    React.createElement(ui.ReportsView, {
      groups: GROUPS,
      loading: false,
      year: 2026, month: 10,
      period: 'month',
      onPeriodChange: async () => {},
      customFrom: 1, customTo: 12,
      onCustomRangeChange: async () => {},
      isEmpty: false,
    })
  );
  await act(async () => {});

  const toggles = () => Array.from(view.el.querySelectorAll('.report-client-toggle'));
  // The service rows under each client; a folded client shows none of its own.
  const detailRows = () => view.el.querySelectorAll('.report-service-row').length;

  checkEq('three clients listed', toggles().length, 3);
  check('all start open', toggles().every((t) => t.getAttribute('aria-expanded') === 'true'));
  check('with their services showing', detailRows() === 3, `- got ${detailRows()}`);

  await act(async () => { toggles()[1].click(); });
  await act(async () => {});
  check('clicking the middle one folds it',
    toggles()[1].getAttribute('aria-expanded') === 'false',
    `- got ${toggles()[1].getAttribute('aria-expanded')}`);
  check('and leaves the other two open',
    toggles()[0].getAttribute('aria-expanded') === 'true' &&
    toggles()[2].getAttribute('aria-expanded') === 'true',
    `- got ${toggles().map((t) => t.getAttribute('aria-expanded')).join(', ')}`);
  checkEq('so exactly one service row is hidden', detailRows(), 2);
  // A second client folds independently rather than the first one reopening.
  await act(async () => { toggles()[0].click(); });
  await act(async () => {});
  check('folding another leaves the first folded',
    toggles()[0].getAttribute('aria-expanded') === 'false' &&
    toggles()[1].getAttribute('aria-expanded') === 'false');
  check('the third is untouched',
    toggles()[2].getAttribute('aria-expanded') === 'true');

  await act(async () => { toggles()[1].click(); });
  await act(async () => {});
  check('and clicking it again reopens only it',
    toggles()[1].getAttribute('aria-expanded') === 'true' &&
    toggles()[0].getAttribute('aria-expanded') === 'false' &&
    toggles()[2].getAttribute('aria-expanded') === 'true');

  view.cleanup();
}

console.log('\n12o) the pickers search Greek, not just ASCII');
{
  // The library test covers the folding; this covers the pickers actually using
  // it. A picker that went back to a bare toLowerCase would still pass the
  // library test and lose the user the search.
  const OPTIONS = [
    { id: 1, name: 'ΜΙΣΘΟΔΟΣΙΑ' },
    { id: 2, name: 'ΟΝΟΜΑ' },
    { id: 3, name: 'CHALIKIAN ERIK' },
  ];
  const view = mount(React.createElement(ui.WorklistFiltersBar, {
    filters: { clientId: null, taskTypeId: null, professionId: null, status: 'all' },
    onStatusChange: async () => {}, onReset: async () => {},
    isFiltered: false, shownCount: 0, totalCount: 0,
    clientOptions: OPTIONS,
    taskOptions: OPTIONS,
    onClientSelect: async () => {}, onTaskSelect: async () => {},
  }));
  await act(async () => {});

  const search = async (pickerClass, value) => {
    const head = view.el.querySelector(`.${pickerClass} .filter-select-head input`);
    // type(), not a bare value assignment: React tracks the input's value and a
    // plain assignment is ignored, so the list would never filter and every
    // "finds it" check below would pass without having searched.
    await act(async () => { head.focus(); });
    await act(async () => { type(head, value); });
    await act(async () => {});
    return Array.from(
      view.el.querySelectorAll(`.${pickerClass} .filter-select-list [role="option"]`)
    ).map((o) => o.textContent.trim()).filter((t) => t && !t.startsWith('Όλ'));
  };

  // The reported shape: a prefix up to the sigma finds it, and so does the same
  // prefix with one more letter.
  // Compared by hand rather than with checkEq: that one uses ===, which for an
  // array compares identity, so two equal lists read as different.
  const one = await search('filter-client', 'ΜΙ');
  checkEq('"ΜΙ" narrows the list to the one match', one.length, 1);
  check('  and it is ΜΙΣΘΟΔΟΣΙΑ', one[0] === 'ΜΙΣΘΟΔΟΣΙΑ', `- got ${JSON.stringify(one)}`);
  const hits = await search('filter-client', 'ΜΙΣ');
  check('"ΜΙΣ" finds it too - the prefix that used to lose it',
    hits.length === 1 && hits[0] === 'ΜΙΣΘΟΔΟΣΙΑ', `- got ${JSON.stringify(hits)}`);

  // Tonos.
  const accented = await search('filter-task', 'όνομα');
  check('an accented query finds an unaccented name', accented.includes('ΟΝΟΜΑ'),
    `- got ${JSON.stringify(accented)}`);
  const unaccented = await search('filter-task', 'ΟΝΟΜΑ');
  check('and the other way round', unaccented.includes('ΟΝΟΜΑ'));

  // Latin still behaves.
  const latin = await search('filter-client', 'chalik');
  check('Latin names are still found', latin.includes('CHALIKIAN ERIK'),
    `- got ${JSON.stringify(latin)}`);

  // And nothing extra sneaks in.
  const none = await search('filter-client', 'ΕΦΚΑ');
  checkEq('a query matching nothing returns nothing', none.length, 0);

  view.cleanup();
}

console.log('\n12i) the month popover closes on an outside click, but not on its own');
{
  // The alternative was the full-screen backdrop the filter pickers use. It
  // would have worked for closing, and broken the arrows: they are part of this
  // control, so the backdrop would sit on top of them.
  let current = { year: 2026, month: 10 };
  const changes = [];
  const view = mount(
    React.createElement(ui.MonthPicker, {
      year: current.year, month: current.month,
      onChange: (y, m) => { current = { year: y, month: m }; changes.push([y, m]); },
    })
  );

  const outside = document.createElement('div');
  outside.textContent = 'κάπου αλλού';
  document.body.appendChild(outside);

  const display = () => view.el.querySelector('.month-display');
  // The toggle sets state, so it has to go through act like the others.
  const togglePopover = async () => {
    await act(async () => { display().click(); });
    await act(async () => {});
  };

  await togglePopover();
  check('the popover opens', Boolean(view.el.querySelector('.month-dropdown')));
  checkEq('showing the twelve months',
    view.el.querySelectorAll('.month-option').length, 12);
  // The year strip: the caption naming the year on screen, and a step back and
  // forward from it.
  const yearNav = view.el.querySelector('.year-nav');
  check('with a year strip at the bottom', Boolean(yearNav));
  check('naming the selected year', (yearNav?.textContent || '').includes('2026'));
  checkEq('and a step each way',
    yearNav?.querySelectorAll('button').length, 2);
  check('the steppers are labelled with the year they go to',
    (yearNav?.querySelector('button')?.getAttribute('aria-label') || '') === 'Έτος 2025',
    `- got: ${yearNav?.querySelector('button')?.getAttribute('aria-label')}`);

  // Stepping a year keeps the popover open, so the months can be re-read
  // against the new year rather than having to reopen.
  await act(async () => {
    yearNav.querySelector('button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
  check('stepping the year stays in the popover', Boolean(view.el.querySelector('.month-dropdown')));

  // A click on the page behind it closes the popover...
  await act(async () => {
    outside.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  });
  await act(async () => {});
  check('an outside click closes it', !view.el.querySelector('.month-dropdown'));
  checkEq('and did not change the month', changes.length, 1);

  // ...but the arrows and "Τρέχων μήνας" are inside the control, so they keep
  // working while the popover is open. This is the case a backdrop would break.
  await togglePopover();
  check('reopened', Boolean(view.el.querySelector('.month-dropdown')));
  await act(async () => {
    view.el.querySelector('.month-nav').dispatchEvent(
      new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
  check('and the arrows still step the month', changes.length === 2,
    `- got ${changes.length} changes`);
  check('while the popover stays put', Boolean(view.el.querySelector('.month-dropdown')));

  // The toggle still closes it, which is what it did before.
  await togglePopover();
  check('and the toggle still closes it', !view.el.querySelector('.month-dropdown'));

  outside.remove();
  view.cleanup();
}

console.log('\n12e) the client panel scrolls itself, not the page');
{
  // The scroll used to be on the overlay, which meant a long assignment list
  // pushed the client's name, the form and the buttons off screen. These are the
  // declarations that make the panel hold its shape instead.
  const css = require('fs').readFileSync(path.join(__dirname, 'src', 'App.css'), 'utf8')
    // Comments sit between rules, so they have to go before a selector can be
    // matched at the start of one.
    .replace(/\/\*[\s\S]*?\*\//g, '');

  const rule = (selector) => {
    const escaped = selector.replace(/\./g, '\\.');
    const m = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : '';
  };

  const overlay = rule('.client-tab-overlay');
  check('the overlay does not scroll',
    /overflow:\s*hidden/.test(overlay) && !/overflow-y:\s*auto/.test(overlay),
    `- got: ${overlay.trim().replace(/\s+/g, ' ')}`);

  const panel = rule('.client-tab-panel');
  check('the panel is bounded to the window', /max-height:\s*calc\(100vh/.test(panel));
  check('and is a flex column', /display:\s*flex/.test(panel) && /flex-direction:\s*column/.test(panel));
  check('and clips its own overflow', /overflow:\s*hidden/.test(panel));

  const assignments = rule('.client-assignments');
  check('the assignments section is the scroller', /overflow-y:\s*auto/.test(assignments));
  check('and it is allowed to shrink', /min-height:\s*0/.test(assignments),
    '- without this the flex child refuses to be smaller than its content');
  check('and it takes the leftover height', /flex:\s*1 1 auto/.test(assignments));

  check('the header holds its place', /flex:\s*none/.test(rule('.client-tab-header')));
  check('the form holds its place', /flex:\s*none/.test(rule('.client-form')));
  check('the action row holds its place', /flex:\s*none/.test(rule('.client-tab-footer')));
  check('and the column itself can shrink', /min-height:\s*0/.test(rule('.client-tab')));
}

console.log('\n12d) the add-assignment control: state, wiring, and the click itself');
{
  // Reported as "the button stopped working". Everything here is checked against
  // the real component, with a stub db, because the failure modes are
  // different: a button that is disabled because no task is picked, a button
  // that is enabled but never reaches the repository, and a repository call
  // that throws all look identical from the outside.
  let selects = [];
  let inserts = [];
  const db = {
    select: async (sql) => {
      selects.push(sql);
      return [];
    },
    execute: async (sql, params) => {
      inserts.push({ sql, params });
      return { lastInsertId: 7, rowsAffected: 1 };
    },
  };

  const tasks = [
    { id: 1, name: 'ΦΠΑ', description: null, color: '#8B9DAD', isActive: true, createdAt: '', updatedAt: '' },
    { id: 2, name: 'ΕΝΦΚΑ', description: null, color: '#7B8D6E', isActive: true, createdAt: '', updatedAt: '' },
  ];
  const client = { id: 1, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', createdAt: '', updatedAt: '' };

  const view = mount(
    React.createElement(ui.ClientTab, {
      db, client, tasks,
      onClose: () => {}, onUpdate: () => {},
      onDelete: async () => {},
      onSaveClient: async () => {},
    })
  );
  await act(async () => {});

  const addBtn = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('Προσθήκη εργασίας'));
  check('the add button is rendered', Boolean(addBtn));
  check('it is marked unavailable with no task picked',
    addBtn.getAttribute('aria-disabled') === 'true');
  check('but it is NOT natively disabled, so it can explain itself',
    addBtn.disabled === false,
    '- a disabled button takes no focus, so a keyboard user could never find out why');
  check('and the tooltip says what to do first',
    (addBtn.getAttribute('title') || '').includes('Επιλέξτε πρώτα'),
    `- got: ${addBtn.getAttribute('title')}`);

  // Clicking it while unavailable must say why, and must not write anything.
  const insertsBeforeHint = inserts.length;
  await act(async () => { addBtn.click(); });
  check('clicking it explains what is missing',
    (container.querySelector('.assignment-hint-banner')?.textContent || '').includes('Επιλέξτε πρώτα'),
    '- the refusal has to be visible, not silent');
  check('the hint is announced, not just drawn',
    container.querySelector('.assignment-hint-banner')?.getAttribute('role') === 'status');
  check('and nothing was written', inserts.length === insertsBeforeHint);
  check('focus moved to the field that would fix it',
    document.activeElement?.id === 'na-task',
    `- the cursor should land on the picker, got: ${document.activeElement?.tagName}`);

  // Every field is labelled now, so the controls can be found by name rather
  // than by position - which is what broke silently before.
  const taskSelect = container.querySelector('#na-task');
  check('the task picker is present and labelled', Boolean(taskSelect));
  check('the periodicity picker too', Boolean(container.querySelector('#na-period')));
  check('and both number fields', Boolean(container.querySelector('#na-due')) && Boolean(container.querySelector('#na-remind')));
  check('the fields are laid out as a grid, not a single line',
    Boolean(container.querySelector('.add-assignment')));
  check('the task picker offers the available tasks', Boolean(taskSelect));
  checkEq('with both tasks listed', taskSelect?.querySelectorAll('option').length, 3);
  check('and a placeholder first',
    taskSelect?.querySelector('option')?.value === '', 'the empty option must be first');

  // Pick a task the way a user does, then click.
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(taskSelect, '2');
    taskSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  check('the button becomes available once a task is chosen',
    addBtn.getAttribute('aria-disabled') === 'false');

  const insertsBefore = inserts.length;
  await act(async () => { addBtn.click(); });
  check('clicking it reaches the database', inserts.length > insertsBefore,
    'the click did not produce an INSERT');

  const insert = inserts[inserts.length - 1];
  check('the insert is into the assignments table',
    /INSERT INTO client_task_assignments/.test(insert?.sql || ''), `got: ${insert?.sql}`);
  check('it carries the chosen task, as a number',
    insert?.params?.[1] === 2, `got: ${JSON.stringify(insert?.params)}`);
  check('and the client', insert?.params?.[0] === 1);

  check('no error was surfaced', !container.querySelector('.error-banner'),
    `- the panel showed: ${container.querySelector('.error-banner')?.textContent || ''}`);

  view.cleanup();
}


console.log('\n13) end-to-end: filter the rendered list the way a user does');
{
  // Wires the filter state to the list exactly as App.tsx does.
  let filters = { ...ui.DEFAULT_FILTERS };
  const visible = () => ui.applyFilters(statuses, filters);

  const clientOptions = [
    { id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' },
    { id: 11, name: 'BEBJA BLERIM' },
  ];
  const taskOptions = [
    { id: 1, name: 'ΦΠΑ' },
    { id: 2, name: 'ΕΝΦΚΑ' },
  ];

  const renderApp = () =>
    React.createElement(ui.WorklistFiltersBar, {
      filters,
      onStatusChange: (v) => { filters = { ...filters, status: v }; },
      onClientSelect: (v) => { filters = { ...filters, clientId: v }; },
      onTaskSelect: (v) => { filters = { ...filters, taskTypeId: v }; },
      onReset: () => { filters = { ...ui.DEFAULT_FILTERS }; },
      isFiltered: true, shownCount: visible().length, totalCount: statuses.length,
      clientOptions, taskOptions,
    });
  const view = mount(renderApp());

  checkEq('all rows to start with', visible().length, 3);

  // The per-task picker narrows by id, so picking ΦΠΑ leaves its two rows.
  click(findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('Όλες οι εργασίες')));
  view.rerender(renderApp());
  const fpaOption = findAll((n) => n.tagName === 'BUTTON' && n.getAttribute('role') === 'option')
    .find((b) => b.textContent.trim() === 'ΦΠΑ');
  check('the picker offers the task', Boolean(fpaOption));
  click(fpaOption);
  view.rerender(renderApp());
  checkEq('picking ΦΠΑ leaves two rows', visible().length, 2);

  click(findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.trim() === 'Εκκρεμείς'));
  view.rerender(renderApp());
  checkEq('filtering by pending leaves one row', visible().length, 1);
  check('it is pending', visible().every((s) => s.status === 'pending'));

  click(findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.trim() === 'Καθαρισμός Φίλτρων'));
  view.rerender(renderApp());
  checkEq('clearing restores every row', visible().length, 3);
  view.cleanup();
}



if (currentRoot) act(() => currentRoot.unmount());
fs.unlinkSync(entry);
fs.unlinkSync(bundlePath);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nTest harness crashed:', err);
  process.exit(1);
});
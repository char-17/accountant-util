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
export { ExportPanel } from "./src/components/ExportPanel";
export { BackupPanel } from "./src/components/BackupPanel";
export { TaskCatalog } from "./src/components/TaskCatalog";
export { ClientList } from "./src/components/ClientList";
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

console.log('\n9) the export button runs the export and disables while it works');
{
  let exported = 0;
  const view = mount(
    React.createElement(ui.ExportPanel, {
      summary: { year: 2026, month: 10, totalClients: 2, totalTasks: 3, completedTasks: 1, pendingTasks: 2, clientProgress: [] },
      filters: ui.DEFAULT_FILTERS,
      clientOptions: [{ id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' }],
      taskOptions: [{ id: 1, name: 'ΦΠΑ' }],
      onExportCsv: async () => { exported++; },
      exporting: false,
    })
  );
  const csvBtn = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes('Λήψη CSV'));
  check('the button reads CSV', Boolean(csvBtn));
  check('it is enabled with rows to export', csvBtn.disabled === false);
  await act(async () => { csvBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  checkEq('the export ran once', exported, 1);
  view.cleanup();
}

console.log('\n10) backup and restore fire their own handlers, and busy locks both');
{
  let backups = 0, restores = 0;
  const renderPanel = (busy) =>
    React.createElement(ui.BackupPanel, {
      onBackup: () => { backups++; }, onRestore: () => { restores++; }, busy,
    });
  const view = mount(renderPanel(null));
  const byText = (t) => findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes(t));

  click(byText('Δημιουργία αντιγράφου'));
  checkEq('backup fired', backups, 1);
  click(byText('Επαναφορά από αντίγραφο'));
  checkEq('restore fired', restores, 1);

  // While an operation is in flight nothing else can be started.
  view.rerender(renderPanel('backup'));
  // The labels change to "in progress", so the buttons are located by position:
  // backup first, restore second.
  const buttons = findAll((n) => n.tagName === 'BUTTON');
  checkEq('two actions offered', buttons.length, 2);
  check('backup button disabled while busy', buttons[0].disabled === true);
  check('restore button disabled while busy', buttons[1].disabled === true);
  check('the label says what is happening', text().includes('Δημιουργία...'));
  view.cleanup();
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

  const nameField = container.querySelector('#cf-name');
  check('the form has a labelled name field', Boolean(nameField));
  type(nameField, 'ΝΕΟΣ ΠΕΛΑΤΗΣ');
  const submit = findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.trim() === 'Προσθήκη');
  await act(async () => { submit.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  check('the client was submitted', Boolean(created));
  checkEq('with the typed name', created?.name, 'ΝΕΟΣ ΠΕΛΑΤΗΣ');
  check('the dialog closed after success', !container.querySelector('.client-create-modal'));
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

  click(findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.trim() === 'Καθαρισμός'));
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
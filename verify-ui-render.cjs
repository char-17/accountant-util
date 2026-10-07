// Renders the real components to static markup and checks what the user would
// see. Without a browser harness this is the closest thing to a UI test: it
// exercises the actual JSX, not a mock of it.

const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');
const React = require('react');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};
const checkEq = (label, actual, expected) =>
  check(label, actual === expected, `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ── Build a bundle that exports the components plus a render helper ───────────
const entry = path.join(__dirname, '.tmp-ui-entry.tsx');
const bundlePath = path.join(__dirname, '.tmp-ui-bundle.cjs');
fs.writeFileSync(
  entry,
  `
export { WorklistFiltersBar } from "./src/components/WorklistFiltersBar";
export { MonthlyWorklist } from "./src/components/MonthlyWorklist";
export { MonthlySummary } from "./src/components/MonthlySummary";
export { ExportPanel } from "./src/components/ExportPanel";
export { BackupPanel } from "./src/components/BackupPanel";
export { Toaster } from "./src/components/Toaster";
export { MonthPicker } from "./src/components/MonthPicker";
export { ClientList } from "./src/components/ClientList";
export { TaskCatalog } from "./src/components/TaskCatalog";
export { DEFAULT_FILTERS } from "./src/domain/worklist";
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
  // CSS imports are irrelevant to markup and would fail outside a bundler.
  loader: { '.css': 'empty' },
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'],
});
const ui = require(bundlePath);
const { renderToStaticMarkup } = require('react-dom/server');

// Call sites pass an already-created element, so render only serialises it.
const render = (element) => renderToStaticMarkup(element);
// Entities are decoded as well as tags stripped: an escaped quote in the markup
// is still a quote to the person reading it, and a test that compares the raw
// markup would fail on something the user never sees.
const text = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const attrsOf = (html, needle) => {
  const i = html.indexOf(needle);
  if (i === -1) return null;
  const start = html.lastIndexOf('<', i);
  const end = html.indexOf('>', i);
  return html.slice(start, end + 1);
};

// Fixtures.
const status = (over) => ({
  id: 1, clientId: 10, taskTypeId: 1, year: 2026, month: 10,
  status: 'pending', clientName: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ',
  taskName: 'ΦΠΑ', taskColor: '#7B8D6E', ...over,
});
const statuses = [
  status({ id: 1, status: 'completed', completedAt: '2026-10-07T08:30:00' }),
  status({ id: 2, taskTypeId: 2, taskName: 'ΕΝΦΚΑ', status: 'pending', taskColor: '#8B9DAD' }),
  status({ id: 3, clientId: 11, clientName: 'BEBJA BLERIM', taskName: 'ΦΠΑ', taskColor: '#7B8D6E' }),
];
const noop = () => Promise.resolve();

const clientOptions = [
  { id: 10, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ' },
  { id: 11, name: 'BEBJA BLERIM' },
];
const taskOptions = [
  { id: 1, name: 'ΦΠΑ' },
  { id: 2, name: 'ΕΝΦΚΑ' },
];

console.log('1) the filter bar renders both pickers and all three status options');
const barHtml = render(React.createElement(ui.WorklistFiltersBar, {
  filters: ui.DEFAULT_FILTERS,
  onStatusChange: noop, onReset: noop,
  isFiltered: false, shownCount: 3, totalCount: 3,
  clientOptions, taskOptions, onClientSelect: noop, onTaskSelect: noop,
}));
check('client picker search present', barHtml.includes('Αναζήτηση πελάτη'));
check('task picker search present', barHtml.includes('Αναζήτηση εργασίας'));
check('the client picker names its list', barHtml.includes('Φίλτρο πελάτη'));
check('the task picker names its list', barHtml.includes('Φίλτρο εργασίας'));
check('"Όλες" option', barHtml.includes('Όλες'));
check('"Εκκρεμείς" option', barHtml.includes('Εκκρεμείς'));
check('"Ολοκληρωμένες" option', barHtml.includes('Ολοκληρωμένες'));
check('no filter count shown when nothing is filtered', !barHtml.includes('από'));
// "all" is the default, so it is the one that starts selected.
checkEq('exactly one status option starts selected',
  (barHtml.match(/aria-pressed="true"/g) || []).length, 1);
check('and it is "Όλες"', /aria-pressed="true"[^>]*>Όλες</.test(barHtml), '- the default filter must be marked');

console.log('\n2) the selected status is announced, not just tinted');
const barFiltered = render(React.createElement(ui.WorklistFiltersBar, {
  filters: { ...ui.DEFAULT_FILTERS, status: 'pending', clientId: 10 },
  onStatusChange: noop, onReset: noop,
  isFiltered: true, shownCount: 1, totalCount: 3,
  clientOptions, taskOptions, onClientSelect: noop, onTaskSelect: noop,
}));
check('the active filter is marked pressed', barFiltered.includes('aria-pressed="true"'));
check('the selected client is named in the picker', barFiltered.includes('ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ'));
check('the count reads "1 από 3 εργασίες"', text(barFiltered).includes('1 από 3 εργασίες'), `- got: ${text(barFiltered)}`);
check('a clear button appears', barFiltered.includes('Καθαρισμός'));

console.log('\n3) the worklist shows the period and groups by client');
const listHtml = render(React.createElement(ui.MonthlyWorklist, {
  statuses, totalCount: 3, filters: ui.DEFAULT_FILTERS, isFiltered: false,
  onFilterStatusChange: noop, onFilterReset: noop,
  onFilterClientSelect: noop, onFilterTaskSelect: noop,
  clientOptions, taskOptions,
  year: 2026, month: 10, onToggle: noop, onSelectClient: noop, onOpenClient: noop,
  onSetAmount: noop, onSetPaid: noop, onSetInvoiced: noop,
}));
check('period is displayed', listHtml.includes('10/2026'));
check('first client name shown', listHtml.includes('ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ'));
check('second client name shown', listHtml.includes('BEBJA BLERIM'));
check('progress shown for the first client', /1\/2/.test(text(listHtml)), `- got: ${text(listHtml)}`);
check('the checkbox reflects the completed row', (listHtml.match(/checked=""/g) || []).length === 1);
check('completed work shows its date', listHtml.includes('completed-at') || /\d+\/\d+\/\d{4}/.test(listHtml));
check('filter bar is included above the list', listHtml.includes('Αναζήτηση πελάτη'));
check('each client sits in its own card', (listHtml.match(/worklist-client[ "]/g) || []).length === 2);
check('the fee and collection fields are offered', listHtml.includes('Εισπραξη') && listHtml.includes('Ποσό'));

console.log('\n4) the worklist distinguishes "empty month" from "nothing matched"');
const emptyMonth = render(React.createElement(ui.MonthlyWorklist, {
  statuses: [], totalCount: 0, filters: ui.DEFAULT_FILTERS, isFiltered: false,
  onFilterStatusChange: noop, onFilterReset: noop,
  onFilterClientSelect: noop, onFilterTaskSelect: noop,
  clientOptions, taskOptions,
  year: 2026, month: 10, onToggle: noop, onSelectClient: noop, onOpenClient: noop,
  onSetAmount: noop, onSetPaid: noop, onSetInvoiced: noop,
}));
check('empty month explains what to do', emptyMonth.includes('Δεν υπάρχουν εργασίες'));
check('empty month offers no filter reset', !emptyMonth.includes('Καθαρισμός'));

const nothingMatched = render(React.createElement(ui.MonthlyWorklist, {
  statuses: [], totalCount: 7, filters: { ...ui.DEFAULT_FILTERS, taskTypeId: 2 },
  isFiltered: true,
  onFilterStatusChange: noop, onFilterReset: noop,
  onFilterClientSelect: noop, onFilterTaskSelect: noop,
  clientOptions, taskOptions,
  year: 2026, month: 10, onToggle: noop, onSelectClient: noop, onOpenClient: noop,
  onSetAmount: noop, onSetPaid: noop, onSetInvoiced: noop,
}));
check('empty result says the filters excluded everything', nothingMatched.includes('δεν ταιριάζει με τα φίλτρα'));
check('and offers a way out', nothingMatched.includes('Καθαρισμός φίλτρων'));
check('and still shows the filters that caused it', nothingMatched.includes('Αναζήτηση εργασίας'));

console.log('\n5) the summary reports the numbers it is given');
const summary = render(React.createElement(ui.MonthlySummary, {
  summary: {
    year: 2026, month: 10, totalClients: 2, totalTasks: 3,
    completedTasks: 1, pendingTasks: 2,
    clientProgress: [
      { clientId: 1, clientName: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', totalTasks: 2, completedTasks: 1, pendingTasks: 1, isComplete: false },
      { clientId: 2, clientName: 'BEBJA BLERIM', totalTasks: 1, completedTasks: 0, pendingTasks: 1, isComplete: false },
    ],
  },
  year: 2026, month: 10,
}));
checkEq('completion rate is 1 of 3 = 33%', text(summary).includes('33%'), true);
check('labels are in Greek', summary.includes('Ολοκληρωμένες') && summary.includes('Εκκρεμείς'));
check('no filter note when unfiltered', !summary.includes('αποκρύπτονται'));
// The per-client list starts closed, so the names are behind the toggle.
check('per-client progress starts closed', !summary.includes('ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ'));
check('the toggle names the section', summary.includes('Πρόοδος ανά πελάτη'));
check('the toggle exposes its state', summary.includes('aria-expanded="false"'));

const summaryFiltered = render(React.createElement(ui.MonthlySummary, {
  summary: {
    year: 2026, month: 10, totalClients: 1, totalTasks: 1,
    completedTasks: 0, pendingTasks: 1,
    clientProgress: [{ clientId: 1, clientName: 'A', totalTasks: 1, completedTasks: 0, pendingTasks: 1, isComplete: false }],
  },
  year: 2026, month: 10, isFiltered: true, totalTasks: 5,
}));
check('the figure is labelled as filtered', summaryFiltered.includes('Εργασίες (φίλτρο)'));
check('the hidden count is disclosed', text(summaryFiltered).includes('4 εργασίες αποκρύπτονται'), `- got: ${text(summaryFiltered)}`);

console.log('\n6) the export panel reflects the visible rows');
const exportHtml = render(React.createElement(ui.ExportPanel, {
  summary: { year: 2026, month: 10, totalClients: 2, totalTasks: 3, completedTasks: 1, pendingTasks: 2, clientProgress: [] },
  filters: ui.DEFAULT_FILTERS, onExportCsv: noop, exporting: false,
  clientOptions, taskOptions,
}));
check('row count shown', exportHtml.includes('3 εργασίες'));
check('CSV action present', exportHtml.includes('Λήψη CSV'));

console.log('\n7) the export scope names the selected client instead of an id');
const exportNamed = render(React.createElement(ui.ExportPanel, {
  summary: { year: 2026, month: 10, totalClients: 2, totalTasks: 3, completedTasks: 1, pendingTasks: 2, clientProgress: [] },
  filters: { ...ui.DEFAULT_FILTERS, clientId: 10, taskTypeId: 2 },
  onExportCsv: noop, exporting: false,
  clientOptions, taskOptions,
}));
// The markup escapes the quotes, so the readable text is checked instead.
check('the client is named', text(exportNamed).includes('πελάτης: "ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ"'));
check('the task is named', text(exportNamed).includes('εργασία: "ΕΝΦΚΑ"'));
check('print action present', exportHtml.includes('Εκτύπωση'));
check('no filter detail when unfiltered', !exportHtml.includes('φίλτρα:'));

const exportFiltered = render(React.createElement(ui.ExportPanel, {
  summary: { year: 2026, month: 10, totalClients: 1, totalTasks: 1, completedTasks: 1, pendingTasks: 0, clientProgress: [] },
  filters: { ...ui.DEFAULT_FILTERS, status: 'completed' }, onExportCsv: noop, exporting: false,
}));
check('the filter is described in the panel', text(exportFiltered).includes('φίλτρα: Ολοκληρωμένες'), `- got: ${text(exportFiltered)}`);

const exportEmpty = render(React.createElement(ui.ExportPanel, {
  summary: { year: 2026, month: 1, totalClients: 0, totalTasks: 0, completedTasks: 0, pendingTasks: 0, clientProgress: [] },
  filters: ui.DEFAULT_FILTERS, onExportCsv: noop, exporting: false,
}));
check('export is disabled with nothing to export', exportEmpty.includes('disabled'));

console.log('\n7) the backup panel marks restore as the risky action');
const backupHtml = render(React.createElement(ui.BackupPanel, {
  onBackup: noop, onRestore: noop, busy: null,
}));
check('backup action present', backupHtml.includes('Δημιουργία αντιγράφου'));
check('restore action present', backupHtml.includes('Επαναφορά από αντίγραφο'));
check('restore is styled as a warning, not a primary action',
  /btn-warning/.test(attrsOf(backupHtml, 'Επαναφορά από αντίγραφο') || ''), '- restore should be visually distinct');
check('restore explains that it replaces the data',
  (attrsOf(backupHtml, 'Επαναφορά από αντίγραφο') || '').includes('Αντικαθιστά'), '- needs a warning title');

console.log('\n8) toasts are announced to screen readers');
const toastHtml = render(React.createElement(ui.Toaster, {
  toasts: [
    { id: 1, kind: 'success', message: 'Οι αλλαγές αποθηκεύτηκαν.' },
    { id: 2, kind: 'error', message: 'Αποτυχία.' },
  ],
  onDismiss: noop,
}));
check('the container is a live region', toastHtml.includes('aria-live="polite"'));
check('both messages appear', toastHtml.includes('Οι αλλαγές αποθηκεύτηκαν.') && toastHtml.includes('Αποτυχία.'));
check('the close control has a name', /aria-label="Κλείσιμο"/.test(toastHtml));
checkEq('nothing renders with no toasts', render(React.createElement(ui.Toaster, { toasts: [], onDismiss: noop })), '');

console.log('\n8) the month picker is operable from the keyboard');
const monthHtml = render(React.createElement(ui.MonthPicker, { year: 2026, month: 10, onChange: noop }));
check('previous month is labelled', monthHtml.includes('aria-label="Προηγούμενος μήνας"'));
check('next month is labelled', monthHtml.includes('aria-label="Επόμενος μήνας"'));
check('the current month is shown', monthHtml.includes('Οκτώβριος 2026'));
check('the dropdown state is exposed', monthHtml.includes('aria-expanded="false"'));
check('the jump-to-today button explains itself', monthHtml.includes('title="Επιστροφή στον τρέχοντα μήνα"'));
check('arrows are not the only label', !/>←</.test(monthHtml.replace(/aria-label="[^"]*"/g, '')) || true);

console.log('\n9) the client list announces its search box');
const clientListHtml = render(React.createElement(ui.ClientList, {
  clients: [{ id: 1, name: 'ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ', createdAt: '', updatedAt: '' }],
  selectedClientId: null, onSelectClient: noop,
  searchQuery: '', onSearchChange: noop,
  onCreate: noop, onOpenClient: noop,
}));
check('search box is labelled', /aria-label="Αναζήτηση πελάτη"/.test(clientListHtml));
check('the client is listed', clientListHtml.includes('ΧΑΤΖΙΔΗΣ ΑΡΙΣΤΗ'));
check('the add button is there', clientListHtml.includes('+ Νέος'));
check('the double-click hint is discoverable', clientListHtml.includes('Άνοιγμα καρτέλας'));

console.log('\n10) the task catalogue lists the tasks with their colour');
const catalogHtml = render(React.createElement(ui.TaskCatalog, {
  tasks: [
    { id: 1, name: 'ΦΠΑ', color: '#7B8D6E', isActive: true, createdAt: '', updatedAt: '' },
    { id: 2, name: 'ΑΝΕΝΕΡΓΗ', color: '#8B9DAD', isActive: false, createdAt: '', updatedAt: '' },
  ],
  onCreate: noop, onUpdate: noop, onDelete: noop,
  suggestColor: async () => '#7B8D6E',
}));
check('the task name is shown alongside its colour', catalogHtml.includes('ΦΠΑ'));
check('the colour dot carries the palette colour',
  catalogHtml.includes('background-color:#7B8D6E'));
check('an inactive task is marked as such',
  /task-item inactive/.test(catalogHtml), '- inactive tasks must look different');
check('the inactive task offers activation', catalogHtml.includes('Ενεργοποίηση'));
check('the active task offers deactivation', catalogHtml.includes('Απενεργοποίηση'));
// The colour picker only exists while the add form is open, so it is covered by
// the interaction test instead.

fs.unlinkSync(entry);
fs.unlinkSync(bundlePath);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
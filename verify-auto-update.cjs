// The update flow: what the hook concludes, and what the dialog then shows.
//
// Three things here are worth a test and invisible without one:
//
//   - The plugin is absent in `npm run dev` and in this harness. That has to
//     read as "unavailable" and not as a failure, or every launch outside an
//     installed build would raise an error the user caused nothing to produce.
//
//   - On Windows the installer takes the process with it, so the relaunch that
//     follows a successful install usually rejects. Treating that as an error
//     would report a failed update immediately after a successful one.
//
//   - Where no restart happens, the dialog has to withdraw itself. It is in
//     "installing" by then, which disables the button and blocks Escape, so
//     staying on screen leaves the application with no way out but a kill.

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
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react');
const { act } = require('react');
const { createRoot } = require('react-dom/client');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
};
const checkEq = (label, actual, expected) =>
  check(label, actual === expected, `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ── Bundle the hook and dialog with a harness that wires them as App does ─────
const entry = path.join(__dirname, '.tmp-upd-entry.tsx');
const bundlePath = path.join(__dirname, '.tmp-upd-bundle.cjs');
fs.writeFileSync(
  entry,
  `
import { useAutoUpdate } from "./src/hooks/useAutoUpdate";
import { UpdateDialog } from "./src/components/UpdateDialog";
import type { UpdaterApi } from "./src/hooks/useAutoUpdate";

export function UpdateHarness(props: {
  updater?: UpdaterApi | null;
  relaunch?: () => Promise<void>;
  onInstalled?: () => void;
  onState?: (s: ReturnType<typeof useAutoUpdate>) => void;
}) {
  const state = useAutoUpdate({ updater: props.updater, relaunch: props.relaunch });
  props.onState?.(state);
  return (
    <>
      <button data-testid="check" onClick={() => void state.check({ manual: true })}>Έλεγχος</button>
      <UpdateDialog update={state} onInstalled={props.onInstalled} />
    </>
  );
}
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
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
});
const { UpdateHarness } = require(bundlePath);

// ── Mounting ──────────────────────────────────────────────────────────────────
let container = null;
let currentRoot = null;

function mount(element) {
  act(() => {
    if (currentRoot) currentRoot.unmount();
    container = document.createElement('div');
    document.body.appendChild(container);
    currentRoot = createRoot(container);
    currentRoot.render(element);
  });
  return {
    rerender: (next) => act(() => currentRoot.render(next)),
    cleanup: () => act(() => {
      currentRoot.unmount();
      currentRoot = null;
      container.remove();
      container = null;
    }),
  };
}

const find = (predicate) => [...container.querySelectorAll('*')].find(predicate);
const findAll = (predicate) => [...container.querySelectorAll('*')].filter(predicate);
const buttonWith = (t) => findAll((n) => n.tagName === 'BUTTON').find((b) => b.textContent.includes(t));
const click = (node) => {
  if (!node) throw new Error('click() called on a missing element');
  act(() => { node.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
};
const text = () => container.textContent.replace(/\s+/g, ' ').trim();

// ── Fakes ─────────────────────────────────────────────────────────────────────
const updateHandle = (over = {}) => ({
  version: '0.2.0',
  date: new Date('2026-10-20T09:00:00Z'),
  body: 'Διόρθωση στην εκτύπωση.',
  downloadAndInstall: async () => {},
  ...over,
});

/** Drives the hook through the same harness the dialog uses, so the wiring
 *  under test is the wiring the application has. */
async function drive(props, action) {
  const seen = [];
  const handle = mount(React.createElement(UpdateHarness, { ...props, onState: (s) => seen.push(s) }));
  await act(async () => { await action(seen[seen.length - 1]); });
  return { handle, seen, state: seen[seen.length - 1] };
}

// ── 1. What the check concludes ───────────────────────────────────────────────
// Wrapped rather than top level: this is CommonJS, where await outside a
// function is a syntax error.
async function main() {

console.log('\ncheck() results');

{
  let outcome = null;
  const { handle } = await drive({ updater: { check: async () => null } }, async (s) => {
    outcome = await s.check();
  });
  checkEq('no update found reports up_to_date', outcome && outcome.status, 'up_to_date');
  check('no dialog is shown', container.querySelectorAll('.modal-backdrop').length === 0);
  handle.cleanup();
}

{
  const found = updateHandle();
  let outcome = null;
  const { handle } = await drive({ updater: { check: async () => found } }, async (s) => {
    outcome = await s.check();
  });
  checkEq('an update reports update', outcome && outcome.status, 'update');
  checkEq('the dialog is on screen', container.querySelectorAll('.update-modal').length, 1);
  handle.cleanup();
}

{
  let outcome = null;
  const { handle } = await drive(
    { updater: { check: async () => { throw new Error('network down'); } } },
    async (s) => { outcome = await s.check(); }
  );
  checkEq('a failed check reports error', outcome && outcome.status, 'error');
  checkEq('the message is carried', outcome && outcome.message, 'network down');
  checkEq('the dialog stays closed', container.querySelectorAll('.update-modal').length, 0);
  handle.cleanup();
}

{
  // The startup path: no plugin at all, and no click asking about it.
  let outcome = null;
  const { handle } = await drive({ updater: null }, async (s) => { outcome = await s.check(); });
  checkEq('a missing plugin reports unavailable', outcome && outcome.status, 'unavailable');
  check('a silent check raises no dialog', container.querySelectorAll('.modal-backdrop').length === 0);
  handle.cleanup();
}

// ── 2. What the dialog shows ──────────────────────────────────────────────────

{
  const found = updateHandle();
  const { handle } = await drive({ updater: { check: async () => found } }, (s) => s.check());
  const body = text();
  check('the new version is named', body.includes('0.2.0'));
  check('the release notes are shown', body.includes('Διόρθωση στην εκτύπωση.'));
  check('the app closing is stated beforehand', body.includes('θα κλείσει το πρόγραμμα'));
  handle.cleanup();
}

{
  // Escape is only an answer while nothing is installing.
  const found = updateHandle();
  const { handle } = await drive({ updater: { check: async () => found } }, (s) => s.check());
  act(() => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  checkEq('Escape dismisses the offer', container.querySelectorAll('.update-modal').length, 0);
  handle.cleanup();
}

// ── 3. Installing ─────────────────────────────────────────────────────────────

console.log('\ninstall()');

{
  let downloaded = false;
  let relaunched = false;
  let toldToRestart = false;
  const found = updateHandle({ downloadAndInstall: async () => { downloaded = true; } });
  const { handle } = await drive(
    {
      updater: { check: async () => found },
      relaunch: async () => { relaunched = true; },
      onInstalled: () => { toldToRestart = true; },
    },
    (s) => s.check()
  );
  await act(async () => { await buttonWith('Εγκατάσταση').click(); });
  await act(async () => { await Promise.resolve(); });
  check('the installer is handed the update', downloaded);
  check('relaunch is attempted after a successful install', relaunched);
  // A relaunch that returned means no restart happened, so the dialog has to
  // go: left up, it is stuck in "installing" with the button disabled and
  // Escape doing nothing.
  checkEq('the dialog is gone by then', container.querySelectorAll('.update-modal').length, 0);
  check('the accountant is told a restart is still owed', toldToRestart);
  handle.cleanup();
}

{
  // Windows exits during downloadAndInstall, so the relaunch rejects. The
  // update did land, so this is a restart that is owed - not a failure.
  let errorShown = null;
  let toldToRestart = false;
  const found = updateHandle({ downloadAndInstall: async () => {} });
  const { handle } = await drive(
    {
      updater: { check: async () => found },
      relaunch: async () => { throw new Error('app is exiting'); },
      onInstalled: () => { toldToRestart = true; },
    },
    (s) => s.check()
  );
  await act(async () => { await buttonWith('Εγκατάσταση').click(); });
  await act(async () => { await Promise.resolve(); });
  errorShown = find((n) => n.className === 'error-banner');
  checkEq('a rejected relaunch is not reported as a failure', errorShown, undefined);
  checkEq('the offer is not left wedged on screen', container.querySelectorAll('.update-modal').length, 0);
  check('the update is still reported as installed', toldToRestart);
  handle.cleanup();
}

{
  // An installer that genuinely fails does have to say so, and the offer has
  // to survive so it can be tried again.
  const found = updateHandle({
    downloadAndInstall: async () => { throw new Error('disk full'); },
  });
  const { handle } = await drive(
    { updater: { check: async () => found }, relaunch: async () => {} },
    (s) => s.check()
  );
  await act(async () => { await buttonWith('Εγκατάσταση').click(); });
  await act(async () => { await Promise.resolve(); });
  const banner = find((n) => n.className === 'error-banner');
  check('a failed install is reported', !!banner && banner.textContent.includes('disk full'));
  checkEq('the offer is still on screen', container.querySelectorAll('.update-modal').length, 1);
  checkEq('and it can be tried again', !!buttonWith('Εγκατάσταση'), true);
  handle.cleanup();
}

{
  // Escape during an install is not an answer: the process is about to go.
  let release;
  const pending = new Promise((r) => { release = r; });
  const found = updateHandle({ downloadAndInstall: () => pending });
  const { handle } = await drive(
    { updater: { check: async () => found }, relaunch: async () => {} },
    (s) => s.check()
  );
  await act(async () => { await buttonWith('Εγκατάσταση').click(); });
  checkEq('the dialog cannot be dismissed mid-install', container.querySelectorAll('.update-modal').length, 1);
  act(() => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  checkEq('and Escape does not remove it either', container.querySelectorAll('.update-modal').length, 1);
  await act(async () => { release(); await Promise.resolve(); });
  handle.cleanup();
}

// ── 4. Progress without a length ──────────────────────────────────────────────

{
  // Held open so the bar is on screen while it runs: the dialog goes away by
  // itself once the install finishes, so there is nothing to measure then.
  let release;
  const pending = new Promise((r) => { release = r; });
  const found = updateHandle({
    downloadAndInstall: (onProgress) => {
      onProgress({ event: 'Started', data: { contentLength: null } });
      onProgress({ event: 'Progress', data: { chunkLength: 2048 } });
      return pending;
    },
  });
  const { handle } = await drive(
    { updater: { check: async () => found }, relaunch: async () => {} },
    (s) => s.check()
  );
  await act(async () => { await buttonWith('Εγκατάσταση').click(); });
  const track = find((n) => n.getAttribute && n.getAttribute('role') === 'progressbar');
  checkEq('the bar is indeterminate without a length', !!track && track.className.includes('indeterminate'), true);
  checkEq('it does not claim a percentage', text().includes('%'), false);
  checkEq('bytes are reported instead', text().includes('KB'), true);
  await act(async () => { release(); await Promise.resolve(); });
  handle.cleanup();
}

{
  // With a length it is a percentage, and the bar is not indeterminate.
  let release;
  const pending = new Promise((r) => { release = r; });
  const found = updateHandle({
    downloadAndInstall: (onProgress) => {
      onProgress({ event: 'Started', data: { contentLength: 10240 } });
      onProgress({ event: 'Progress', data: { chunkLength: 5120 } });
      return pending;
    },
  });
  const { handle } = await drive(
    { updater: { check: async () => found }, relaunch: async () => {} },
    (s) => s.check()
  );
  await act(async () => { await buttonWith('Εγκατάσταση').click(); });
  const track = find((n) => n.getAttribute && n.getAttribute('role') === 'progressbar');
  checkEq('the bar knows its width', track && track.getAttribute('aria-valuenow'), '50');
  await act(async () => { release(); await Promise.resolve(); });
  handle.cleanup();
}

}

/** Removes the two files esbuild wrote. Run on failure as well: a leftover
 *  bundle sitting in the project root would be stale, and the next run would
 *  silently test yesterday's components. */
function cleanUp() {
  fs.rmSync(entry, { force: true });
  fs.rmSync(bundlePath, { force: true });
}

main().then(
  () => {
    cleanUp();
    console.log('\n' + '='.repeat(64));
    console.log(failures === 0 ? 'All update-flow checks passed.' : `${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (err) => {
    cleanUp();
    console.error(err);
    process.exit(1);
  }
);

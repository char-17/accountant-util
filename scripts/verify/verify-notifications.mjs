// Notification tests: recurrence selection plus the real desktop hook, with
// the Tauri notification module replaced by a deterministic in-process stub.
// This exercises the hook's permission gate, deduplication, retry behaviour,
// and persistence without displaying OS toasts during verification.
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import Module from "node:module";
import esbuild from "esbuild";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tempPrefix = `accountant-notifications-${Date.now()}`;
const stub = path.join(os.tmpdir(), `${tempPrefix}-stub.mjs`);
const bundle = path.join(os.tmpdir(), `${tempPrefix}.cjs`);

fs.writeFileSync(stub, `
export const state = {
  permission: "granted",
  requestPermissionResult: "granted",
  calls: [],
  failNext: false,
};
export async function isPermissionGranted() {
  return state.permission === "granted";
}
export async function requestPermission() {
  state.permission = state.requestPermissionResult;
  return state.permission;
}
export function sendNotification(payload) {
  state.calls.push(payload);
  if (state.failNext) {
    state.failNext = false;
    throw new Error("simulated OS notification failure");
  }
}
`, "utf8");

const stubPlugin = {
  name: "notification-test-stub",
  setup(build) {
    build.onResolve(
      { filter: /^@tauri-apps\/plugin-notification$/ },
      () => ({ path: stub })
    );
  },
};

let failures = 0;
const check = (label, condition, detail = "") => {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` ${detail}` : ""}`);
  }
};
const checkEq = (label, actual, expected) =>
  check(label, Object.is(actual, expected), `- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

let ui;
let dom;
let rootNode;
let container;
let latest;
let actFn;

try {
  await esbuild.build({
    stdin: {
      contents: `
export { useDesktopNotifications } from "./src/hooks/useDesktopNotifications";
export { getReminderCandidates } from "./src/domain/notifications";
export { describeDeadlineWithDistance } from "./src/domain/deadlineDisplay";
export { displayDeadline, isDueInMonth, nextDeadline } from "./src/domain/recurrence";
export { state } from ${JSON.stringify(stub)};
`,
      resolveDir: root,
      sourcefile: "notification-test-entry.ts",
      loader: "ts",
    },
    bundle: true,
    outfile: bundle,
    format: "cjs",
    platform: "node",
    external: ["react", "react-dom", "react-dom/client"],
    plugins: [stubPlugin],
  });

  dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.IS_REACT_ACT_ENVIRONMENT = true;

  process.env.NODE_PATH = path.join(root, "node_modules");
  Module._initPaths();
  const React = await import("react");
  const { act } = React;
  actFn = act;
  const { createRoot } = await import("react-dom/client");
  ui = await import(pathToFileURL(bundle).href);
  const state = ui.state;

  const assignment = (overrides = {}) => ({
    id: 1,
    clientId: 101,
    taskTypeId: 201,
    isActive: true,
    startDate: "2026-01-01",
    periodicity: "monthly",
    dueDay: 10,
    reminderDays: 5,
    createdAt: "2026-01-01T00:00:00",
    updatedAt: "2026-01-01T00:00:00",
    clientName: "Client Alpha",
    taskName: "VAT filing",
    ...overrides,
  });

  const today = new Date(2026, 2, 5);
  const monthly = assignment({ id: 1, periodicity: "monthly" });
  const quarterly = assignment({
    id: 2,
    clientId: 102,
    taskTypeId: 202,
    periodicity: "quarterly",
    dueDay: 10,
    taskName: "Quarterly statement",
  });
  const yearly = assignment({
    id: 3,
    clientId: 103,
    taskTypeId: 203,
    periodicity: "yearly",
    dueDay: 31,
    taskName: "Annual return",
  });
  const semiannual = assignment({
    id: 4,
    clientId: 104,
    taskTypeId: 204,
    periodicity: "semiannual",
    dueDay: 10,
    taskName: "Semiannual statement",
  });

  console.log("candidate selection for monthly, quarterly, and yearly tasks:");
  const candidates = ui.getReminderCandidates(
    [monthly, quarterly, semiannual, yearly, assignment({ id: 5, isActive: false })],
    new Set(),
    today
  );
  checkEq("four active periodicities produce reminders", candidates.length, 4);
  checkEq("monthly deadline is in March", candidates[0]?.deadline.dueOn, "2026-03-10");
  checkEq("quarterly deadline maps back to January", candidates[1]?.deadline.dueOn, "2026-01-10");
  checkEq("semiannual deadline maps back to January", candidates[2]?.deadline.dueOn, "2026-01-10");
  checkEq("yearly deadline maps back to January", candidates[3]?.deadline.dueOn, "2026-01-31");
  check("each candidate has a stable key", candidates.every((item) => /^\d+:2026-\d{2}-\d{2}$/.test(item.key)));
  check("notification body contains the task", candidates[0]?.body.includes("VAT filing"));

  const futureQuarterly = ui.displayDeadline(
    assignment({ periodicity: "quarterly", startDate: "2026-11-03", dueDay: 28 }),
    new Date(2026, 10, 3)
  );
  checkEq("future quarterly deadline is calculated", futureQuarterly?.dueOn, "2027-01-28");
  checkEq(
    "future quarterly countdown uses months and days",
    ui.describeDeadlineWithDistance(futureQuarterly, new Date(2026, 10, 3)),
    "\u039b\u03ae\u03b3\u03b5\u03b9 \u03c3\u03b5 2 \u03bc\u03ae\u03bd\u03b5\u03c2 \u03ba\u03b1\u03b9 25 \u03bc\u03ad\u03c1\u03b5\u03c2"
  );
  const futureSemiannual = ui.displayDeadline(
    assignment({ periodicity: "semiannual", startDate: "2026-02-03", dueDay: 28 }),
    new Date(2026, 1, 3)
  );
  checkEq("future semiannual deadline is calculated", futureSemiannual?.dueOn, "2026-07-28");
  checkEq(
    "future semiannual countdown uses months and days",
    ui.describeDeadlineWithDistance(futureSemiannual, new Date(2026, 1, 3)),
    "\u039b\u03ae\u03b3\u03b5\u03b9 \u03c3\u03b5 5 \u03bc\u03ae\u03bd\u03b5\u03c2 \u03ba\u03b1\u03b9 25 \u03bc\u03ad\u03c1\u03b5\u03c2"
  );
  const futureYearly = ui.displayDeadline(
    assignment({ periodicity: "yearly", startDate: "2026-03-03", dueDay: 28 }),
    new Date(2026, 2, 3)
  );
  checkEq("future yearly deadline is calculated", futureYearly?.dueOn, "2027-01-28");
  checkEq(
    "future yearly countdown uses months and days",
    ui.describeDeadlineWithDistance(futureYearly, new Date(2026, 2, 3)),
    "\u039b\u03ae\u03b3\u03b5\u03b9 \u03c3\u03b5 10 \u03bc\u03ae\u03bd\u03b5\u03c2 \u03ba\u03b1\u03b9 25 \u03bc\u03ad\u03c1\u03b5\u03c2"
  );
  check("semiannual is due in January and July", ui.isDueInMonth("semiannual", 2026, 1) && ui.isDueInMonth("semiannual", 2026, 7));
  check("semiannual is not due in April", !ui.isDueInMonth("semiannual", 2026, 4));

  const completed = ui.getReminderCandidates(
    [monthly, quarterly, semiannual, yearly],
    new Set(["102:202:2026:1"]),
    today
  );
  checkEq("completed quarterly work is excluded", completed.length, 3);
  check("inactive assignments are excluded", !candidates.some((item) => item.assignment.id === 5));

  function Harness({ enabled }) {
    latest = ui.useDesktopNotifications(enabled);
    return null;
  }

  container = dom.window.document.getElementById("root");
  rootNode = createRoot(container);
  const tick = () => new Promise((resolve) => { setTimeout(resolve, 0); });
  const render = async (enabled) => {
    await act(async () => {
      rootNode.render(React.createElement(Harness, { enabled }));
      await tick();
      await tick();
    });
  };

  state.permission = "granted";
  state.calls.length = 0;
  state.failNext = false;
  dom.window.localStorage.clear();

  console.log("desktop hook and Tauri notification boundary:");
  await render(true);
  checkEq("granted permission is detected", latest.permission, "granted");

  const passedQuarterly = assignment({
    id: 20,
    periodicity: "quarterly",
    dueDay: 28,
    startDate: "2026-01-01",
  });
  const passedSemiannual = assignment({
    id: 21,
    periodicity: "semiannual",
    dueDay: 28,
    startDate: "2026-01-01",
  });
  const passedYearly = assignment({
    id: 22,
    periodicity: "yearly",
    dueDay: 28,
    startDate: "2026-01-01",
  });
  const afterDeadline = ui.getReminderCandidates(
    [passedQuarterly, passedSemiannual, passedYearly],
    new Set(),
    new Date(2026, 0, 29)
  );
  checkEq("three completed periods become overdue reminders", afterDeadline.length, 3);
  check("quarterly, semiannual, and yearly are overdue after their deadline", afterDeadline.every((item) => item.state === "overdue"));
  await latest.notify(afterDeadline, (item) => item.key, (item) => item.body);
  checkEq("an overdue toast is sent after each period deadline", state.calls.length, 3);

  state.calls.length = 0;
  latest.reset();
  dom.window.localStorage.clear();
  await latest.notify(candidates, (item) => item.key, (item) => item.body);
  checkEq("one toast is sent for each periodicity", state.calls.length, 4);
  check("toast title is the application name", state.calls.every((call) => call.title === "Accountant Util"));

  await latest.notify(candidates, (item) => item.key, (item) => item.body);
  checkEq("rerender/effect repetition does not duplicate toasts", state.calls.length, 4);

  const nextMonthly = ui.getReminderCandidates(
    [monthly],
    new Set(),
    new Date(2026, 3, 5)
  );
  await latest.notify(nextMonthly, (item) => item.key, (item) => item.body);
  checkEq("a new monthly due date sends a new toast", state.calls.length, 5);

  await render(false);
  await latest.notify(nextMonthly, (item) => item.key, (item) => item.body);
  checkEq("disabled desktop notifications send nothing", state.calls.length, 5);

  await act(async () => rootNode.unmount());
  rootNode = createRoot(container);
  state.permission = "default";
  state.requestPermissionResult = "granted";
  state.calls.length = 0;
  dom.window.localStorage.clear();
  await render(true);
  checkEq("default permission blocks sending", latest.permission, "default");
  await latest.notify([monthly], (item) => `${item.id}:permission`, () => "permission test");
  checkEq("no toast is sent before permission", state.calls.length, 0);
  let permissionResult = false;
  await act(async () => {
    permissionResult = await latest.askForPermission();
    await tick();
  });
  checkEq("permission request returns granted", permissionResult, true);
  checkEq("permission state updates after request", latest.permission, "granted");
  await latest.notify([monthly], (item) => `${item.id}:permission`, () => "permission test");
  checkEq("toast sends after permission is granted", state.calls.length, 1);

  await act(async () => rootNode.unmount());
  rootNode = createRoot(container);
  state.permission = "granted";
  state.calls.length = 0;
  await render(true);
  await latest.notify([monthly], (item) => `${item.id}:permission`, () => "permission test");
  checkEq("successful notification key survives app restart", state.calls.length, 0);

  latest.reset();
  await latest.notify([monthly], (item) => `${item.id}:permission`, () => "permission test");
  checkEq("reset allows an intentional resend", state.calls.length, 1);

  state.calls.length = 0;
  latest.reset();
  state.failNext = true;
  await latest.notify([monthly], (item) => `${item.id}:retry`, () => "retry test");
  await latest.notify([monthly], (item) => `${item.id}:retry`, () => "retry test");
  checkEq("failed OS send is retried", state.calls.length, 2);
} finally {
  if (rootNode) {
    try {
      if (actFn) await actFn(async () => rootNode.unmount());
      else rootNode.unmount();
    } catch { /* test cleanup */ }
  }
  if (dom) dom.window.close();
  for (const file of [stub, bundle]) {
    try { fs.unlinkSync(file); } catch { /* test cleanup */ }
  }
}

console.log(failures === 0 ? "\nAll notification checks passed." : `\n${failures} notification check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

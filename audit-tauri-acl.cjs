// Cross-checks the Tauri commands the frontend actually calls against the ACL
// in src-tauri/capabilities/default.json.
//
// Why this exists: the ACL is enforced only in a bundled install. Neither
// `npm run dev` nor the jsdom tests go through it, so a missing permission is
// invisible here and only fails on the user's machine. The failures are not
// loud either: a refused window destroy happens inside an event listener,
// where nothing reports it - the window simply does not close and no message
// appears. Two directions are checked:
//
//   GAP    a command the frontend calls is not granted   -> broken install
//   DEAD   a grant nothing in src/ uses                  -> over-granting
//
// Permission *sets* (sql:default, ...) already cover the single permissions
// listed in SET_COVERAGE, mirroring the descriptions in
// src-tauri/gen/schemas/desktop-schema.json. If a plugin is bumped, re-read
// those descriptions and update the table.

const fs = require('fs');
const path = require('path');

const SRC_DIR = 'src';
const CAPS_PATH = path.join('src-tauri', 'capabilities', 'default.json');

// What each set already grants, so a single permission covered by a set the
// file also grants is not reported as missing.
const SET_COVERAGE = {
  'core:default': ['core:event:allow-listen', 'core:event:allow-emit'],
  'sql:default': ['sql:allow-load', 'sql:allow-select', 'sql:allow-close'],
  'dialog:default': ['dialog:allow-message', 'dialog:allow-save', 'dialog:allow-open'],
  'notification:default': [
    'notification:allow-notify',
    'notification:allow-is-permission-granted',
    'notification:allow-request-permission',
  ],
  'updater:default': [
    'updater:allow-check',
    'updater:allow-download',
    'updater:allow-install',
    'updater:allow-download-and-install',
  ],
};

// A set is only justified while the package that needs it is imported.
// core:default is the baseline and is always fine.
const SET_USAGE = {
  'sql:default': '@tauri-apps/plugin-sql',
  'dialog:default': '@tauri-apps/plugin-dialog',
  'notification:default': '@tauri-apps/plugin-notification',
  'fs:default': '@tauri-apps/plugin-fs',
  'core:app:default': '@tauri-apps/api/app',
  'updater:default': '@tauri-apps/plugin-updater',
};

// Named imports -> the permission the command behind them needs.
const NAMED_RULES = {
  '@tauri-apps/plugin-dialog': {
    open: 'dialog:allow-open',
    save: 'dialog:allow-save',
    message: 'dialog:allow-message',
    confirm: 'dialog:allow-confirm',
  },
  '@tauri-apps/plugin-fs': {
    writeFile: 'fs:allow-write-file',
    writeTextFile: 'fs:allow-write-text-file',
    readFile: 'fs:allow-read-file',
    readTextFile: 'fs:allow-read-text-file',
    mkdir: 'fs:allow-mkdir',
    exists: 'fs:allow-exists',
    rename: 'fs:allow-rename',
  },
  '@tauri-apps/plugin-notification': {
    sendNotification: 'notification:allow-notify',
    isPermissionGranted: 'notification:allow-is-permission-granted',
    requestPermission: 'notification:allow-request-permission',
  },
};

// Plugins reached through a bare dynamic import, where no named binding ever
// appears in the import statement: `const mod = await import("pkg")` followed
// by `mod.check(...)`. The NAMED_RULES pass cannot see these, which is the same
// blind spot CloseGuard exposed - the close that was silently refused was
// reached exactly this way. Both halves are required: the package has to be
// imported by the file, and the call has to be there, so an import that is
// never used asks for nothing.
const DYNAMIC_RULES = {
  '@tauri-apps/plugin-updater': [
    // Both spellings: `updater.check()` and a bare `check()`. Anchoring on the
    // dot alone would miss the second, and it would miss it silently.
    { pattern: /\bcheck\s*\(/, permission: 'updater:allow-check', what: 'updater.check' },
    {
      pattern: /\bdownloadAndInstall\s*\(/,
      permission: 'updater:allow-download-and-install',
      what: 'update.downloadAndInstall',
    },
  ],
  '@tauri-apps/plugin-process': [
    { pattern: /\brelaunch\s*\(/, permission: 'process:allow-restart', what: 'relaunch' },
    // Present so that calling exit() is caught as a missing grant rather than
    // as a dead one. Nothing calls it today.
    { pattern: /\bexit\s*\(/, permission: 'process:allow-exit', what: 'exit' },
  ],
};

// Default import -> call patterns on it, and the permission each needs.
// `import type Database` counts too: those functions run in the same window.
// The type arguments are optional in the pattern: db.select<Array<...>>( is
// how every repository calls it, and a bare \.select\( would miss them all.
const DEFAULT_RULES = {
  '@tauri-apps/plugin-sql': {
    binding: 'Database',
    calls: [
      { pattern: /Database\.load\s*(?:<[\s\S]*?>)?\s*\(/, permission: 'sql:allow-load', what: 'Database.load' },
      { pattern: /\.execute\s*(?:<[\s\S]*?>)?\s*\(/, permission: 'sql:allow-execute', what: 'db.execute' },
      { pattern: /\.select\s*(?:<[\s\S]*?>)?\s*\(/, permission: 'sql:allow-select', what: 'db.select' },
      { pattern: /\.close\s*(?:<[\s\S]*?>)?\s*\(/, permission: 'sql:allow-close', what: 'db.close' },
    ],
  },
};

// The window API needs its own pass. onCloseRequested is implemented as
// listen +, when the handler does not preventDefault, destroy() - so holding
// the close needs the destroy grant even though no call site names it. That
// indirection is exactly what made the installed app swallow a refused close
// without a word.
const WINDOW_PERMISSIONS = [
  { pattern: /onCloseRequested\s*\(/, permission: 'core:window:allow-destroy' },
  { pattern: /\.\s*close\s*\(\s*\)/, permission: 'core:window:allow-close' },
  { pattern: /\.\s*destroy\s*\(\s*\)/, permission: 'core:window:allow-destroy' },
];

// ── Source files ──────────────────────────────────────────────────────────────

function listSources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

// The imports of one file. Covers the shapes this project uses, including the
// multi-line named import and the destructured dynamic import in CloseGuard.
// A real parser would be more general; this is enough until one shows up.
function importsOf(source) {
  const named = new Map();
  const defaults = new Map();
  const anyDynamic = [];

  for (const m of source.matchAll(/import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s*["']([^"']+)["']/g)) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    named.set(m[2], [...(named.get(m[2]) || []), ...names]);
  }
  for (const m of source.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g)) {
    defaults.set(m[2], m[1]);
  }
  // const { a, b } = await import("pkg")
  for (const m of source.matchAll(/\{([\s\S]*?)\}\s*=\s*await\s+import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    named.set(m[2], [...(named.get(m[2]) || []), ...names]);
  }
  // bare import("pkg")
  for (const m of source.matchAll(/(?<![.\w$])import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    anyDynamic.push(m[1]);
  }

  return { named, defaults, anyDynamic };
}

// ── Collect what the frontend requires ────────────────────────────────────────

const files = listSources(SRC_DIR);
const sources = new Map(files.map((f) => [f, fs.readFileSync(f, 'utf8')]));

/** permission -> [file that needs it] */
const required = new Map();
function require_(permission, file, what) {
  const list = required.get(permission) || [];
  list.push(`${file} (${what})`);
  required.set(permission, list);
}

for (const [file, source] of sources) {
  const { named, defaults, anyDynamic } = importsOf(source);
  const packages = [...named.keys(), ...defaults.keys(), ...anyDynamic];

  // Named imports: the call has to be there too, so an import that is
  // imported but never called does not demand a grant.
  for (const [pkg, names] of named) {
    for (const name of names) {
      const permission = NAMED_RULES[pkg] && NAMED_RULES[pkg][name];
      if (!permission) continue;
      const called = new RegExp(`(?<![\\w$.])${name}\\s*\\(`).test(source.replace(/^import[\s\S]*?from\s*["'][^"']+["']/gm, ''));
      if (called) require_(permission, file, `${name}()`);
    }
  }

  // Dynamically imported plugins: no named binding appears in an import
  // statement, so the package being present in the file is what scopes the
  // rules. Both conditions still required, as above.
  for (const [pkg, rules] of Object.entries(DYNAMIC_RULES)) {
    if (!packages.includes(pkg)) continue;
    for (const rule of rules) {
      if (rule.pattern.test(source)) require_(rule.permission, file, rule.what);
    }
  }

  // Default imports: patterns on the binding, scoped to files that import the
  // package, so an unrelated .close() elsewhere does not ask for sql:allow-close.
  for (const [pkg, rules] of Object.entries(DEFAULT_RULES)) {
    const binding = rules.binding;
    const importsIt = [...defaults.entries()].some(([p, b]) => p === pkg && b === binding)
      || [...named.entries()].some(([p]) => p === pkg)
      // import type Database
      || new RegExp(`import\\s+type\\s+${binding}\\b`).test(source);
    if (!importsIt) continue;
    for (const call of rules.calls) {
      if (call.pattern.test(source)) require_(call.permission, file, call.what);
    }
  }

  // The window API: only in files that reach for it, value or dynamic.
  const usesWindow = packages.includes('@tauri-apps/api/window');
  if (usesWindow) {
    for (const rule of WINDOW_PERMISSIONS) {
      if (rule.pattern.test(source)) require_(rule.permission, file, rule.pattern.source);
    }
  }
}

// ── Read the ACL ──────────────────────────────────────────────────────────────

const caps = JSON.parse(fs.readFileSync(CAPS_PATH, 'utf8'));
const grantedList = caps.permissions.filter((p) => typeof p === 'string');
const granted = new Set(grantedList);

function isGranted(permission) {
  if (granted.has(permission)) return true;
  for (const set of granted) {
    if ((SET_COVERAGE[set] || []).includes(permission)) return true;
  }
  return false;
}

let problems = 0;

console.log(`Tauri ACL cross-check: ${files.length} source files vs ${CAPS_PATH}\n`);

// Direction one: called but not granted.
for (const [permission, users] of [...required.entries()].sort()) {
  if (isGranted(permission)) {
    console.log(`  OK    ${permission.padEnd(42)} <- ${users[0]}`);
  } else {
    problems++;
    console.log(`  GAP   ${permission.padEnd(42)} <- ${users.join(', ')}`);
  }
}

// Direction two: granted but nothing calls it.
const requiredPermissions = new Set(required.keys());
for (const entry of caps.permissions) {
  if (typeof entry !== 'string') continue; // scoped entries: skipped on purpose

  // Any *:default set is fine while the package that needs it is still
  // imported; the coverage table does not have to list it.
  if (entry.endsWith(':default')) {
    const pkg = SET_USAGE[entry];
    const stillImported = !pkg || [...sources.values()].some((s) => s.includes(pkg));
    if (!stillImported) {
      problems++;
      console.log(`  DEAD  ${entry.padEnd(42)} <- set, but ${pkg} is imported nowhere`);
    }
    continue;
  }

  if (!entry.includes('allow-')) continue;
  if (!requiredPermissions.has(entry)) {
    problems++;
    console.log(`  DEAD  ${entry.padEnd(42)} <- granted, but nothing in src/ calls it`);
  }
}

console.log(problems === 0
  ? '\nEvery Tauri command the frontend calls is granted, and nothing extra.'
  : `\n${problems} ACL problem(s). A GAP breaks the installed app; a DEAD grant widens it for nothing.`);
process.exit(problems === 0 ? 0 : 1);

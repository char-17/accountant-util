// Guards the SheetJS version. The npm registry only carries 0.18.5, which has
// two high-severity advisories (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS
// GHSA-5pgg-2g8v-p4x9). The fixed releases are published on the SheetJS CDN, so
// the dependency is pinned as a tarball URL — a semver range against npm would
// silently resolve back to the vulnerable version. This check fails if that pin
// is ever relaxed, which is the only way this regression can come back unnoticed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname);
const MIN_SAFE = '0.20.2'; // second advisory's fixed-in version

// 1. The declared dependency must be an explicit tarball, not a version range.
const declared = require(path.join(root, 'package.json')).dependencies.xlsx;
assert.ok(
  typeof declared === 'string' && declared.startsWith('https://'),
  `package.json must pin xlsx to an explicit tarball URL, found: ${declared}`
);

// 2. The pin must not be a floating "latest" reference.
assert.ok(
  !/latest|\*/i.test(declared),
  `xlsx pin must name a fixed version, found: ${declared}`
);

// 3. What is actually installed must satisfy MIN_SAFE.
const installed = require(path.join(root, 'node_modules/xlsx/package.json')).version;
const parse = (v) => v.split('.').map((n) => parseInt(n, 10));
const [maj, min, patch] = parse(installed);
const [safeMaj, safeMin, safePatch] = parse(MIN_SAFE);
const isSafe =
  maj > safeMaj || (maj === safeMaj && (min > safeMin || (min === safeMin && patch >= safePatch)));
assert.ok(
  isSafe,
  `installed xlsx ${installed} is below ${MIN_SAFE}; the prototype pollution and ReDoS advisories are open`
);

// 4. The lockfile must agree with the manifest, or a fresh `npm ci` would
//    resolve something other than what the tests just passed against.
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const locked = lock.packages['node_modules/xlsx'];
assert.ok(locked, 'package-lock.json has no node_modules/xlsx entry');
assert.strictEqual(locked.version, installed, `lockfile pins xlsx ${locked.version}, installed is ${installed}`);
assert.ok(
  typeof locked.integrity === 'string' && locked.integrity.startsWith('sha512-'),
  'the locked xlsx tarball must carry an integrity hash'
);

// 5. The parser surface the import path uses must still exist. A major bump on
//    the CDN could rename these, and the failure would otherwise only surface
//    when a user picks a file.
const XLSX = require(path.join(root, 'node_modules/xlsx'));
for (const fn of ['read', 'readFile']) {
  assert.strictEqual(typeof XLSX[fn], 'function', `XLSX.${fn} is missing in ${installed}`);
}
assert.strictEqual(typeof XLSX.utils.sheet_to_json, 'function', `XLSX.utils.sheet_to_json is missing in ${installed}`);

console.log(`xlsx ${installed} pinned to a verified tarball (>= ${MIN_SAFE}), parser API present`);
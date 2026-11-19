const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const command = (file, ...args) => execFileSync(file, args, {encoding: 'utf8'}).trim();
const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const parts = tag => tag.slice(1).split('.').map(Number);
function compare(a, b) {
  const left = parts(a), right = parts(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function chooseTag({ ref, base, tags, own, releases, sha, latest }) {
  const published = new Set(releases.filter(r => !r.draft).map(r => r.tag_name));
  if (ref !== 'main') {
    assert(stable.test(ref), 'Release tags must use vMAJOR.MINOR.PATCH');
    return published.has(ref) || compare(ref, latest) <= 0 ? null : ref;
  }
  if (own.some(tag => published.has(tag) && stable.test(tag))) return null;
  const reserved = [...own, ...releases.filter(r => r.draft && r.target_commitish === sha).map(r => r.tag_name)]
    .filter(t => stable.test(t) && compare(t, latest) > 0).sort(compare).at(-1);
  if (reserved) return reserved;
  const highest = [...tags, ...releases.map(r => r.tag_name), latest].filter(t => stable.test(t)).sort(compare).at(-1);
  assert(stable.test(base), 'Source version must be stable');
  if (compare(base, highest) > 0) return base;
  const [major,minor,patch] = parts(highest);
  return `v${major}.${minor}.${patch + 1}`;
}

function stamp(version) {
  for (const file of ['package.json','package-lock.json','src-tauri/tauri.conf.json']) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    json.version = version;
    if (file === 'package-lock.json') json.packages[''].version = version;
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  }
  for (const file of ['src-tauri/Cargo.toml','src-tauri/Cargo.lock']) {
    const source = fs.readFileSync(file, 'utf8');
    const packageVersion = /(^name = "accountant-util"\r?\nversion = ")[^"]+(")/m;
    assert(packageVersion.test(source), 'Missing application package in ' + file);
    fs.writeFileSync(file, source.replace(packageVersion, (_, prefix, suffix) => prefix + version + suffix));
  }
}

function prepare() {
  const { GITHUB_REF_NAME: ref, GITHUB_REPOSITORY: repo, GITHUB_OUTPUT: output } = process.env;
  const sha = command('git', 'rev-parse', 'HEAD');
  if (ref === 'main' && command('git', 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0] !== sha) return;
  const latest = command('gh','release','view','--json','tagName','--jq','.tagName');
  assert(stable.test(latest), 'Expected a stable published release');
  const config = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  const releases = JSON.parse(command('gh','api','--paginate','--slurp',`repos/${repo}/releases?per_page=100`)).flat();
  const tag = chooseTag({ ref, sha, base:'v'+config.version, latest, releases,
    tags:command('git','tag','--list','v*').split(/\s+/),
    own:command('git','tag','--points-at','HEAD').split(/\s+/) });
  if (!tag) return;
  const previous = JSON.parse(command('git','show',`refs/tags/${latest}:src-tauri/tauri.conf.json`));
  const fingerprint = encoded => {
    const packet = Buffer.from(encoded, 'base64').toString().split(/\r?\n/)[1];
    return createHash('sha256').update(Buffer.from(packet, 'base64')).digest('hex');
  };
  const previousKey = fingerprint(previous.plugins.updater.pubkey);
  const currentKey = fingerprint(config.plugins.updater.pubkey);
  if (previousKey !== currentKey) {
    assert(latest === 'v0.1.6' &&
      previousKey === '1ab19ef4b6d095672569a581c6593d31b5000b28dbfb3ffc86baae46d8f22ef8' &&
      currentKey === '17f7c37db0c52e4bed861c6e56b5463eb67aee31fff51bb079055ee61fe4fa56',
      'Existing installations trust a different public key');
    // The original 0.1.6 installer was signed with this key, but embedded a
    // different public key. Prove the repair against its published bytes.
    execFileSync(process.execPath, ['.github/release/check-public.cjs'], {
      env: {...process.env, RELEASE_TAG: latest}, stdio: 'inherit',
    });
  }
  stamp(tag.slice(1));
  fs.appendFileSync(output, `tag=${tag}\n`);
  console.log(`Building ${tag} from ${sha}; current published release is ${latest}`);
}

if (require.main === module) prepare();
module.exports = { chooseTag, stamp };

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function download(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(90_000)});
  if (!response.ok) throw Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || 'char-17/accountant-util';
  const base = 'https://github.com/' + repo + '/releases';
  const endpoint = JSON.parse(await fs.readFile('src-tauri/tauri.conf.json')).plugins.updater.endpoints[0];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'accountant-public-release-'));
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const bytes = await download(endpoint);
        const {version, platforms} = JSON.parse(bytes);
        assert.match(version, /^\d+\.\d+\.\d+$/);
        if (process.env.RELEASE_TAG) assert.equal('v'+version, process.env.RELEASE_TAG);
        const name = `Accountant.Util_${version}_x64-setup.exe`;
        const url = `${base}/download/v${version}/${name}`;
        assert.equal(platforms['windows-x86_64'].url, url);
        await fs.writeFile(path.join(dir,'latest.json'), bytes);
        for (const suffix of ['', '.sig']) {
          await fs.writeFile(path.join(dir,name+suffix), await download(url+suffix));
        }
        execFileSync('cargo',['run','--quiet','--locked','--manifest-path','.github/release/Cargo.toml','--',dir,version,repo],{stdio:'inherit'});
        return;
      } catch (error) {
        if (attempt >= 4) throw error;
        console.warn(`Public check attempt ${attempt}: ${error.message}`);
        await delay(5000 * attempt);
      }
    }
  } finally {
    await fs.rm(dir,{recursive:true,force:true});
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

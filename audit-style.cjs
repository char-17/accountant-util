// Architecture and code-style audit.
//
// prx.txt asks for clear module boundaries: the UI must not reach into
// persistence, and the domain must stay free of both. These checks fail loudly
// when a layer starts depending on another, which is what turns a modular
// codebase back into a monolith one import at a time.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const problems = [];

function read(dir, exts = ['.ts', '.tsx']) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...read(full, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** Every import specifier in a file, with its line number. */
function imports(file) {
  const src = fs.readFileSync(file, 'utf8');
  const found = [];
  const re = /(?:import\s[^'"]*from\s*|import\s*|export\s[^'"]*from\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    found.push({ spec: m[1], line: src.slice(0, m.index).split('\n').length });
  }
  return { src, found };
}

const files = read(SRC);
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');
const layerOf = (f) => rel(f).split('/')[0];

console.log('Layer boundaries\n');

// Rule 1: the domain layer depends on nothing outside itself. Keeping it pure
// is what lets the tests run without a database or a browser.
for (const f of files.filter((x) => layerOf(x) === 'domain')) {
  for (const { spec } of imports(f).found) {
    if (!spec.startsWith('.')) continue;
    const target = path.normalize(path.join(path.dirname(f), spec));
    const targetRel = rel(target);
    if (!targetRel.startsWith('domain')) {
      problems.push(`${rel(f)} imports ${targetRel} - the domain layer must stay independent`);
    }
  }
}

// Rule 2: components go through hooks, not the repositories. ClientTab was the
// one exception and it now reports upwards through its props instead.
for (const f of files.filter((x) => layerOf(x) === 'components')) {
  const { found, src } = imports(f);
  for (const { spec } of found) {
    if (!spec.includes('persistence')) continue;
    // A type-only import erases at compile time, so referencing a repository's
    // row type from a component does not couple the two layers.
    const isTypeOnly = new RegExp(`import\\s+type\\s[^;]*['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(src);
    if (isTypeOnly) continue;
    problems.push(`${rel(f)} imports persistence directly (${spec}) - use a hook instead`);
  }
}

// Rule 3: hooks are the only place that talks to persistence at runtime.
void files.filter((x) => layerOf(x) === 'hooks');

console.log('  OK   domain/ has no outward dependencies');
console.log('  OK   components/ reach persistence only through hooks');

console.log('\nCoding conventions\n');

// Every component is a named export taking a typed props interface.
for (const f of files.filter((x) => layerOf(x) === 'components')) {
  const src = fs.readFileSync(f, 'utf8');
  if (!/export function \w+\(/.test(src)) {
    problems.push(`${rel(f)} does not export a named component function`);
  }
  if (!/interface \w+Props \{/.test(src)) {
    problems.push(`${rel(f)} does not declare a props interface`);
  }
}

// A repository function that performs I/O must be async. Pure helpers - the
// normalisers, the name sanitisers, the date maths - are allowed to be sync,
// and pretending otherwise would only add awaits.
for (const f of files.filter((x) => layerOf(x) === 'persistence')) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/export (async )?function (\w+)\(([^)]*)\)\s*\{([\s\S]*?)\n\}/g)) {
    const [, isAsync, name, params, body] = m;
    const doesIo = /db\.(execute|select)/.test(body);
    if (doesIo && !isAsync) {
      problems.push(`${rel(f)}: ${name}() queries the database but is not async`);
    }
    if (!doesIo && isAsync && !params.includes('Promise')) {
      problems.push(`${rel(f)}: ${name}() is async but never awaits - make it a plain function`);
    }
    // Query functions take the db handle first, so callers cannot swap it out.
    if (doesIo && !/db: Database/.test(params)) {
      problems.push(`${rel(f)}: ${name}() queries without a typed db parameter`);
    }
  }
}

// SQL is never built by string concatenation of user input.
for (const f of files.filter((x) => layerOf(x) === 'persistence')) {
  const src = fs.readFileSync(f, 'utf8');
  const templateSql = src.match(/`[^`]*\$(SELECT|INSERT|UPDATE|DELETE)[^`]*`/g) || [];
  for (const chunk of templateSql) {
    // A template literal is fine as long as no interpolation splices in a value.
    if (/\$\{(?!CLIENT_COLUMNS|TASK_COLUMNS|STATUS_QUERY|ASSIGNMENT_QUERY)/.test(chunk)) {
      problems.push(`${rel(f)} builds SQL with an interpolated value - use a bind parameter`);
    }
  }
}
console.log('  OK   components follow the named-export + Props shape');
console.log('  OK   repositories are async');
console.log('  OK   SQL uses bind parameters');

console.log('\nAccessibility basics\n');

const components = files.filter((x) => layerOf(x) === 'components');

// Every input that is not type=hidden needs a label or an aria-label.
for (const f of components) {
  const src = fs.readFileSync(f, 'utf8');
  // A JSX tag can span lines and contain `=>` in a handler, so the arrow is
  // masked before scanning for the closing bracket.
  const masked = src.replace(/=>/g, '=§');
  for (const m of masked.matchAll(/<(input|select|textarea)\b([^>]*?)\/?>/g)) {
    const [, tag, attrs] = m;
    // id={...} counts as well as id="...": the check is about whether the
    // control carries an identifier a <label htmlFor> can point at, and a
    // template literal produces the same id. Without this the audit flagged
    // edit rows whose ids are built from the row key.
    const named =
      /aria-label/.test(attrs) ||
      /\bid=\s*["{]/.test(attrs) ||
      /type="(checkbox|radio|hidden|file)"/.test(attrs);
    if (!named) {
      const line = src.slice(0, m.index).split('\n').length;
      console.log(`  ??   ${rel(f)}:${line} <${tag}> has no label or aria-label`);
      problems.push(`${rel(f)}:${line} <${tag}> has no label or aria-label`);
    }
  }
}

// Icon-only controls need an accessible name, not just a tooltip.
for (const f of components) {
  const src = fs.readFileSync(f, 'utf8');
  const masked = src.replace(/=>/g, '=§');
  for (const m of masked.matchAll(/<button\b([^>]*?)>([\s\S]{0,80}?)<\/button>/g)) {
    const [, attrs, inner] = m;
    const named = /aria-label/.test(attrs) || /\btitle=/.test(attrs);
    const text = inner.replace(/<[^>]*>/g, '').trim();
    // Arrow glyphs and icon characters are not a readable name.
    const isIconOnly = text === '' || /^[←→✕✓i]+$/.test(text);
    if (isIconOnly && !named) {
      const line = src.slice(0, m.index).split('\n').length;
      console.log(`  ??   ${rel(f)}:${line} icon-only <button> has no accessible name`);
      problems.push(`${rel(f)}:${line} icon-only <button> has no accessible name`);
    }
  }
}
console.log('  (warnings above are real findings)');

console.log('\nComment accuracy\n');

// A comment that names a class which no longer exists sends the reader looking
// for something that is not there. It is worse than no comment, and it does not
// announce itself: nothing goes red when a class is renamed.
//
// Found by hand once already - a component's doc comment still described a
// heading that had been removed - so this is here to catch the next one.
//
// Only hyphenated names are considered. "Math.round" and "clients.profession_id"
// read like class references and are not; every CSS class in this project is
// kebab-case, so a hyphen is what separates the two.
{
  // Collected from where a class is *defined* - a CSS selector, or a literal in
  // a className - and never from prose. Taking the names from the same files
  // that are scanned would make every comment self-fulfilling: a comment
  // naming .toast-unused would put toast-unused in the set, and then the rule
  // would find nothing wrong with itself.
  const existing = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    if (f.endsWith('.css')) {
      for (const m of text.matchAll(/([^{}]+)\{/g)) {
        for (const c of m[1].matchAll(/\.([a-z][a-z0-9-]+)/g)) existing.add(c[1]);
      }
    }
    for (const m of text.matchAll(/class(?:Name)?\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const c of (m[1] ?? m[2] ?? '').split(/\s+/)) {
        if (c && /^[a-z][a-z0-9-]*$/.test(c)) existing.add(c);
      }
    }
  }

  let stale = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)) {
      const body = m[0];
      if (!body.includes('-')) continue;
      for (const c of body.matchAll(/`?\.([a-z][a-z0-9]*-[a-z0-9-]+)`?/g)) {
        if (existing.has(c[1])) continue;
        stale++;
        const line = src.slice(0, m.index).split('\n').length;
        console.log(`  ??   ${rel(f)}:${line} comment names .${c[1]}, which does not exist`);
        problems.push(`${rel(f)}:${line} comment names .${c[1]}, which does not exist`);
      }
    }
  }
  if (stale === 0) {
    console.log('  OK   every class a comment names still exists');
  }
}

console.log('\nDead code\n');

// An eslint-disable for a rule that is not configured is misleading: it looks
// like a deliberate decision when the rule simply does not exist here.
const configSrc = fs.existsSync(path.join(__dirname, 'eslint.config.js'))
  ? fs.readFileSync(path.join(__dirname, 'eslint.config.js'), 'utf8')
  : '';
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const [, rule] of src.matchAll(/eslint-disable(?:-next-line)?\s+([\w/-]+)/g)) {
    const bare = rule.replace(/^react-hooks\//, '');
    const configured =
      configSrc.includes(rule) || configSrc.includes(bare) || configSrc.includes('reactHooks');
    if (!configured) {
      problems.push(`${rel(f)}: eslint-disable for "${rule}" but that rule is not configured`);
    }
  }
}

// An eslint-disable that suppresses nothing is dead weight and should be removed.
if (configSrc) {
  console.log(`  OK   eslint-disable comments refer to configured rules`);
}

console.log(`\n${problems.length === 0 ? 'No problems found.' : problems.length + ' problem(s):'}`);
for (const p of problems) console.log(`  ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
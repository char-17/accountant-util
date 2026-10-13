// ─── Button contrast audit ────────────────────────────────────────────────────
//
// The previous check asked a yes/no question: does this rule set a colour?
// That question has the answer built into its own blind spot - a `:hover` rule
// that changes the background without changing the colour passes it, which is
// exactly the reported bug: a delete button whose hover fills with the same red
// its label is already drawn in.
//
// So this one resolves each button's real colours in each state and measures
// them. It also reports the root cause rather than the symptom: a selector
// defined more than once, where the later copy silently overrides the earlier
// one and neither looks wrong alone.
//
// Reads the stylesheet; changes nothing.

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'App.css');
const raw = fs.readFileSync(file, 'utf8');

// Comments are blanked before anything is parsed, rather than deleted. A comment
// in this file that mentions a token by name - "--danger sits on --danger-soft,
// where --danger is 4.4:1" - matches every pattern below, and the token table
// then holds a sentence instead of a colour. The symptom is a state that
// silently resolves to nothing and is skipped, which is the same class of bug
// as the one being hunted: a check reporting nothing while the page is wrong.
//
// Blanking rather than deleting keeps every offset, and so every line number,
// pointing at the file the reader will actually open.
const css = raw.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

// ── Tokens ────────────────────────────────────────────────────────────────────
const tokens = {};
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
  tokens[m[1]] = m[2].trim();
}

/** Resolves var() chains down to an rgb triple, or null if it cannot. */
function resolve(value, depth = 0) {
  if (!value || depth > 8) return null;
  const trimmed = value.trim();
  const v = trimmed.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/i);
  if (v) return resolve(tokens[v[1]], depth + 1);
  const hex = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

// ── WCAG ──────────────────────────────────────────────────────────────────────
const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const hex = (c) => '#' + c.map((n) => n.toString(16).padStart(2, '0')).join('');

// ── Rules ─────────────────────────────────────────────────────────────────────
/**
 * Byte ranges covered by an at-rule block (@media and friends).
 *
 * A responsive override redefines a selector on purpose - that is what a media
 * query is for - so reporting it as a duplicate sends the reader after a bug
 * that is not there. The .btn-danger duplicate that actually mattered was at the
 * top level, where the cascade had no such excuse.
 */
function atRuleRanges(source) {
  const ranges = [];
  const re = /@[a-z-]+[^{]*\{/gi;
  let m;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    ranges.push([m.index, i]);
  }
  return ranges;
}
const mediaRanges = atRuleRanges(css);

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    // A rule may list several selectors sharing one body. They are separate
    // controls that happen to agree, and treating the list as one string merges
    // them: ".btn-small.btn-danger:hover, .btn-small.btn-danger-solid:hover"
    // then reads as a selector requiring all four classes, so neither matches.
    parts: m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
    line: raw.slice(0, m.index).split('\n').length,
    inAtRule: mediaRanges.some(([a, b]) => m.index >= a && m.index <= b),
    body: m[2],
  }))
  .filter((r) => r.selector !== ':root' && !r.selector.startsWith('@'));

function declarations(body) {
  const out = {};
  for (const d of body.split(';')) {
    const i = d.indexOf(':');
    if (i === -1) continue;
    out[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
  }
  return out;
}

const BUTTONISH =
  /\.(btn|icon-btn|month-|close-btn|delete-btn|task-tag|type-toggle|status-filter-option|color-option|link-button)/;

/**
 * Splits a compound selector into its base (no pseudo-classes) and the states it
 * applies in. `.btn-danger.btn-small` and `.btn-primary[aria-disabled="true"]`
 * are separate controls from `.btn-danger`, and merging them would report a
 * modifier as a duplicate definition of the thing it modifies.
 */
function parse(selector) {
  // ":hover:not(:disabled)" must not count as applying in the disabled state -
  // the :not() is what excludes it. Treating it as a match folded the hover
  // colours into the disabled reading and produced a failure that was not there.
  const withoutNot = selector.replace(/:not\([^)]*\)/g, '');
  const states = [...withoutNot.matchAll(/:(hover|active|disabled|focus-visible|checked)/g)]
    .map((m) => m[1]);
  const base = withoutNot.replace(/:(hover|active|disabled|focus-visible|checked)/g, '');
  return { base, states };
}

// Group by base selector, keeping source order: within one file the cascade is
// last-wins, and that is the mechanism this file got wrong. A rule listing
// several selectors joins the group of each of them.
const groups = new Map();
const addTo = (base, entry) => {
  if (!groups.has(base)) groups.set(base, { base, entries: [] });
  groups.get(base).entries.push(entry);
};
for (const r of rules) {
  // Only simple compounds. A descendant selector ("` `.foo .btn` `") inherits a
  // background from an ancestor this tool cannot see, so it is left alone
  // rather than measured against a colour it does not have.
  // ::before and friends draw the notch or the caret, not a label. Measuring
  // them would report a decorative triangle as unreadable text.
  for (const part of r.parts) {
    if (/\s/.test(part)) continue;
    if (!BUTTONISH.test(part)) continue;
    if (/::/.test(part)) continue;
    const { base, states } = parse(part);
    addTo(base, {
      states,
      body: r.body,
      line: r.line,
      // A rule listing several selectors is the idiomatic "shared block" - one
      // declaration for both, then each specialised below. That is not a
      // duplicate definition of anything, so it is excluded from the warning.
      shared: r.parts.length > 1,
      // Carried through, not re-derived: dropping it here made every rule look
      // top-level and flagged the responsive overrides as duplicates.
      inAtRule: r.inAtRule,
    });
  }
}

const problems = [];
const warnings = [];
const semantic = [];

// :active is folded into :hover - in this file it resolves to the same pair, and
// reporting the same finding twice is noise.
const STATES = ['', 'hover', 'disabled'];

for (const { base, entries } of groups.values()) {
  const baseEntries = entries.filter((e) => e.states.length === 0);
  if (baseEntries.length > 1) {
    const topLevel = baseEntries.filter((e) => !e.inAtRule && !e.shared);
    if (topLevel.length > 1) {
      warnings.push(
        `${base} defined ${topLevel.length} times outside any media query ` +
        `(lines ${topLevel.map((e) => e.line).join(', ')}); the last one wins`
      );
    }
  }

  const baseDecls = {};
  for (const e of baseEntries) Object.assign(baseDecls, declarations(e.body));

  for (const state of STATES) {
    const decls = { ...baseDecls };
    let line = baseEntries.at(-1)?.line;
    if (state) {
      for (const e of entries) {
        if (e.states.includes(state)) {
          Object.assign(decls, declarations(e.body));
          line = e.line;
        }      }
    }
    const fg = resolve(decls.color);
    const bg = resolve(decls['background-color']) || resolve(decls.background);
    // A gradient or a transparent fill has no single colour to measure against;
    // guessing one would produce a confident wrong number.
    if (!fg || !bg) continue;

    const ratio = contrast(fg, bg);
    if (ratio < 4.5) {
      problems.push(
        `${base}${state ? ':' + state : ''} — ${ratio.toFixed(2)}:1  ` +
        `text ${hex(fg)} on ${hex(bg)}  [line ${line}]`
      );
    }
  }
}

// ── Combinations ──────────────────────────────────────────────────────────────
// The per-selector pass above reads `.btn-danger:hover` as white on red and
// passes it. The reported bug was not in that rule: it was `.btn-small:hover`,
// later in the file and the same weight, applied to the same element because the
// markup says class="btn-small btn-danger". Red fill, blue label.
//
// So the combinations that actually appear on an element are collected from the
// markup and resolved as one control. Without this the check cannot see any
// multi-class bug, which is most of them.
function classCombinations() {
  const src = path.join(__dirname, 'src');
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name)) {
        const text = fs.readFileSync(p, 'utf8');
        for (const m of text.matchAll(/(?:class|className)\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
          const classes = (m[1] ?? m[2] ?? '')
            .split(/\s+/)
            .filter((c) => c && !c.includes("$") && !c.includes("{"));
          if (classes.length > 1 && classes.every((c) => BUTTONISH.test(`.${c}`))) {
            found.add(classes.slice().sort().join('.'));
          }
        }
      }
    }
  };
  walk(src);
  return [...found];
}

const combos = classCombinations();

/** Every rule part whose classes are all part of `combo`, in source order. */
function rulesForCombo(combo, state) {
  const set = new Set(combo.split('.'));
  const out = [];
  for (const r of rules) {
    for (const part of r.parts) {
      const { base, states } = parse(part);
      const classes = (base.match(/\.[a-z][a-z0-9_-]*/gi) || []).map((c) => c.slice(1));
      if (!classes.length || !classes.every((c) => set.has(c))) continue;
      if (state ? !states.includes(state) : states.length !== 0) continue;
      out.push(r);
      break;
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

for (const combo of combos) {
  const baseDecls = {};
  for (const r of rulesForCombo(combo, null)) Object.assign(baseDecls, declarations(r.body));

  for (const state of STATES) {
    const decls = { ...baseDecls };
    if (state) for (const r of rulesForCombo(combo, state)) Object.assign(decls, declarations(r.body));

    const fg = resolve(decls.color);
    const bg = resolve(decls['background-color']) || resolve(decls.background);
    if (!fg || !bg) continue;

    const ratio = contrast(fg, bg);
    if (ratio < 4.5) {
      problems.push(
        `.${combo}${state ? ':' + state : ''} — ${ratio.toFixed(2)}:1  ` +
        `text ${hex(fg)} on ${hex(bg)}  (two classes on one element)`
      );
    }
  }
}

// ── Does a delete button look like one ────────────────────────────────────────
// Contrast alone cannot see this. Black on white is perfectly legible, so a
// delete button that lost its red still passes every measurement above while
// reading as an ordinary button until it is pressed. What matters is that a
// destructive control is recognisable before it is used, so a button carrying
// btn-danger has to resolve to a red at rest.
const DANGER = ['--danger', '--danger-strong', '--danger-text'];
const dangerCombos = combos.filter((c) => c.split('.').includes('btn-danger'));

for (const combo of dangerCombos) {
  // The filled variant is white on red by design; only the outlined one is
  // expected to be red-on-white.
  if (combo.split('.').includes('btn-danger-solid')) continue;

  const baseDecls = {};
  for (const r of rulesForCombo(combo, null)) Object.assign(baseDecls, declarations(r.body));
  const label = baseDecls.color || '';
  const token = label.match(/var\(\s*(--[a-z0-9-]+)\s*\)/i)?.[1];
  const bare = label.trim();
  const ok =
    (token && DANGER.includes(token)) ||
    (DANGER.some((t) => (tokens[t] || '').toLowerCase() === bare.toLowerCase()));
  if (!ok) {
    semantic.push(
      `.${combo} is a delete button but its label is ` +
      `${token ? token : bare || '(unset)'}, not a red`
    );
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`Scanned ${rules.length} rules, ${groups.size} button selectors, ${combos.length} class combinations.`);
console.log(`Tokens resolved: ${Object.keys(tokens).length}\n`);

if (warnings.length) {
  console.log('Selectors defined more than once\n');
  warnings.forEach((w) => console.log(`  ! ${w}`));
  console.log('');
}

if (problems.length === 0) {
  console.log('OK   every button state in this file measures 4.5:1 or better.');
} else {
  console.log(`Found ${problems.length} state(s) below 4.5:1:\n`);
  problems.forEach((p) => console.log(`  X ${p}`));
}

if (semantic.length === 0) {
  console.log('OK   every delete button reads as destructive at rest.');
} else {
  console.log(`\nFound ${semantic.length} destructive-looking button(s) that do not read as one:\n`);
  semantic.forEach((p) => console.log(`  X ${p}`));
}

process.exit(problems.length + semantic.length ? 1 : 0);

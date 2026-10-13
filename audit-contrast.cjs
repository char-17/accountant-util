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
  const states = [...selector.matchAll(/:(hover|active|disabled|focus-visible|checked)/g)]
    .map((m) => m[1]);
  const base = selector.replace(/:(hover|active|disabled|focus-visible|checked)/g, '');
  return { base, states };
}

// Group by base selector, keeping source order: within one file the cascade is
// last-wins, and that is the mechanism this file got wrong.
const groups = new Map();
for (const r of rules) {
  // Only simple compounds. A descendant selector ("` `.foo .btn` `") inherits a
  // background from an ancestor this tool cannot see, so it is left alone
  // rather than measured against a colour it does not have.
  if (/\s/.test(r.selector)) continue;
  if (!BUTTONISH.test(r.selector)) continue;
  // ::before and friends draw the notch or the caret, not a label. Measuring
  // them would report a decorative triangle as unreadable text.
  if (/::/.test(r.selector)) continue;
  const { base, states } = parse(r.selector);
  if (!groups.has(base)) groups.set(base, { base, entries: [] });
  groups.get(base).entries.push({
    states,
    body: r.body,
    line: r.line,
    // Carried through, not re-derived: dropping it here made every rule look
    // top-level and flagged the responsive overrides as duplicates.
    inAtRule: r.inAtRule,
  });
}

const problems = [];
const warnings = [];

// :active is folded into :hover - in this file it resolves to the same pair, and
// reporting the same finding twice is noise.
const STATES = ['', 'hover', 'disabled'];

for (const { base, entries } of groups.values()) {
  const baseEntries = entries.filter((e) => e.states.length === 0);
  if (baseEntries.length > 1) {
    const topLevel = baseEntries.filter((e) => !e.inAtRule);
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

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`Scanned ${rules.length} rules, ${groups.size} button selectors.`);
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

process.exit(problems.length ? 1 : 0);

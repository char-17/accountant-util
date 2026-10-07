// Scans App.css for button-like classes that set a background but no colour.
// Without an explicit colour they inherit #666 from :root, which is the
// "I can't read what the button says" bug the user reported.

const css = require('fs').readFileSync('src/App.css', 'utf8');

// Split into rule blocks.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim().replace(/\s+/g, ' '),
  body: m[2].trim(),
}));

const BUTTONISH = /\.(btn|icon-btn|month-|close-btn|delete-btn|task-tag|type-toggle)/;
const problems = [];

for (const r of rules) {
  if (!BUTTONISH.test(r.selector)) continue;
  const hasBackground = /(^|\s)background(-color)?\s*:/.test(r.body);
  const hasColor = /(^|\s)color\s*:/.test(r.body);
  const hasBorder = /(^|\s)border\s*:/.test(r.body);
  // A rule that only sets padding/font is a modifier, not a full button style.
  const isModifier = r.selector.includes(':hover') || r.selector.includes(':active') ||
                     r.selector.includes(':focus') || r.selector.includes('.active');

  if (hasBackground && !hasColor && !isModifier) {
    problems.push(r.selector);
  }
}

console.log(`Scanned ${rules.length} CSS rules.\n`);
if (problems.length === 0) {
  console.log('OK   every button rule with a background sets its own colour.');
} else {
  console.log(`Found ${problems.length} rule(s) relying on inherited colour:`);
  problems.forEach((s) => console.log(`  - ${s}`));
  console.log('\nThese may render with the inherited #666 text colour.');
}

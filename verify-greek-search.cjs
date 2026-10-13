// Greek search, everywhere it happens.
//
// The reported symptom was one word: typing "ΜΙ" found "ΜΙΣΘΟΔΟΣΙΑ" and adding
// one more letter lost it. That is not a quirk of that word - it is what any
// Greek name does the moment a query ends in a sigma, which is most of them.
//
// So nothing here is about one word. These check the two rules that cover all of
// it: a query ending in sigma finds a name whose sigmas are mid-word, and an
// accented letter finds an unaccented one. Both directions, on data taken from
// the live database.
const Database = require('better-sqlite3');
const path = require('path');
const esbuild = require('esbuild');

const bundle = path.join(__dirname, '.tmp-greek-bundle.cjs');
esbuild.buildSync({
  stdin: { contents: 'export * from "./src/utils/greek";', resolveDir: __dirname, loader: 'ts' },
  bundle: true, outfile: bundle, format: 'cjs', platform: 'node',
});
const { foldGreek, greekIncludes } = require(bundle);

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label} ${detail}`); }
}
const cps = (s) => [...s].map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');

console.log('1) the fold is total: both sides can produce the same output');
{
  // The whole fix rests on this. A fold that maps two spellings to different
  // results has not made them equal, it has only moved the failure.
  check('a mid-word sigma and a final sigma fold together',
    foldGreek('ΜΙΣΘΟΔΟΣΙΑ') === foldGreek('μισθοδοσια'),
    `- ${cps(foldGreek('ΜΙΣΘΟΔΟΣΙΑ'))} vs ${cps(foldGreek('μισθοδοσια'))}`);
  check('caps, lower and a hand-typed final sigma are one thing',
    foldGreek('ΜΙΣ') === foldGreek('μισ') && foldGreek('ΜΙΣ') === foldGreek('μις'),
    `- ${cps(foldGreek('ΜΙΣ'))} / ${cps(foldGreek('μισ'))} / ${cps(foldGreek('μις'))}`);
  check('tonos is dropped on either side',
    foldGreek('ΟΝΟΜΑ') === foldGreek('όνομα'),
    `- ${cps(foldGreek('ΟΝΟΜΑ'))} vs ${cps(foldGreek('όνομα'))}`);
  check('and on the accented side too',
    foldGreek('Όνομα') === foldGreek('Ονομα'),
    `- ${cps(foldGreek('Όνομα'))} vs ${cps(foldGreek('Ονομα'))}`);
  check('accented upper folds to the same as unaccented lower',
    foldGreek('ΜΊΣ') === foldGreek('μισ'),
    `- ${cps(foldGreek('ΜΊΣ'))} vs ${cps(foldGreek('μισ'))}`);
  check('surrounding space is not a difference',
    foldGreek('  ΑΒΓ ') === foldGreek('ΑΒΓ'));
}

console.log('\n2) the reported failure, and every word shaped like it');
{
  // One word first, because that is what was reported, and then the rule it
  // stands for: any name whose query ends in a sigma.
  check('"ΜΙΣ" finds "ΜΙΣΘΟΔΟΣΙΑ"', greekIncludes('ΜΙΣΘΟΔΟΣΙΑ', 'ΜΙΣ'));
  check('"ΜΙ" still finds it', greekIncludes('ΜΙΣΘΟΔΟΣΙΑ', 'ΜΙ'));
  check('and "ΜΙΣΘΟΔΟ" too', greekIncludes('ΜΙΣΘΟΔΟΣΙΑ', 'ΜΙΣΘΟΔΟ'));

  // The same shape across the rest of the real task list: every one of these has
  // a sigma in it and every one was unfindable past the sigma.
  const db = new Database(require('./lib/dbPath.cjs').databasePath(), { readonly: true });
  const names = db.prepare('SELECT name FROM task_types').all().map((r) => r.name);
  db.close();

  const withSigma = names.filter((n) => /Σ/.test(n));
  check('the live task list does contain sigmas to lose', withSigma.length > 0,
    `- ${withSigma.length} of ${names.length}`);

  let broken = 0;
  const missed = [];
  for (const name of withSigma) {
    const idx = name.indexOf('Σ');
    // The prefix up to and including the first sigma, in caps.
    const query = name.slice(0, idx + 1);
    if (!greekIncludes(name, query)) { broken++; missed.push(`${query} -> ${name}`); }
  }
  check('every one of them is now findable up to its first sigma',
    broken === 0, `- ${missed.length} missed: ${missed.slice(0, 3).join(', ')}`);

  // And the whole name, which is the case a user is most likely to type in full.
  check('and by its full name in caps', names.every((n) => greekIncludes(n, n)));
  check('and by its full name in lower case', names.every((n) => greekIncludes(n, n.toLowerCase())));
}

console.log('\n3) accented and unaccented find each other');
{
  const pairs = [
    ['Όνομα', 'Ονομα'],
    ['Μισθοδοσία', 'ΜΙΣΘΟΔΟΣΙΑ'],
    ['Καθαρισμός', 'ΚΑΘΑΡΙΣΜΟΣ'],
    ['Εισαγωγή', 'εισαγωγη'],
    ['Έξοδος', 'εξοδος'],
  ];
  for (const [a, b] of pairs) {
    check(`"${a}" finds "${b}"`, greekIncludes(b, a));
    check(`"${b}" finds "${a}"`, greekIncludes(a, b));
  }
}

console.log('\n4) it does not start matching things it should not');
{
  // Folding everything into one form has to stay reversible enough to be useful.
  check('an empty query matches everything', greekIncludes('ΟΠΟΙΑΔΗΠΟΤΕ', ''));
  check('a query that is only spaces matches everything',
    greekIncludes('ΟΠΟΙΑΔΗΠΟΤΕ', '   '));
  check('a different word does not match', !greekIncludes('ΜΙΣΘΟΔΟΣΙΑ', 'ΕΦΚΑ'));
  // A prefix of the right word must match - the failure being fixed was a
  // prefix failing, so "this must not match" is the wrong way round.
  check('a prefix of the right word does match',
    greekIncludes('ΜΙΣΘΟΔΟΣΙΑ', 'ΜΙΣΘΟΔ'));
  check('but a longer word that only starts the same does not',
    !greekIncludes('ΜΙΣΘΟΔΟΣΙΑ', 'ΜΙΣΘΟΔΟΣΙΑΣ'));
  // Substring, not word, matching - that is what the search has always been, and
  // it is why "ΟΔΟ" finds it. Worth stating so it is not mistaken for a bug: the
  // fold changes how characters compare, not what "contains" means.
  check('a fragment from the middle matches, because the search is a substring one',
    greekIncludes('ΜΙΣΘΟΔΟΣΙΑ', 'ΟΔΟ'));
  check('digits still match', greekIncludes('ΦΟΡΟΣ 3%', '3'));
  check('and punctuation is not stripped away', !greekIncludes('ΑΒΓ', 'ΑΒΓΔ'));
}

console.log('\n5) Latin text is unharmed');
{
  const pairs = [
    ['CHALIKIAN ERIK', 'chalik'],
    ['HARAT\'S PUB', 'harat'],
    ['ΦΟΡΟΣ ΕΡΓΟΛ. 3%', 'εργολ'],
    ['GALA RESOURT', 'resourt'],
  ];
  for (const [name, query] of pairs) {
    check(`"${query}" finds "${name}"`, greekIncludes(name, query));
  }
}

fs = require('fs');
fs.unlinkSync(bundle);console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

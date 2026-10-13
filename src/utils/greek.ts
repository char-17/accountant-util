/**
 * Greek text folding for searching.
 *
 * Searching a Greek list is not the same as searching an English one, and the
 * two things that go wrong are both invisible until someone types.
 *
 * The final sigma. "ΜΙΣΘΟΔΟΣΙΑ" contains two sigmas, both in the middle of the
 * word, so both are σ. But toLocaleLowerCase('el-GR') knows Greek and rewrites
 * a sigma that ends a word into ς - so the query "ΜΙΣ" folds to "μις" and the
 * stored name folds to "μισθοδοσια". The ς and the σ are different characters
 * and never match. Typing "ΜΙ" finds the row and adding one more letter loses
 * it, which reads as the search breaking halfway through a word.
 *
 * The tonos. "Όνομα" and "Ονομα" are the same word to a person, and a keyboard
 * makes both easy to type, so accented and unaccented have to find each other.
 *
 * Both sides of a comparison are folded the same way, so what matters is only
 * that folding is total: it must not turn one spelling into something the other
 * side cannot produce.
 */
export function foldGreek(value: string): string {
  return (
    value
      .trim()
      // Plain toLowerCase, never the locale-aware one: the only thing the
      // locale-aware version adds here is the final-sigma rewrite above.
      .toLowerCase()
      // Decomposed, so ό ά ΜΊ are a base letter plus a combining mark, then the
      // marks go and the base letter is left.
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      // A final sigma typed or pasted in by hand is still the same letter.
      .replace(/ς/g, "σ")
  );
}

/** True when `haystack` contains `needle`, ignoring case, tonos and sigma form. */
export function greekIncludes(haystack: string, needle: string): boolean {
  const term = foldGreek(needle);
  // An empty box means "everything", not "nothing". Filtering an empty term out
  // would empty the list the moment the search field is cleared.
  if (term === "") return true;
  return foldGreek(haystack).includes(term);
}

/**
 * SQLite/Tauri errors arrive as plain strings, sometimes wrapped by the plugin.
 * Translate the common cases into something an accountant can act on.
 */

/**
 * The messages thrown by the pre-insert name checks.
 *
 * Those checks compare names through foldGreek, so they can reject something
 * that does not look like a duplicate at a glance. Each message therefore says
 * which differences were ignored - otherwise "Μισθοδοσία" against
 * "ΜΙΣΘΟΔΟΣΙΑ" reads as the application making a mistake.
 *
 * Kept here rather than in the hooks so the wording lives next to the
 * constraint-failure text below, which describes the same thing from the other
 * side: the UNIQUE index is the backstop when the check and the insert race.
 */
export const DUPLICATE_CLIENT =
  "Υπάρχει ήδη πελάτης με αυτό το όνομα. Τα κεφαλαία, οι τόνοι και το τελικό ς δεν λογίζονται.";
export const DUPLICATE_TASK =
  "Υπάρχει ήδη εργασία με αυτό το όνομα. Τα κεφαλαία, οι τόνοι και το τελικό ς δεν λογίζονται.";
export const DUPLICATE_PROFESSION =
  "Υπάρχει ήδη επάγγελμα με αυτό το όνομα. Τα κεφαλαία, οι τόνοι και το τελικό ς δεν λογίζονται.";

export function toMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // A folded name was already rejected before the insert in the normal case, so
  // reaching these means the index caught what the check did not - a race, or a
  // caller that skipped the hook. Same wording, so the accountant does not have
  // to learn two messages for one rule.
  if (raw.includes("UNIQUE constraint failed: task_types.name")) {
    return DUPLICATE_TASK;
  }
  if (raw.includes("UNIQUE constraint failed: clients.name")) {
    return DUPLICATE_CLIENT;
  }
  if (raw.includes("UNIQUE constraint failed: professions.name")) {
    return DUPLICATE_PROFESSION;
  }
  if (raw.includes("UNIQUE constraint failed")) {
    return "Αυτή η εγγραφή υπάρχει ήδη.";
  }
  if (raw.includes("NOT NULL constraint failed")) {
    return "Λείπει ένα υποχρεωτικό πεδίο.";
  }
  if (raw.includes("FOREIGN KEY constraint failed")) {
    return "Η εγγραφή συνδέεται με στοιχείο που δεν υπάρχει.";
  }
  if (raw.includes("no such table")) {
    return "Η βάση δεδομένων δεν είναι έτοιμη. Κλείστε και ανοίξτε την εφαρμογή.";
  }

  return raw;
}

/**
 * SQLite/Tauri errors arrive as plain strings, sometimes wrapped by the plugin.
 * Translate the common cases into something an accountant can act on.
 */
export function toMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (raw.includes("UNIQUE constraint failed: task_types.name")) {
    return "Υπάρχει ήδη εργασία με αυτό το όνομα.";
  }
  if (raw.includes("UNIQUE constraint failed: clients.name")) {
    return "Υπάρχει ήδη πελάτης με αυτό το όνομα.";
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

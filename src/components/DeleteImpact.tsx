interface DeleteImpactProps {
  /** Clients currently attached to the record being deleted. */
  clients: number;
  /**
   * Recorded work carrying this record's name, when it can have any. A task has
   * months of history behind it; a profession does not, so the catalogue leaves
   * this out rather than printing a zero the user would read as "history wiped".
   */
  history?: number;
}

/** "1 πελάτης" / "3 πελάτες" - Greek counts need the singular handled. */
function clients(count: number): string {
  return `${count} ${count === 1 ? "πελάτης" : "πελάτες"}`;
}

/** "1 μηνιαία κατάσταση" / "12 μηνιαίες καταστάσεις". */
function months(count: number): string {
  return count === 1 ? "1 μηνιαία κατάσταση" : `${count} μηνιαίες καταστάσεις`;
}

/**
 * What deleting this record would take with it.
 *
 * A confirmation that only says "delete?" makes the user guess. This names what
 * is attached, because the answer is not always the same: a task may have no
 * clients left and still two years of monthly history under its name, and those
 * two facts call for different decisions.
 *
 * When nothing is attached it says so in one line rather than showing a table of
 * zeroes - there is nothing to weigh up.
 *
 * Kept out of the two catalogues because they are different things to a user but
 * the same question, and two hand-written versions would drift apart in exactly
 * the places nobody reads twice.
 */
export function DeleteImpact({ clients: clientCount, history }: DeleteImpactProps) {
  const historyCount = history ?? 0;
  const nothing = clientCount === 0 && historyCount === 0;

  return (
    <div className="modal-warning">
      {nothing ? (
        "Δεν χρησιμοποιείται από κανέναν πελάτη. Η διαγραφή δεν επηρεάζει τίποτα άλλο."
      ) : (
        <>
          {clientCount > 0 && (
            <span>
              Θα αποσυνδεθεί από <strong>{clients(clientCount)}</strong>, οι οποίοι θα
              εμφανίζονται χωρίς αυτό.
            </span>
          )}
          {historyCount > 0 && (
            <span>
              Θα χαθούν <strong>{months(historyCount)}</strong> που το κατατάθηκαν σε
              αυτό, μαζί με το ιστορικό τους.
            </span>
          )}
        </>
      )}
    </div>
  );
}

import { useDialogA11y } from "../hooks/useDialogA11y";
import { APP_NAME, APP_VERSION } from "../appInfo";
import type { BackupArea } from "../persistence/backupArea";

interface AboutDialogProps {
  lastUpdateAt: string | null;
  backupArea: BackupArea | null;
  onClose: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return "Δεν έχει καταγραφεί ακόμα";
  return new Date(value).toLocaleString("el-GR", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

export function AboutDialog({ lastUpdateAt, backupArea, onClose }: AboutDialogProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-backdrop" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal about-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
      >
        <h3 id="about-dialog-title">Πληροφορίες εφαρμογής</h3>
        <p className="about-intro">
          Τεχνικές και λειτουργικές πληροφορίες για την εγκατάσταση, την ενημέρωση και
          την προστασία των δεδομένων σας.
        </p>

        <dl className="about-details">
          <div className="about-detail-row">
            <dt>Εφαρμογή</dt>
            <dd>{APP_NAME}</dd>
          </div>
          <div className="about-detail-row">
            <dt>Έκδοση</dt>
            <dd>{APP_VERSION} — σταθερή έκδοση</dd>
          </div>
          <div className="about-detail-row">
            <dt>Τελευταία αναβάθμιση</dt>
            <dd>{formatDate(lastUpdateAt)}</dd>
          </div>
          <div className="about-detail-row">
            <dt>Έλεγχος ενημερώσεων</dt>
            <dd>
              Ο έλεγχος εκτελείται αυτόματα κατά την εκκίνηση και μπορεί να εκτελεστεί
              χειροκίνητα από το Αρχείο → Έλεγχος ενημερώσεων.
            </dd>
          </div>
          <div className="about-detail-row">
            <dt>Βάση δεδομένων</dt>
            <dd>
              <strong>accountant.db</strong>
              <span className="about-detail-note">
                {backupArea?.databasePath ?? "Στη διαδρομή δεδομένων της εγκατάστασης"}
              </span>
            </dd>
          </div>
          <div className="about-detail-row">
            <dt>Αντίγραφα ασφαλείας</dt>
            <dd>
              <strong>Αυτόματα</strong> καθημερινά στις 15:00, με διατήρηση του πιο
              πρόσφατου αρχείου.
              <span className="about-detail-note">
                {backupArea?.autoFinal ?? "[φάκελος εγκατάστασης]\\backups\\auto\\backup.db"}
              </span>
              <strong>Χειροκίνητα</strong> από το Αρχείο, με ξεχωριστό αρχείο για κάθε
              αντίγραφο.
              <span className="about-detail-note">
                {backupArea?.manualDir ?? "[φάκελος εγκατάστασης]\\backups\\manual\\"}
              </span>
            </dd>
          </div>
          <div className="about-detail-row">
            <dt>Ασφάλεια ενημέρωσης</dt>
            <dd>
              Πριν από κάθε αναβάθμιση δημιουργείται αυτόματο αντίγραφο της βάσης.
              Αν η ενημέρωση αποτύχει, το προηγούμενο αντίγραφο παραμένει διαθέσιμο
              για επαναφορά.
            </dd>
          </div>
        </dl>

        <div className="form-actions">
          <button className="btn-primary" onClick={onClose}>Κλείσιμο</button>
        </div>
      </div>
    </div>
  );
}

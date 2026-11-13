import { useDialogA11y } from "../hooks/useDialogA11y";
import { APP_NAME, APP_VERSION } from "../appInfo";

interface AboutDialogProps {
  lastUpdateAt: string | null;
  onClose: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return "Δεν έχει καταγραφεί ακόμα";
  return new Date(value).toLocaleString("el-GR", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

export function AboutDialog({ lastUpdateAt, onClose }: AboutDialogProps) {
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
        <p className="about-intro">Χρήσιμες πληροφορίες για την εγκατάσταση και τα δεδομένα σας.</p>

        <dl className="about-details">
          <div className="about-detail-row">
            <dt>Εφαρμογή</dt>
            <dd>{APP_NAME}</dd>
          </div>
          <div className="about-detail-row">
            <dt>Έκδοση</dt>
            <dd>{APP_VERSION}</dd>
          </div>
          <div className="about-detail-row">
            <dt>Τελευταία αναβάθμιση</dt>
            <dd>{formatDate(lastUpdateAt)}</dd>
          </div>
          <div className="about-detail-row">
            <dt>Έλεγχος ενημερώσεων</dt>
            <dd>Αυτόματα κατά την εκκίνηση και χειροκίνητα από το Αρχείο</dd>
          </div>
          <div className="about-detail-row">
            <dt>Βάση δεδομένων</dt>
            <dd>accountant.db</dd>
          </div>
          <div className="about-detail-row">
            <dt>Αντίγραφα ασφαλείας</dt>
            <dd>Αυτόματο καθημερινά στις 15:00 και χειροκίνητα από το Αρχείο</dd>
          </div>
          <div className="about-detail-row">
            <dt>Ασφάλεια ενημέρωσης</dt>
            <dd>Δημιουργείται αντίγραφο πριν από κάθε αναβάθμιση</dd>
          </div>
        </dl>

        <div className="form-actions">
          <button className="btn-primary" onClick={onClose}>Κλείσιμο</button>
        </div>
      </div>
    </div>
  );
}

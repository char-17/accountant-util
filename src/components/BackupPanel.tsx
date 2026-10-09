interface BackupPanelProps {
  onBackup: () => void;
  onRestore: () => void;
  busy: "backup" | "restore" | null;
}

/**
 * Backup and restore. Restore is styled as the risky action because it
 * replaces the current data; backup is the routine one.
 */
export function BackupPanel({ onBackup, onRestore, busy }: BackupPanelProps) {
  const disabled = busy !== null;

  return (
    <div className="backup-panel">
      <h3>Αντίγραφο ασφαλείας</h3>
      <p className="backup-hint">
        Το αντίγραφο περιέχει όλους τους πελάτες, τις εργασίες και το ιστορικό
        ολοκληρώσεων. Μπορείτε να το κρατήσετε σε ασφαλές μέρος.
      </p>
      <div className="backup-actions">
        <button
          className="btn-small"
          onClick={onBackup}
          disabled={disabled}
          title="Το αντίγραφο περιέχει όλους τους πελάτες, τις εργασίες και το ιστορικό ολοκληρώσεων. Μπορείτε να το κρατήσετε σε ασφαλές μέρος."
        >
          {busy === "backup" ? "Δημιουργία..." : "Δημιουργία αντιγράφου"}
        </button>
        <button
          className="btn-small btn-warning"
          onClick={onRestore}
          disabled={disabled}
          title="Αντικαθιστά τα τωρινά δεδομένα με αυτά του αντιγράφου"
        >
          {busy === "restore" ? "Επαναφορά..." : "Επαναφορά από αντίγραφο"}
        </button>
      </div>
    </div>
  );
}
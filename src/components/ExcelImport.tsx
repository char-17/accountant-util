import type { ImportError } from "../domain/types";
import { useExcelImport } from "../hooks/useExcelImport";

interface ExcelImportProps {
  db: import("@tauri-apps/plugin-sql").default;
  onImportComplete: () => void;
}

export function ExcelImport({ db, onImportComplete }: ExcelImportProps) {
  const { preview, result, loading, error, loadFile, runImport, clear } =
    useExcelImport(db, onImportComplete);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
  };

  return (
    <div className="excel-import">
      <h2>Εισαγωγή Excel</h2>

      <div className="import-instructions">
        <p>Μορφή αρχείου:</p>
        <ul>
          <li><strong>Πελάτες:</strong> Όνομα | Email | Τηλέφωνο | Διεύθυνση | ΑΦΜ | Σημειώσεις</li>
          <li><strong>Εργασίες:</strong> Μόνο όνομα (μία στήλη)</li>
        </ul>
      </div>

      <div className="file-input">
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          disabled={loading}
          aria-label="Επιλογή αρχείου Excel"
        />
      </div>

      {loading && <div className="loading">Επεξεργασία...</div>}
      {error && <div className="error-message" role="alert">{error}</div>}

      {preview && !result && (
        <div className="import-preview">
          <h3>Προεπισκόπηση</h3>
          <div className="preview-stats">
            <span>Πελάτες: {preview.clients.length}</span>
            <span>Εργασίες: {preview.tasks.length}</span>
          </div>

          {preview.clients.length > 0 && (
            <div className="preview-section">
              <h4>Πελάτες</h4>
              <table>
                <thead>
                  <tr>
                    <th>Όνομα</th>
                    <th>Email</th>
                    <th>Τηλέφωνο</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.clients.slice(0, 10).map((c, i) => (
                    <tr key={i}>
                      <td>{c.name}</td>
                      <td>{c.email}</td>
                      <td>{c.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.clients.length > 10 && (
                <p>...και άλλοι {preview.clients.length - 10}</p>
              )}
            </div>
          )}

          {preview.tasks.length > 0 && (
            <div className="preview-section">
              <h4>Εργασίες</h4>
              <div className="task-tags">
                {preview.tasks.map((t, i) => (
                  <span key={i} className="task-tag">{t.name}</span>
                ))}
              </div>
            </div>
          )}

          {preview.errors.length > 0 && <ImportErrors errors={preview.errors} />}

          <div className="form-actions">
            <button className="btn-primary" onClick={() => void runImport()} disabled={loading}>
              Εισαγωγή
            </button>
            <button className="btn-secondary" onClick={clear}>
              Άκυρο
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="import-result">
          <h3>Αποτέλεσμα Εισαγωγής</h3>
          <div className="result-stats">
            <div className="stat success">
              <span className="stat-value">{result.clientsImported}</span>
              <span className="stat-label">Πελάτες</span>
            </div>
            <div className="stat success">
              <span className="stat-value">{result.tasksImported}</span>
              <span className="stat-label">Εργασίες</span>
            </div>
            <div className="stat warning">
              <span className="stat-value">{result.duplicatesSkipped}</span>
              <span className="stat-label">Διπλότυπα</span>
            </div>
          </div>
          <button className="btn-primary" onClick={clear}>
            Νέα Εισαγωγή
          </button>
        </div>
      )}
    </div>
  );
}

function ImportErrors({ errors }: { errors: ImportError[] }) {
  return (
    <div className="preview-section">
      <h4>Προειδοποιήσεις</h4>
      <ul className="error-message">
        {errors.map((e, i) => (
          <li key={i}>Γραμμή {e.row}: {e.message}</li>
        ))}
      </ul>
    </div>
  );
}
# Architecture Decision Record — Accountant Util

## ADR-001: Επιλογή Tauri ως Desktop Framework

**Ημερομηνία:** 2026-10-06  
**Κατάσταση:** Αποδεκτό

### Συμφραζόμενα
Απαιτείται cross-platform desktop εφαρμογή (Windows, macOS, Linux) με τοπική αποθήκευση δεδομένων και δυνατότητα σύνδεσης στο internet.

### Απόφαση
Χρήση **Tauri v2** με React/TypeScript frontend και Rust backend.

### Αιτιολόγηση
- **Μέγεθος:** ~3-10 MB binary (έναντι ~150+ MB για Electron)
- **Απόδοση:** Χρήση native WebView αντί για bundled Chromium
- **Ασφάλεια:** Rust backend με memory safety
- **Ευελιξία:** Frontend σε HTML/CSS/JS με οποιοδήποτε framework

### Εναλλακτικές που εξετάστηκαν
| Εναλλακτική | Μειονέκτημα |
|-------------|-------------|
| Electron | Βαρύ binary, υψηλή μνήμη |
| Flutter Desktop | Μεγαλύτερο binary, Dart ecosystem |
| .NET MAUI | Windows-centric, .NET dependency |
| Qt (PySide6) | Python performance limitations |

---

## ADR-002: Αρχιτεκτονική Modular Layers

**Ημερομηνία:** 2026-10-06  
**Κατάσταση:** Αποδεκτό

### Συμφραζόμενα
Απαιτείται modular αρχιτεκτονική που να επιτρέπει προσθήκη νέων λειτουργιών χωρίς μεγάλες αλυσιδωτές αλλαγές.

### Απόφαση
Τρεις επίπεδα με καθαρά όρια:

```
┌─────────────────────────────────────┐
│           UI Layer (React)          │
│  Components, Hooks, State Management │
├─────────────────────────────────────┤
│         Domain Layer (TS)           │
│  Types, Validation, Business Rules   │
├─────────────────────────────────────┤
│      Persistence Layer (Rust)       │
│  SQLite Repositories, Tauri IPC      │
└─────────────────────────────────────┘
```

### Αιτιολόγηση
- **UI Layer:** React components με custom hooks για state management
- **Domain Layer:** Pure TypeScript types και validation functions
- **Persistence Layer:** Tauri SQL plugin με SQLite backend

### Κανόνες
- Το UI δεν καλεί απευθείας τη βάση — μόνο μέσω hooks
- Το Domain layer δεν εξαρτάται από UI ή persistence
- Νέα λειτουργία = νέο module στο αντίστοιχο layer

### Επιβολή των ορίων (2026-10-07)

Οι κανόνες είναι **ελέγχονται**, όχι μόνο γραμμένοι:

- `audit-style.cjs` αποτυπώνει τα όρια — ένα `import` από `persistence` μέσα σε
  component αποτυγχάνει. Τα type-only imports εξαιρούνται, γιατί δεν δημιουργούν
  coupling στο runtime.
- `eslint.config.js` επιβάλλει τις συμβάσεις που ήδη ακολουθούσε ο κώδικας.
- `npm run verify` τρέχει και τα δύο μαζί με τα tests.

Οποιοδήποτε `import` από `domain/` προς άλλο φάκελο αποτυγχάνει, ώστε οι
κανόνες του domain να παραμένουν καθαροί.

---

## ADR-003: Αποθήκευση Δεδομένων

**Ημερομηνία:** 2026-10-06  
**Κατάσταση:** Αποδεκτό

### Συμφραζόμενα
Απαιτείται τοπική αποθήκευση με δυνατότητα backup/restore.

### Απόφαση
**SQLite** μέσω Tauri SQL plugin.

### Αιτιολόγηση
- Τοπική αποθήκευση χωρίς server
- SQL queries με type safety
- Migrations για schema evolution
- Backup = αντιγραφή αρχείου .db

### Schema
- `clients` — Στοιχεία πελατών
- `task_types` — Κατάλογος εργασιών με χρώματα
- `client_task_assignments` — Σχέσεις πελάτη-εργασίας
- `monthly_task_status` — Μηνιαία κατάσταση εργασιών
- `task_reminders` — Ημερομηνία υπενθύμισης ανά ανάθεση και περίοδο

### Backup (ADR-003, αναθεώρηση 2026-10-07)

Η βάση τρέχει σε **WAL mode**: τα δεδομένα μοιράζονται σε `accountant.db`,
`accountant.db-wal` και `accountant.db-shm`. Η αντιγραφή του αρχείου ενώ τρέχει η
εφαρμογή **χάνει δεδομένα**.

**Απόφαση:** το backup γίνεται με `VACUUM INTO`, που γράφει ένα αυτοτελές,
συνεπές αρχείο μέσω της ίδιας SQLite, χωρίς να κλείσει η εφαρμογή. Η επαναφορά
γίνεται με `ATTACH` και αντιγραφή πινάκων, ώστε ο schema και τα migrations να
μένουν ανέπαφα. Οι πίνακες αντιγράφονται σε σειρά που τηρεί τα foreign keys, και
μεταφέρεται και το `sqlite_sequence` ώστε τα ν��α ids να μη συγκρούονται.

Το backend κάνει την εγγραφή/ανάγνωση αρχείων μέσω Rust και των plugins
`dialog`/`fs`, με τα permissions περιορισμένα στο σύνολο.

---

## ADR-004: Εισαγωγή Excel

**Ημερομηνία:** 2026-10-06  
**Κατάσταση:** Αποδεκτό

### Συμφραζόμενα
Απαιτείται εισαγωγή δεδομένων από Excel αρχεία με preview και validation.

### Απόφαση
**SheetJS (xlsx)** για parsing Excel στο frontend.

### Αιτιολόγηση
- Δημοφιλές, well-maintained library
- Client-side parsing χωρίς server dependency
- Υποστήριξη .xlsx και .xls
- Preview πριν την εισαγωγή

### Ροή
1. Επιλογή αρχείου
2. Parsing και validation
3. Preview με counts και διπλότυπα
4. Επιβεβαίωση και εισαγωγή
5. Αναφορά αποτελεσμάτων

### Έκδοση: pinned tarball από το CDN της SheetJS (2026-10-07)

Η έκδοση **δεν** είναι από το npm registry. Οι δύο ευπαθειότητες του `xlsx` 0.18.5
(η τελευταία στο npm) είναι:

| Advisory | Τύπος | CVSS | Διορθώθηκε σε |
|---|---|---|---|
| GHSA-4r6h-8v6p-xvw6 | Prototype pollution (CWE-1321) | 7.8 | 0.19.3 |
| GHSA-5pgg-2g8v-p4x9 | ReDoS (CWE-1333) | 7.5 | 0.20.2 |

Το prototype pollution δεν είναι θεωρητικό εδώ: τα bytes του workbook οδηγούν
απευθείως στο `XLSX.read`, άρα ένα αρχείο Excel που επιλέγει ο χρήστης είναι η
πραγματική διαδρομή. Το `npm audit` αναφέρει `fixAvailable: false` επειδή
**δεν** κοιτάζει CDN· η διόρθωση υπάρχει, στο `cdn.sheetjs.com`.

**Απόφαση:** το `xlsx` δηλώνεται ως συγκεκριμένο tarball URL, όχι σε semver range
(`"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`). Ένα range
`^0.18.5` θα έλυνε πίσω στην ευάλωτη έκδοση χωρίς προειδοποίηση.

Το `verify-xlsx-version.cjs` φυλάει το pin: απαιτεί ακριβή URL χωρίς `latest`,
ελέγχει την εγκατεστημένη έκδοση, επιβεβαιώνει ότι το `package-lock.json`
συμφωνεί (με `integrity` hash) ώστε ένα `npm ci` να μη διαφωνεί με αυτό που
δοκιμάστηκε, και ελέγχει ότι υπάρχουν ακόλη `XLSX.read`, `XLSX.readFile`,
`XLSX.utils.sheet_to_json`.

**Επακόλουθο:** το CDN δεν είναι version-controlled registry. Κάθε αλλαγή
έκδοσης είναι πράξη (bump του URL), όχι απλή εκτέλεση `npm audit fix`.

---

## ADR-005: Ασφάλεια

**Ημερομηνία:** 2026-10-06  
**Κατάσταση:** Αποδεκτό

### Συμφραζόμενα
Ευαίσθητα δεδομένα πελατών (ΑΦΜ, email, τηλέφωνα).

### Αποφάσεις
1. **Tauri Capabilities** — Περιορισμός permissions ανά plugin
2. **Input Validation** — Validation σε όλα τα form fields
3. **SQL Injection Prevention** — Parameterized queries μέσω Tauri SQL plugin
4. **No Sensitive Data in Logs** — Καμία εγγραφή ευαίσθητων δεδομένων σε console/logs

---

## ADR-006: Διανομή

**Ημερομηνία:** 2026-10-06  
**Κατάσταση:** Αποδεκτό

### Συμφραζόμενα
Απαιτείται διανομή σε Windows, macOS, Linux.

### Απόφαση
**Tauri Build System** με platform-specific installers.

### Επιλογές
- **Windows:** MSI installer
- **macOS:** DMG
- **Linux:** AppImage / deb

### Build Command
```bash
npm run tauri build
```

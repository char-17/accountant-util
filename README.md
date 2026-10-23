# Accountant Util

Εφαρμογή επιφάνειας για τη μηνιαία παρακολούθηση εργασιών λογιστή. Desktop,
τοπικά δεδομένα, χωρίς διαδίκτυο.

Το σχήμα της βάσης και τι αποθηκεύεται σε κάθε πίνακα: **[DATABASE.md](DATABASE.md)**.

## Τι κάνει

- **Dashboard μήνα**: λίστα πελατών αριστερά, ειδοποιήσεις / σύνοψη / λίστα εργασιών δεξιά.
- **Εργασίες μήνα**: tick για ολοκλήρωση, με επιβεβαίωση και προς τις δύο κατευθύνσεις.
- **Φίλτρα**: ανά πελάτη / εργασία / κατάσταση. Επιλογή πελάτη στη λίστα περιορίζει
  τη λίστα εργασιών.
- **Κατάλογος εργασιών**: όνομα, περιγραφή, ενεργή/ανενεργή, χρώμα από ήπια παλέτα.
- **Περιοδικότητα**: μηνιαία / τριμηνιαία / ετήσια, με ημέρα λήξης και ημέρες ειδοποίησης.
- **Εξαγωγή**: CSV μέσω διαλόγου αποθήκευσης, εκτύπωση / PDF.
- **Backup & Restore**: ασφαλές αντίγραφο μέσω `VACUUM INTO`, επαναφορά με επιβεβαίωση.
- **Εισαγωγή Excel** με προεπισκόπηση πριν την εγγραφή.

## Προαπαιτήσεις

| Εργαλείο | Έκδοση |
|---|---|
| Node.js | 22+ |
| Rust | 1.99+ (`rustup`) |
| Visual Studio Build Tools | με το workload «Desktop development with C++» (για το Rust backend σε Windows) |

## Εκτέλεση

```powershell
# Το Path πρέπει να περιλαμβάνει Node και cargo, αν δεν είναι ήδη.
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path","User")

Set-Location "C:\Users\Ariston\OpenCodeProjects\Accountant Util"

npm install
npm run tauri dev        # development
npm run tauri build      # release + MSI + NSIS
```

Μετά το build:

```
src-tauri\target\release\bundle\msi\Accountant Util_0.1.0_x64_en-US.msi
src-tauri\target\release\bundle\nsis\Accountant Util_0.1.0_x64-setup.exe
```

## Έλεγχος ποιότητας

```powershell
npm run verify     # types, lint, όλα τα audits και τα tests
npm run typecheck
npm run audit      # όρια modules, προσβασιμότητα, συμβάσεις
```

`npm run verify` τρέχει 28 ελέγχους: `tsc`, ESLint, 4 audits και 22 scripts
συμπεριφοράς.

### Τι ελέγχουν τα tests

| Script | Καλύπτει |
|---|---|
| `verify-recurrence.mjs` | Περιοδικότητα, λήξεις, clamping μηνών |
| `verify-seed.cjs` | Seed ανά μήνα, σεβασμός περιοδικότητας, idempotency |
| `verify-seed-period.cjs` | Δεν γεμίζει μήνες πριν την έναρξη ανάθεσης (regression) |
| `verify-profession-seed.cjs` | Προεπιλεγμένα επαγγέλματα, μετρήσεις χρήσης |
| `verify-greek-search.cjs` | Αναζήτηση ελληνικών: κεφαλαία, τόνοι, τελικό ς |
| `verify-name-uniqueness.cjs` | Μοναδικότητα ονόματος με fold — πελάτες, εργασίες, επαγγέλματα |
| `verify-duplicates.cjs` | Διπλά ids/labels/keys σε ολόκληρη την οθόνη |
| `verify-worklist-filters.cjs` | Φίλτρα πελάτη/εργασίας/κατάστασης, σύνοψη |
| `verify-export-report.cjs` | CSV escaping, Excel formula injection, δομή αναφοράς |
| `verify-backup-restore.cjs` | `VACUUM INTO`, αποκατάσταση, ακεραιότητα WAL |
| `verify-ui-render.cjs` | Πραγματικό markup των components |
| `verify-ui-interaction.cjs` | Κλικ/πληκτρολόγηση σε jsdom: modal επιβεβαίωσης, φίλτρα, φόρμες |
| `verify-periodicity.cjs` | Migrations, defaults, validation |
| `verify-fix.cjs` | camelCase mapping, booleans |
| `verify-startdate-fix.cjs` | Regression του bug έναρξης ανάθεσης |
| `verify-client-crud.cjs` | CRUD πελατών + cascade |
| `verify-mutations.cjs` | Κάθε write path |
| `verify-e2e-assignment.cjs` | Ανάθεση → εμφανίζεται στη λίστα μήνα |
| `verify-confirm-toggle.cjs` | Επιβεβαίωση πριν/μετά την αλλαγή |
| `verify-money.cjs` | Ποσά, στρογγυλοποίηση σε λεπτά |
| `verify-report.cjs` | Αναφορά ανά πελάτη και περίοδο |
| `verify-payment.cjs` | Είσπραξη, τιμολόγηση, κατάσταση πληρωμής |
| `audit-refresh.cjs` | Κάλυψη refreshers μετά κάθε μεταβολή |
| `audit-contrast.cjs` | Κουμπιά με background αλλά χωρίς `color` |
| `audit-style.cjs` | Όρια modules, προσβασιμότητα, συμβάσεις, dead code |
| `audit-tauri-acl.cjs` | Κλήσεις Tauri του frontend απέναντι στις άδειες |

## Δομή

```
src/
├── domain/       # καθαρός λογικός: types, validation, recurrence, worklist,
│                 # exportReport. Καμία εξάρτηση από UI ή βάση.
├── persistence/  # SQLite repositories (το μόνο layer που γράφει SQL)
├── hooks/        # state + διαχείριση βάσης, ένα ανά module
├── components/   # React UI. Μέσω hooks, όχι απευθείως repositories.
└── utils/
src-tauri/
├── src/lib.rs        # builder + plugins
├── src/migration.rs  # μεταφορά βάσης μετά τη μετονομασία
└── capabilities/     # δικαιώματα plugin (principle of least privilege)
```

## Αποθήκευση δεδομένων

Θέση: `%APPDATA%\com.ariston.accountant-util\accountant.db`

Η βάση τρέχει σε **WAL mode**. Αυτό έχει δύο πρακτικές συνέπειες:

1. **Ποτέ μην αντιγράφετε το αρχείο `.db` με το χέρι** ενώ τρέχει η εφαρμογή —
   τα δεδομένα μοιράζονται σε `accountant.db`, `-wal` και `-shm`. Χρησιμοποιήστε το
   **Αντίγραφο ασφαλείας** μέσα από την εφαρμογή, που κάνει `VACUUM INTO` και
   παράγει ένα αυτοτελές αρχείο.
2. Κατά τη μετάβαση μεταφέρεται και το `-wal`, αλλιώς χάνονται οι πιο πρόσφατες
   αλλαγές.

Σχήμα: `clients`, `task_types`, `client_task_assignments`, `monthly_task_status`,
`professions` — κανονικοποιημένες σχέσεις με FK και `UNIQUE` περιορισμούς.

## Κανόνας για νέες αναθέσεις

Μια ανάθεση ισχύει για τους μήνες που **επικαλύπτονται** με το διάστημά της: ξεκινά
πριν ή κατά την τελευταία μέρα του μήνα και, αν λήγει, μετά την πρώτη. Έτσι μια
ανάθεση που δημιουργήθηκε στις 6 Οκτωβρίου εμφανίζεται για τον Οκτώβριο αλλά όχι
για τον Σεπτέμβριο, και η ολοκλήρωση ενός μήνα δεν αγγίζει τους υπόλοιπους.

## Σημειώσεις

- Οι ειδοποιήσεις Windows λειτουργούν όσο τρέχει η εφαρμογή. Για ειδοποιήσεις με
  κλειστή εφαρμογή χρειάζεται Windows Task Scheduler.
- Η ενημέρωση γίνεται μέσω GitHub Releases: έλεγχος 30 δευτερόλεπτα μετά την
  εκκίνηση, και χειροκίνητα από το μενού «Αρχείο». Η κυκλοφορία πρέπει να είναι
  δημόσια και υπογεγραμμένη με το κλειδί που είναι ενσωματωμένο στο build·
  αλλιώς ο updater αρνείται να εγκαταστήσει.
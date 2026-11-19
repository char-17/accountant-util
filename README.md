# Accountant Util

Desktop εφαρμογή για λογιστικό γραφείο, σχεδιασμένη για Windows. Τα δεδομένα αποθηκεύονται τοπικά σε SQLite και η εφαρμογή λειτουργεί χωρίς σύνδεση στο διαδίκτυο, εκτός από τον προαιρετικό έλεγχο ενημερώσεων.

## Κύριες δυνατότητες

- Διαχείριση πελατών και ΑΦΜ.
- Κατάλογος εργασιών με περιγραφή, χρώμα και ενεργή/ανενεργή κατάσταση.
- Κατάλογος επαγγελμάτων και σύνδεσή τους με πελάτες.
- Αναθέσεις εργασιών ανά πελάτη.
- Περιοδικότητα εργασιών: μηνιαία, τριμηνιαία και ετήσια.
- Ημερομηνίες λήξης και ειδοποιήσεις πριν από τη λήξη.
- Μηνιαία λίστα εργασιών με φίλτρα πελάτη, εργασίας και κατάστασης.
- Παρακολούθηση ολοκλήρωσης, ποσού, είσπραξης και τιμολόγησης.
- Αναφορές ανά πελάτη και περίοδο.
- Εξαγωγή CSV και εκτύπωση/PDF.
- Χειροκίνητα και αυτόματα αντίγραφα ασφαλείας.
- Επαναφορά δεδομένων από αντίγραφο με επιβεβαίωση.
- Έλεγχος και εγκατάσταση signed ενημερώσεων μέσα από την εφαρμογή.

## Τεχνολογίες

- Tauri v2 και Rust για το desktop shell.
- React και TypeScript για το περιβάλλον χρήστη.
- SQLite μέσω `@tauri-apps/plugin-sql`.
- Vite για development και production frontend build.
- GitHub Actions για signed Windows releases.

## Απαιτήσεις ανάπτυξης

- Windows 10/11.
- Node.js 22 ή νεότερο.
- Rust μέσω `rustup` και Cargo.
- Visual Studio Build Tools με το workload **Desktop development with C++**.

## Εγκατάσταση και εκτέλεση

Από τη ρίζα του project:

```powershell
npm install
npm run tauri dev
```

Για production frontend build:

```powershell
npm run build
```

Για installer Windows:

```powershell
npm run tauri build
```

Το signed installer δημιουργείται συνήθως στο:

```text
src-tauri/target/release/bundle/nsis/
```

## Έλεγχοι ποιότητας

Η πλήρης σουίτα ελέγχων εκτελείται με:

```powershell
npm run verify
```

Περιλαμβάνει typecheck, lint, architecture audits, Rust tests και 34 regression/UI/database checks.

Για το περιβάλλον CI, όπου δεν υπάρχει η τοπική βάση δεδομένων:

```powershell
npm run verify:ci
```

Για τον έλεγχο του style/architecture audit:

```powershell
npm run audit
```

Τα scripts είναι οργανωμένα ως εξής:

```text
scripts/
├── run-verify.cjs        # Κεντρικός runner όλων των ελέγχων
├── audit/                # Architecture, style και Tauri permission audits
├── verify/               # Regression, UI και database tests
└── maintenance/          # Demo database και one-off maintenance scripts
```

## Δεδομένα και αντίγραφα ασφαλείας

Η κύρια βάση είναι το `accountant.db` και αποθηκεύεται στον φάκελο δεδομένων της εφαρμογής:

```text
%APPDATA%\com.ariston.accountant-util\accountant.db
```

Η εφαρμογή χρησιμοποιεί SQLite WAL mode. Για ασφαλές αντίγραφο χρησιμοποιεί `VACUUM INTO`, ώστε το snapshot να είναι συνεπές και ανεξάρτητο από τα αρχεία `-wal` και `-shm`.

Υπάρχουν δύο τύποι αντιγράφων:

- χειροκίνητα αντίγραφα από το μενού «Αρχείο»,
- αυτόματο καθημερινό αντίγραφο στις 15:00 ή στην επόμενη εκκίνηση αν η εφαρμογή ήταν κλειστή.

Πριν από κάθε ενημέρωση δημιουργείται αντίγραφο ασφαλείας. Η επαναφορά ελέγχει πρώτα το αντίγραφο, ζητά επιβεβαίωση και αντικαθιστά τη βάση μόνο μετά την έγκριση.

Περισσότερες λεπτομέρειες για το schema υπάρχουν στο [DATABASE.md](DATABASE.md).

## Ενημερώσεις εφαρμογής

Οι ενημερώσεις δημοσιεύονται μέσω GitHub Releases και ελέγχονται:

- αυτόματα μετά την εκκίνηση, κάθε λεπτό όσο η εφαρμογή τρέχει και όταν επανέρχεται η σύνδεση,
- χειροκίνητα από το μενού «Αρχείο».

Η εγκατάσταση χρησιμοποιεί signed updater artifacts. Το release πρέπει να είναι δημοσιευμένο και να περιέχει installer, `.sig` και `latest.json`. Πριν ξεκινήσει η εγκατάσταση, η εφαρμογή δημιουργεί backup της βάσης.

Η ροή release βρίσκεται στο:

```text
.github/workflows/release.yml
```

Κάθε push στο `main` ενεργοποιεί τη δημοσίευση. Το CI δίνει στο build τον επόμενο αριθμό patch, συγχρονίζει τις εκδόσεις του frontend και του Rust στο checkout του runner και συνδέει το release με το συγκεκριμένο commit. Υποστηρίζεται επίσης ρητό tag `vX.Y.Z` για μεγαλύτερη έκδοση. Οι εγκαταστάσεις ενημερώνονται μετά την ολοκλήρωση των ελέγχων και της δημοσίευσης.

Το workflow συγκρίνει το δημόσιο κλειδί με εκείνο της τελευταίας δημοσιευμένης έκδοσης. Κατεβάζει τα αρχεία του draft, επαληθεύει την υπογραφή του installer, το URL και την έκδοση στο manifest και κατόπιν δημοσιεύει το release. Τέλος ελέγχει την ίδια διαδρομή λήψης που χρησιμοποιεί ο υπολογιστής του χρήστη, χωρίς σύνδεση στο GitHub.

Η υπογραφή του δημόσιου installer 0.1.6 επαληθεύεται με το διορθωμένο δημόσιο κλειδί. Τα tags `v0.1.3` και `v0.1.6` περιέχουν διαφορετικό κλειδί με το ίδιο αναγνωριστικό. Το `v0.1.2` περιέχει παλαιότερο κλειδί. Για εγκατάσταση με ασύμβατο κλειδί, δημιουργήστε backup και εγκαταστήστε χειροκίνητα μία φορά την πρώτη διορθωμένη έκδοση. Οι επόμενες υπογεγραμμένες ενημερώσεις μπορούν να εγκαθίστανται από την εφαρμογή.

## Δομή project

```text
src/                  React UI, hooks, domain logic και persistence layer
src-tauri/             Rust backend, migrations, backup commands και Tauri config
scripts/audit/         Static architecture/style/permission audits
scripts/verify/        Automated regression και UI tests
scripts/maintenance/   Demo database και one-off maintenance scripts
lib/                   Node helper για τη διαδρομή της local database στα tests
docs/                  Τεχνική τεκμηρίωση και αρχιτεκτονικές αποφάσεις
test-data/             Τοπικά δεδομένα δοκιμών, εκτός Git
```

## Git και αρχεία ανάπτυξης

Το `.gitignore` εξαιρεί generated αρχεία, `node_modules`, βάσεις δεδομένων, backups, προσωρινά test files και τοπικές session notes. Το `.gitattributes` ρυθμίζει line endings και binary αρχεία ώστε το repository να παραμένει συνεπές σε διαφορετικούς υπολογιστές.

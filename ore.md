# Accountant Util — Αλλαγές

## Visual redesign

- Εφαρμόστηκε νέο visual system με navy sidebar, μωβ primary χρώμα, λευκό workspace, soft borders, rounded cards και διακριτικά shadows.
- Το app shell υποστηρίζει ανοιχτή και κλειστή sidebar.
- Η κλειστή sidebar έχει στενότερο rail, ενιαία SVG icons, σωστό active state και κεντραρισμένα icons.
- Το κάτω toggle της sidebar μεταφέρθηκε στη βάση και κρατήθηκε διαθέσιμο και στις δύο καταστάσεις.
- Αφαιρέθηκαν τα ανεπιθύμητα visual-only στοιχεία από το αρχικό redesign, όπως το notification bell, το «Σύστημα ενεργό», το avatar και το profile block.

## App header

- Το «Αρχείο» τοποθετήθηκε τέρμα αριστερά στο app header.
- Το header διαμορφώθηκε σε compact Windows-style command bar.
- Βελτιώθηκαν τα hit areas, τα hover/focus states και η responsive συμπεριφορά του «Αρχείο» και του month picker.
- Το month dropdown ανοίγει κάτω από τον μήνα, έχει μεγαλύτερα clickable areas για μήνες και έτη, καθαρό active month state και προσαρμογή για μικρότερα παράθυρα.

## Dashboard και panels

- Αφαιρέθηκε η παλιά εισαγωγική περίληψη και τα τέσσερα summary cards που δεν ανήκαν στο ζητούμενο σχέδιο.
- Η «Σύνοψη μήνα» και η «Πρόοδος ανά πελάτη» έγιναν ξεχωριστά panels.
- Η «Πρόοδος ανά πελάτη» απέκτησε compact γραμμές με όνομα, progress bar και completed/total στην ίδια σειρά.
- Αφαιρέθηκαν τα περιττά διπλά πλαίσια από το κεντρικό worklist.
- Τα payment controls έγιναν ενιαίο και πιο καθαρό block ανά εργασία.
- Διορθώθηκε το visual bug που εμφάνιζε ανεπιθύμητα `0` και `00` όταν τα SQLite boolean values ήταν `0`.
- Η δεξιά στήλη μεγάλωσε ώστε οι ειδοποιήσεις να εμφανίζουν περισσότερο κείμενο.
- Βελτιώθηκαν η αντίθεση, η progress bar και η αναγνωσιμότητα των labels.

## Panel πελατών

- Τα ονόματα πελατών στοιχίζονται αριστερά.
- Το toggle «Πελάτες» απέκτησε καθαρότερο header και caret.
- Η scrollbar ενοποιήθηκε οπτικά με τα υπόλοιπα panels.
- Τα backgrounds των γραμμών έγιναν πιο ήπια.
- Το selected client εμφανίζεται με μωβ αριστερή ένδειξη και πιο καθαρό highlight.
- Το «+ Νέος πελάτης» έγινε μωβ primary action.
- Η λίστα εμφανίζει περισσότερες εγγραφές χωρίς κομμένη τελευταία γραμμή.

## Functional fixes

- Οι ειδοποιήσεις πλέον μεταφέρουν σωστά τον χρήστη στον μήνα στον οποίο ανήκει η εργασία και επιλέγουν τον σωστό πελάτη.
- Διορθώθηκε η ορθογραφία των overdue ειδοποιήσεων από «Λήγησε» σε «Έληξε».
- Ενημερώθηκε το recurrence verification ώστε να ελέγχει τη διορθωμένη διατύπωση.
- Υποστηρίζονται και ελέγχονται οι περιοδικότητες μηνιαία, τριμηνιαία, εξαμηνιαία και ετήσια.
- Οι ειδοποιήσεις εμφανίζονται και μετά την παρέλευση της προθεσμίας και οι ημερομηνίες/αποστάσεις υπολογίζονται σωστά.
- Οι τριμηνιαίες, εξαμηνιαίες και ετήσιες εργασίες εμφανίζονται πλέον στη λίστα εργασιών του πελάτη στην κεντρική σελίδα.

## Client panel layout και regressions

- Διορθώθηκε η επικάλυψη μεταξύ γραμμών εργασιών και του heading «Εργασίες πελάτη».
- Το client panel έχει πλέον έναν ενιαίο scrollable body. Header και footer παραμένουν σταθερά ορατά.
- Προστέθηκαν responsive όρια με `100dvh` για μικρά παράθυρα και ύψη.
- Τα dialogs περιορίζονται στο διαθέσιμο ύψος και αποκτούν εσωτερικό scrolling.
- Το click εκτός της καρτέλας πελάτη δεν κλείνει πλέον το panel και δεν χάνει μη αποθηκευμένες αλλαγές.
- Προστέθηκε επιβεβαίωση εξόδου όταν υπάρχουν μη αποθηκευμένες αλλαγές.
- Διορθώθηκε η ασύγχρονη επιλογή «Απενεργοποίηση αντί», ώστε το dialog να κλείνει μόνο μετά από επιτυχία.
- Προστέθηκε κοινό keyboard/focus handling για dialogs: Escape, focus trap και επιστροφή focus.
- Τα interaction regression tests ενημερώθηκαν ώστε να ελέγχουν τον νέο layout contract και το dirty-state protection.

## Έλεγχοι

- `npm.cmd run typecheck` — επιτυχία
- `npm.cmd run build` — επιτυχία
- `npm.cmd run audit` — επιτυχία
- `npm.cmd run verify` — 34/34 checks επιτυχία
- `node verify-ui-interaction.cjs` — όλα τα UI interaction και layout regression tests επιτυχία
- `git diff --check` — επιτυχία

Δεν άλλαξε database schema. Οι αλλαγές περιορίστηκαν σε UI/layout, dialog accessibility, notifications/recurrence logic και τα αντίστοιχα regression tests.

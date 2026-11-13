const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const output = path.join(__dirname, "test-data", "accountant-demo.db");
fs.mkdirSync(path.dirname(output), { recursive: true });
try { fs.unlinkSync(output); } catch {}

const db = new Database(output);
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE professions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#8B9DAD',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tax_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    profession_id INTEGER REFERENCES professions(id)
  );
  CREATE TABLE task_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#8B9DAD',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE client_task_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    task_type_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    periodicity TEXT NOT NULL DEFAULT 'monthly',
    due_day INTEGER NOT NULL DEFAULT 28,
    reminder_days INTEGER NOT NULL DEFAULT 5,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE,
    UNIQUE(client_id, task_type_id, is_active)
  );
  CREATE TABLE monthly_task_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    task_type_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK(month >= 1 AND month <= 12),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
    completed_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    amount REAL,
    is_paid INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    is_invoiced INTEGER NOT NULL DEFAULT 0,
    invoiced_at TEXT,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE,
    UNIQUE(client_id, task_type_id, year, month)
  );
`);

const insertProfession = db.prepare("INSERT INTO professions (name, description, color) VALUES (?, ?, ?)");
[
  ["Ιατρός", "Ιατρικές υπηρεσίες", "#6366f1"],
  ["Μηχανικός", "Τεχνικό γραφείο", "#0ea5e9"],
  ["Ελεύθερος επαγγελματίας", "Παροχή υπηρεσιών", "#16a34a"],
  ["Εμπόριο", "Εμπορική δραστηριότητα", "#d97706"],
].forEach((row) => insertProfession.run(...row));

const insertClient = db.prepare("INSERT INTO clients (name, tax_id, notes, profession_id) VALUES (?, ?, ?, ?)");
[
  ["ΠΑΠΑΔΟΠΟΥΛΟΥ ΜΑΡΙΑ", "099123456", "Τηλεφωνική επικοινωνία κάθε Παρασκευή.", 1],
  ["ΤΕΧΝΙΚΗ ΔΟΜΗ ΙΚΕ", "099234567", "Υποβολή ΦΠΑ και μισθοδοσίας.", 2],
  ["ΝΙΚΟΛΑΟΥ ΓΕΩΡΓΙΟΣ", "099345678", "Νέος πελάτης — έλεγχος παραστατικών.", 3],
  ["ΠΑΡΑΔΟΣΙΑΚΑ ΕΔΕΣΜΑΤΑ ΟΕ", "099456789", "", 4],
].forEach((row) => insertClient.run(...row));

const insertTask = db.prepare("INSERT INTO task_types (name, description, color) VALUES (?, ?, ?)");
[
  ["Τήρηση βιβλίων", "Μηνιαία καταχώριση και έλεγχος.", "#6366f1"],
  ["ΦΠΑ", "Περιοδική δήλωση ΦΠΑ.", "#0ea5e9"],
  ["Μισθοδοσία", "Μισθοδοτική κατάσταση.", "#16a34a"],
  ["Ετήσια δήλωση", "Ετήσια φορολογική δήλωση.", "#d97706"],
  ["Έλεγχος συμφωνίας", "Συμφωνία τραπεζών και παραστατικών.", "#8b5cf6"],
].forEach((row) => insertTask.run(...row));

const insertAssignment = db.prepare(`
  INSERT INTO client_task_assignments
    (client_id, task_type_id, start_date, periodicity, due_day, reminder_days)
  VALUES (?, ?, ?, ?, ?, ?)
`);
[
  [1, 1, "2026-01-01", "monthly", 10, 5],
  [1, 2, "2026-01-01", "quarterly", 25, 7],
  [1, 4, "2026-01-01", "yearly", 30, 14],
  [2, 1, "2026-03-01", "monthly", 15, 5],
  [2, 2, "2026-03-01", "quarterly", 28, 10],
  [2, 3, "2026-03-01", "monthly", 25, 3],
  [3, 1, "2026-09-01", "monthly", 20, 5],
  [3, 5, "2026-09-01", "semiannual", 20, 10],
  [4, 1, "2026-01-01", "monthly", 12, 5],
].forEach((row) => insertAssignment.run(...row));

const insertStatus = db.prepare(`
  INSERT INTO monthly_task_status
    (client_id, task_type_id, year, month, status, completed_at, note, amount, is_paid, paid_at, is_invoiced, invoiced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const completed = "2026-11-08 12:00:00";
[
  [1, 1, 2026, 11, "completed", completed, "Καταχωρίστηκαν όλα τα παραστατικά.", 180, 1, completed, 1, completed],
  [1, 2, 2026, 10, "completed", "2026-10-24 10:30:00", "Υποβλήθηκε εμπρόθεσμα.", 90, 1, "2026-10-25 09:00:00", 1, "2026-10-25 09:00:00"],
  [2, 1, 2026, 11, "pending", null, "Αναμένονται δύο τιμολόγια.", 240, 0, null, 0, null],
  [2, 3, 2026, 11, "completed", completed, "", 120, 0, null, 1, completed],
  [2, 2, 2026, 10, "pending", null, "", 80, 0, null, 0, null],
  [3, 1, 2026, 11, "pending", null, "Να ελεγχθούν οι αποδείξεις.", 75, 0, null, 0, null],
  [4, 1, 2026, 11, "completed", completed, "", 150, 1, completed, 1, completed],
].forEach((row) => insertStatus.run(...row));

db.pragma("user_version = 1");
db.close();
console.log(JSON.stringify({
  output,
  clients: 4,
  professions: 4,
  taskTypes: 5,
  assignments: 9,
  monthlyStatuses: 7,
}, null, 2));

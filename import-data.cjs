const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const path = require('path');

const filePath = path.join(__dirname, 'EXTARS FROM ME', 'ΚΑΤΑΣΤ_ΕΡΓΑΣΙΩΝ.xlsx');

// Η εφαρμογή χρησιμοποιεί τη βάση στο %APPDATA%\com.ariston.tauri-app\accountant.db
const appDataDir = path.dirname(require('./lib/dbPath.cjs').databasePath());
const dbPath = path.join(appDataDir, 'accountant.db');

const MUTED_PALETTE = [
  "#7B8D6E", "#8B9DAD", "#C4A882", "#A88FA8", "#7E9E9E",
  "#B08968", "#8D99AE", "#A3B18A", "#BC6C25", "#6B705C",
  "#9A8C98", "#7F9EB2", "#B5838D", "#A26769", "#6D8EA0", "#9C9583",
];

const workbook = XLSX.readFile(filePath);

// Extract all unique clients and tasks
const clients = new Map();
const tasks = new Map();

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  if (data.length < 2) continue;

  const header = data[1];
  const taskNames = [];
  for (let i = 2; i < header.length; i++) {
    const taskName = String(header[i] || '').trim().replace(/\s+/g, ' ');
    if (taskName && !taskNames.includes(taskName)) {
      taskNames.push(taskName);
    }
  }

  for (const taskName of taskNames) {
    if (!tasks.has(taskName)) {
      tasks.set(taskName, { name: taskName, color: MUTED_PALETTE[tasks.size % MUTED_PALETTE.length] });
    }
  }

  for (let i = 2; i < data.length; i++) {
    const row = data[i];
    if (!row) continue;
    const name = String(row[1] || '').trim();
    if (!name) continue;

    if (!clients.has(name)) {
      clients.set(name, {
        name,
        email: null,
        phone: null,
        address: null,
        taxId: null,
        notes: null,
      });
    }
  }
}

console.log(`Found ${clients.size} unique clients`);
console.log(`Found ${tasks.size} unique tasks`);

// Create tables and insert data
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    tax_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT NOT NULL DEFAULT '#8B9DAD',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS client_task_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    task_type_id INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE,
    UNIQUE(client_id, task_type_id, is_active)
  );

  CREATE TABLE IF NOT EXISTS monthly_task_status (
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
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE CASCADE,
    UNIQUE(client_id, task_type_id, year, month)
  );
`);

const insertClient = db.prepare(
  'INSERT OR IGNORE INTO clients (name, email, phone, address, tax_id, notes) VALUES (?, ?, ?, ?, ?, ?)'
);

for (const client of clients.values()) {
  insertClient.run(client.name, client.email, client.phone, client.address, client.taxId, client.notes);
}

const insertTask = db.prepare(
  'INSERT OR IGNORE INTO task_types (name, color, description) VALUES (?, ?, ?)'
);

for (const task of tasks.values()) {
  insertTask.run(task.name, task.color, null);
}

console.log('\nData imported successfully!');
console.log(`Clients in database: ${db.prepare('SELECT COUNT(*) as count FROM clients').get().count}`);
console.log(`Tasks in database: ${db.prepare('SELECT COUNT(*) as count FROM task_types').get().count}`);

db.close();

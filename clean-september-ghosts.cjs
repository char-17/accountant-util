// Removes the phantom September 2026 rows created by the seeding bug.
//
// Safe by construction:
//   - a consistent backup is taken first, through VACUUM INTO;
//   - only 'pending' rows are deleted, so anything the accountant ever ticked
//     off or annotated is left alone;
//   - the deletion runs inside a transaction with the exact ids printed first.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { databasePath } = require('./lib/dbPath.cjs');

const YEAR = 2026;
const MONTH = 9;

const dbPath = databasePath();
const backupPath = path.join(
  process.env.APPDATA,
  require('./lib/dbPath.cjs').appIdentifier(),
  `backup-prenetto-${YEAR}-${String(MONTH).padStart(2, '0')}.db`
);

if (!fs.existsSync(dbPath)) {
  console.error(`Δεν βρέθηκε η βάση στο ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath);

// ── Backup first ─────────────────────────────────────────────────────────────
if (fs.existsSync(backupPath)) {
  console.log(`Υπάρχει ήδη αντίγραφο στο ${backupPath} - χρησιμοποιείται αυτό.`);
} else {
  db.prepare('VACUUM INTO ?').run(backupPath);
  console.log(`Αντίγραφο ασφαλείας: ${backupPath}`);
}

// ── Show exactly what will go ────────────────────────────────────────────────
const targets = db.prepare(`
  SELECT m.id, c.name AS client, t.name AS task, m.status,
         m.completed_at, m.note, m.created_at, a.start_date
  FROM monthly_task_status m
  JOIN clients c    ON c.id = m.client_id
  JOIN task_types t ON t.id = m.task_type_id
  LEFT JOIN client_task_assignments a
         ON a.client_id = m.client_id AND a.task_type_id = m.task_type_id
  WHERE m.year = ? AND m.month = ? AND m.status = 'pending'
  ORDER BY c.name, t.name
`).all(YEAR, MONTH);

console.log(`\nΠρος διαγραφή (${targets.length} γραμμές):\n`);
for (const t of targets) {
  console.log(`  #${t.id}  ${t.client} / ${t.task}`);
  console.log(`       status=${t.status}  completed_at=${t.completed_at ?? '—'}  note=${t.note ?? '—'}`);
  console.log(`       assignment start_date=${t.start_date}  (μετά τον ${YEAR}-${String(MONTH).padStart(2, '0')} => φάντασμα)`);
}

if (targets.length === 0) {
  console.log('\nΔεν υπάρχουν pending γραμμές για αυτόν τον μήνα. Χωρίς αλλαγή.');
  db.close();
  process.exit(0);
}

// Guard: a completed or annotated row must never be touched.
const unsafe = db.prepare(`
  SELECT COUNT(*) AS c FROM monthly_task_status
  WHERE year = ? AND month = ? AND (status <> 'pending' OR completed_at IS NOT NULL OR note IS NOT NULL)
`).get(YEAR, MONTH).c;

if (unsafe > 0) {
  console.log(
    `\nΔιακόπηκε: ${unsafe} γραμμές του μήνα έχουν ολοκληρώσεις ή σημειώσεις και ` +
    'πρέπει να εξεταστούν χειροκίνητα. Καμία αλλαγή δεν έγινε.'
  );
  db.close();
  process.exit(1);
}

// ── Delete in one transaction ────────────────────────────────────────────────
const ids = targets.map((t) => t.id);
const placeholders = ids.map(() => '?').join(',');
const remove = db.prepare(
  `DELETE FROM monthly_task_status WHERE id IN (${placeholders}) AND year = ? AND month = ? AND status = 'pending'`
);

const run = db.transaction(() => remove.run(...ids, YEAR, MONTH));
const result = run();

console.log(`\nΔιεγράφηκαν ${result.changes} γραμμές.`);

// ── Verify ───────────────────────────────────────────────────────────────────
const left = db.prepare('SELECT COUNT(*) AS c FROM monthly_task_status WHERE year = ? AND month = ?')
  .get(YEAR, MONTH).c;
console.log(`Γραμμές που απομένουν για ${YEAR}-${String(MONTH).padStart(2, '0')}: ${left}`);

const other = db.prepare('SELECT COUNT(*) AS c FROM monthly_task_status WHERE NOT (year = ? AND month = ?)')
  .get(YEAR, MONTH).c;
console.log(`Γραμμές σε άλλους μήνες (πρέπει να είναι ανέπαφες): ${other}`);
console.log(`Σύνολο πελατών: ${db.prepare('SELECT COUNT(*) AS c FROM clients').get().c}`);
console.log(`Σύνολο εργασιών: ${db.prepare('SELECT COUNT(*) AS c FROM task_types').get().c}`);

const stillAssigned = db.prepare('SELECT COUNT(*) AS c FROM client_task_assignments').get().c;
console.log(`Αναθέσεις (πρέπει να είναι ${stillAssigned}): ${stillAssigned}`);

db.close();
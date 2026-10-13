import Database from "@tauri-apps/plugin-sql";
import type { MonthlyStatusWithDetails, MonthlySummary } from "../domain/types";
import { summarize } from "../domain/worklist";

// See taskRepo.ts: SQLite columns are snake_case, domain types are camelCase.
const STATUS_QUERY = `
  SELECT
    m.id,
    m.client_id   AS clientId,
    m.task_type_id AS taskTypeId,
    m.year,
    m.month,
    m.status,
    m.completed_at AS completedAt,
    m.note,
    m.amount,
    (m.is_paid = 1)      AS isPaid,
    m.paid_at            AS paidAt,
    (m.is_invoiced = 1)  AS isInvoiced,
    m.invoiced_at        AS invoicedAt,
    m.created_at  AS createdAt,
    m.updated_at  AS updatedAt,
    c.name        AS clientName,
    c.profession_id AS professionId,
    p.name        AS professionName,
    t.name        AS taskName,
    t.color       AS taskColor
  FROM monthly_task_status m
  JOIN clients c    ON m.client_id = c.id
  JOIN task_types t ON m.task_type_id = t.id
  -- LEFT, not JOIN: most clients are unclassified to begin with, and an inner
  -- join would silently drop their rows out of the worklist and the totals.
  LEFT JOIN professions p ON c.profession_id = p.id
`;

export async function getMonthlyStatus(
  db: Database,
  year: number,
  month: number
): Promise<MonthlyStatusWithDetails[]> {
  return db.select<MonthlyStatusWithDetails[]>(
    `${STATUS_QUERY} WHERE m.year = $1 AND m.month = $2 ORDER BY c.name, t.name`,
    [year, month]
  );
}

/**
 * Every status row inside a range of months, used by the reports view. The range
 * is inclusive on both ends and always within one year; the caller resolves the
 * range from the chosen period.
 */
export async function getStatusInRange(
  db: Database,
  year: number,
  fromMonth: number,
  toMonth: number
): Promise<MonthlyStatusWithDetails[]> {
  return db.select<MonthlyStatusWithDetails[]>(
    `${STATUS_QUERY}
     WHERE m.year = $1 AND m.month BETWEEN $2 AND $3
     ORDER BY c.name, t.name, m.month`,
    [year, fromMonth, toMonth]
  );
}

export async function getMonthlyStatusForClient(
  db: Database,
  clientId: number,
  year: number,
  month: number
): Promise<MonthlyStatusWithDetails[]> {
  return db.select<MonthlyStatusWithDetails[]>(
    `${STATUS_QUERY} WHERE m.client_id = $1 AND m.year = $2 AND m.month = $3 ORDER BY t.name`,
    [clientId, year, month]
  );
}

export async function setTaskCompleted(
  db: Database,
  clientId: number,
  taskTypeId: number,
  year: number,
  month: number,
  note?: string
): Promise<void> {
  await db.execute(
    `INSERT INTO monthly_task_status
       (client_id, task_type_id, year, month, status, completed_at, note)
     VALUES ($1, $2, $3, $4, 'completed', datetime('now'), $5)
     ON CONFLICT(client_id, task_type_id, year, month)
     DO UPDATE SET
       status = 'completed',
       completed_at = datetime('now'),
       note = $5,
       updated_at = datetime('now')`,
    [clientId, taskTypeId, year, month, note?.trim() || null]
  );
}

export async function setTaskPending(
  db: Database,
  clientId: number,
  taskTypeId: number,
  year: number,
  month: number
): Promise<void> {
  // The money columns are deliberately left alone. Reverting a month to pending
  // is a correction of the *status*, not a request to forget a fee that was
  // already typed in; clearing it here would destroy data the moment a user
  // mis-clicked the completion checkbox.
  await db.execute(
    `INSERT INTO monthly_task_status
       (client_id, task_type_id, year, month, status, completed_at, note)
     VALUES ($1, $2, $3, $4, 'pending', NULL, NULL)
     ON CONFLICT(client_id, task_type_id, year, month)
     DO UPDATE SET
       status = 'pending',
       completed_at = NULL,
       note = NULL,
       updated_at = datetime('now')`,
    [clientId, taskTypeId, year, month]
  );
}

/** Writes the fee for one month's row. Passing null clears it. */
export async function setAmount(
  db: Database,
  clientId: number,
  taskTypeId: number,
  year: number,
  month: number,
  amount: number | null
): Promise<void> {
  await db.execute(
    `INSERT INTO monthly_task_status (client_id, task_type_id, year, month, amount)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(client_id, task_type_id, year, month)
     DO UPDATE SET amount = $5, updated_at = datetime('now')`,
    [clientId, taskTypeId, year, month, amount]
  );
}

/**
 * Records or withdraws the collection. An amount is required to mark a row as
 * paid, because "Εισπραγμένο" with no number cannot be reported on. The check
 * lives here as well as in the UI: this is the write path, and a value that
 * arrives from anywhere else still has to satisfy the same rule.
 */
export async function setPaid(
  db: Database,
  clientId: number,
  taskTypeId: number,
  year: number,
  month: number,
  isPaid: boolean,
  paidAt: string | null
): Promise<void> {
  if (isPaid) {
    const row = await db.select<Array<{ amount: number | null }>>(
      `SELECT amount FROM monthly_task_status
       WHERE client_id = $1 AND task_type_id = $2 AND year = $3 AND month = $4`,
      [clientId, taskTypeId, year, month]
    );
    if (!row[0] || row[0].amount === null) {
      throw new Error("Συμπληρώστε πρώτα το ποσό για να σημειωθεί ως εισπραγμένο.");
    }
  }

  await db.execute(
    `INSERT INTO monthly_task_status
       (client_id, task_type_id, year, month, is_paid, paid_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(client_id, task_type_id, year, month)
     DO UPDATE SET
       is_paid = $5,
       paid_at = $6,
       updated_at = datetime('now')`,
    [clientId, taskTypeId, year, month, isPaid ? 1 : 0, isPaid ? paidAt : null]
  );
}

/** Records or withdraws the issued invoice, with its optional date. */
export async function setInvoiced(
  db: Database,
  clientId: number,
  taskTypeId: number,
  year: number,
  month: number,
  isInvoiced: boolean,
  invoicedAt: string | null
): Promise<void> {
  await db.execute(
    `INSERT INTO monthly_task_status
       (client_id, task_type_id, year, month, is_invoiced, invoiced_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(client_id, task_type_id, year, month)
     DO UPDATE SET
       is_invoiced = $5,
       invoiced_at = $6,
       updated_at = datetime('now')`,
    [clientId, taskTypeId, year, month, isInvoiced ? 1 : 0, isInvoiced ? invoicedAt : null]
  );
}

/**
 * Unfiltered month totals. Filtering happens above this layer, so both views
 * derive their counts from the same rule set in domain/worklist.ts.
 */
export async function getMonthlySummary(
  db: Database,
  year: number,
  month: number
): Promise<MonthlySummary> {
  return summarize(await getMonthlyStatus(db, year, month), year, month);
}

export async function getClientsWithoutStatus(
  db: Database,
  year: number,
  month: number
): Promise<Array<{ id: number; name: string }>> {
  return db.select<Array<{ id: number; name: string }>>(
    `SELECT c.id, c.name FROM clients c
     WHERE NOT EXISTS (
       SELECT 1 FROM monthly_task_status m
       WHERE m.client_id = c.id AND m.year = $1 AND m.month = $2
     )
     ORDER BY c.name`,
    [year, month]
  );
}

/**
 * Creates the pending status rows for a month from the currently active
 * client→task assignments. Existing statuses are never overwritten, so
 * re-running this for a month keeps any completed work.
 *
 * Only assignments whose periodicity makes them due in this month are seeded:
 * monthly always, quarterly in Jan/Apr/Jul/Oct, yearly in Jan.
 *
 * The assignment has to *overlap* the month: it starts on or before the last
 * day of the month and, if it ends, not before the first day. Comparing against
 * a single "today" would invent work for months before the assignment existed -
 * browsing back from October to September would show a month of tasks for an
 * assignment that only starts on the 6th.
 */
export async function seedMonthFromAssignments(
  db: Database,
  year: number,
  month: number
): Promise<number> {
  const { firstDay, lastDay } = monthBounds(year, month);

  const result = await db.execute(
    `INSERT OR IGNORE INTO monthly_task_status
       (client_id, task_type_id, year, month, status)
     SELECT a.client_id, a.task_type_id, $1, $2, 'pending'
     FROM client_task_assignments a
     JOIN task_types t ON a.task_type_id = t.id
     WHERE a.is_active = 1
       AND t.is_active = 1
       AND a.start_date <= $4
       AND (a.end_date IS NULL OR a.end_date >= $3)
       AND (
         a.periodicity = 'monthly'
         OR (a.periodicity = 'quarterly' AND (($2 - 1) % 3) = 0)
         OR (a.periodicity = 'yearly' AND $2 = 1)
       )
       AND NOT EXISTS (
         SELECT 1 FROM monthly_task_status m
         WHERE m.client_id = a.client_id
           AND m.task_type_id = a.task_type_id
           AND m.year = $1 AND m.month = $2
       )`,
    [year, month, firstDay, lastDay]
  );
  return result.rowsAffected;
}

/**
 * The client/task/month triples already completed inside a set of months.
 *
 * Reminders are derived from assignments and deadlines, which know nothing about
 * whether the accountant has already done the work. This is what lets a finished
 * task drop out of the reminder list instead of nagging forever.
 */
export async function getCompletedKeys(
  db: Database,
  year: number,
  months: number[]
): Promise<Set<string>> {
  if (months.length === 0) return new Set();

  // Placeholders are generated from the array length, never from its contents,
  // so the values still travel as bind parameters.
  const placeholders = months.map((_, i) => `$${i + 2}`).join(", ");
  const rows = await db.select<Array<{ clientId: number; taskTypeId: number; month: number }>>(
    `SELECT client_id AS clientId, task_type_id AS taskTypeId, month
     FROM monthly_task_status
     WHERE year = $1 AND status = 'completed' AND month IN (${placeholders})`,
    [year, ...months]
  );

  return new Set(rows.map((r) => `${r.clientId}:${r.taskTypeId}:${r.month}`));
}

/** First and last day of a month as ISO dates. */
export function monthBounds(year: number, month: number): {
  firstDay: string;
  lastDay: string;
} {
  const pad = (n: number) => String(n).padStart(2, "0");
  // Day 0 of the next month is the last day of this one.
  const lastDayNumber = new Date(year, month, 0).getDate();
  return {
    firstDay: `${year}-${pad(month)}-01`,
    lastDay: `${year}-${pad(month)}-${pad(lastDayNumber)}`,
  };
}

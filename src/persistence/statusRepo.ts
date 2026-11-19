import type Database from "@tauri-apps/plugin-sql";
import type { ClientTaskAssignment, FinancialCorrection, ReportBasis, MonthlyStatusWithDetails, MonthlySummary } from "../domain/types";
import { applyFinancialChange, financialValues, type FinancialChange } from "../domain/taskFinance";
import { summarize } from "../domain/worklist";
import { nextDeadline } from "../domain/recurrence";

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
    t.color       AS taskColor,
    COALESCE(a.periodicity, 'monthly') AS periodicity
  FROM monthly_task_status m
  JOIN clients c    ON m.client_id = c.id
  JOIN task_types t ON m.task_type_id = t.id
  LEFT JOIN client_task_assignments a ON a.id = (
    SELECT assignment.id FROM client_task_assignments assignment
    WHERE assignment.client_id = m.client_id AND assignment.task_type_id = m.task_type_id
      AND assignment.start_date <= date(printf('%04d-%02d-01', m.year, m.month), '+1 month', '-1 day')
      AND (assignment.end_date IS NULL OR assignment.end_date >= printf('%04d-%02d-01', m.year, m.month))
    ORDER BY assignment.start_date DESC, assignment.id DESC LIMIT 1
  )
  -- LEFT, not JOIN: most clients are unclassified to begin with, and an inner
  -- join would silently drop their rows out of the worklist and the totals.
  LEFT JOIN professions p ON c.profession_id = p.id
`;

/* The dashboard shows every active assignment for the selected month. A
   missing monthly row is represented as a pending, empty row so a quarterly,
   semiannual or yearly task remains visible between its due months. Reports
   continue to use STATUS_QUERY and therefore keep their due-month semantics. */
const WORKLIST_QUERY = `
  SELECT
    COALESCE(m.id, -a.id) AS id,
    a.client_id      AS clientId,
    a.task_type_id   AS taskTypeId,
    $1               AS year,
    $2               AS month,
    COALESCE(m.status, 'pending') AS status,
    m.completed_at   AS completedAt,
    m.note,
    m.amount,
    m.corrections_json AS correctionsJson,
    (COALESCE(m.is_paid, 0) = 1) AS isPaid,
    m.paid_at        AS paidAt,
    (COALESCE(m.is_invoiced, 0) = 1) AS isInvoiced,
    m.invoiced_at    AS invoicedAt,
    m.created_at     AS createdAt,
    m.updated_at     AS updatedAt,
    c.name           AS clientName,
    c.profession_id  AS professionId,
    p.name           AS professionName,
    t.name           AS taskName,
    t.color          AS taskColor,
    a.periodicity    AS periodicity,
    a.start_date     AS startDate,
    a.end_date       AS endDate,
    a.due_day        AS dueDay,
    a.reminder_days  AS reminderDays
  FROM client_task_assignments a
  JOIN clients c    ON a.client_id = c.id
  JOIN task_types t ON a.task_type_id = t.id AND t.is_active = 1
  LEFT JOIN professions p ON c.profession_id = p.id
  LEFT JOIN monthly_task_status m
    ON m.client_id = a.client_id
   AND m.task_type_id = a.task_type_id
   AND m.year = $1
   AND m.month = $2
  WHERE a.is_active = 1
    AND a.start_date <= $4
    AND (a.end_date IS NULL OR a.end_date >= $3)
`;

export async function getMonthlyStatus(
  db: Database,
  year: number,
  month: number
): Promise<MonthlyStatusWithDetails[]> {
  const { firstDay, lastDay } = monthBounds(year, month);
  type Row = MonthlyStatusWithDetails & { correctionsJson: string | null } & Pick<ClientTaskAssignment, "startDate" | "endDate" | "dueDay" | "reminderDays">;
  const rows = await db.select<Row[]>(
    `${WORKLIST_QUERY}
     ORDER BY c.name,
       CASE periodicity
         WHEN 'monthly' THEN 1
         WHEN 'quarterly' THEN 2
         WHEN 'semiannual' THEN 3
         WHEN 'yearly' THEN 4
         ELSE 5
       END,
       t.name`,
    [year, month, firstDay, lastDay]
  );
  const beforeMonth = new Date(year, month - 1, 0);
  return rows.map(({ correctionsJson, ...row }) => {
    const dueOn = nextDeadline(row, beforeMonth)?.dueOn;
    return {
      ...row,
      corrections: JSON.parse(correctionsJson ?? "[]") as FinancialCorrection[],
      dueOn: dueOn && (!row.endDate || dueOn <= row.endDate) ? dueOn : null,
    };
  });
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
  toMonth: number,
  basis: ReportBasis = "work",
  invoicedUnpaid = false
): Promise<MonthlyStatusWithDetails[]> {
  const conditions = {
    work: "m.year = $1 AND m.month BETWEEN $2 AND $3",
    payments: "m.is_paid = 1 AND substr(m.paid_at, 1, 10) BETWEEN $1 AND $2",
    invoices: "m.is_invoiced = 1 AND substr(m.invoiced_at, 1, 10) BETWEEN $1 AND $2",
  };
  const params = basis === "work" ? [year, fromMonth, toMonth] :
    [monthBounds(year, fromMonth).firstDay, monthBounds(year, toMonth).lastDay];
  const outstanding = basis === "work" && invoicedUnpaid ? " AND m.is_invoiced=1 AND m.is_paid=0" : "";
  return db.select<MonthlyStatusWithDetails[]>(
    `${STATUS_QUERY}
     WHERE ${conditions[basis]}${outstanding}
     ORDER BY c.name,
       CASE periodicity
         WHEN 'monthly' THEN 1
         WHEN 'quarterly' THEN 2
         WHEN 'semiannual' THEN 3
         WHEN 'yearly' THEN 4
         ELSE 5
       END,
       t.name, m.month`,
    params
  );
}

export async function getMonthlyStatusForClient(
  db: Database,
  clientId: number,
  year: number,
  month: number
): Promise<MonthlyStatusWithDetails[]> {
  return db.select<MonthlyStatusWithDetails[]>(
    `${STATUS_QUERY} WHERE m.client_id = $1 AND m.year = $2 AND m.month = $3
     ORDER BY CASE periodicity
       WHEN 'monthly' THEN 1
       WHEN 'quarterly' THEN 2
       WHEN 'semiannual' THEN 3
       WHEN 'yearly' THEN 4
       ELSE 5
     END, t.name`,
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

/** Compare and write the confirmed financial snapshot in a single SQLite statement. */
export async function saveTaskFinance(
  db: Database,
  item: MonthlyStatusWithDetails,
  change: FinancialChange
): Promise<void> {
  const before = financialValues(item);
  const after = applyFinancialChange(before, change);
  const complete = change.kind === "collect" && change.complete;
  const correction = change.kind === "correction"
    ? JSON.stringify({ at: new Date().toISOString(), before, after })
    : null;
  const result = await db.execute(
    `INSERT INTO monthly_task_status
      (client_id, task_type_id, year, month, amount, is_paid, paid_at, is_invoiced, invoiced_at, status, completed_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9,
       CASE WHEN $10 THEN 'completed' ELSE 'pending' END, CASE WHEN $10 THEN datetime('now') END
     WHERE EXISTS (SELECT 1 FROM monthly_task_status WHERE id = $11 AND client_id=$1 AND task_type_id=$2 AND year=$3 AND month=$4)
        OR ($11 < 0 AND EXISTS (SELECT 1 FROM client_task_assignments WHERE id = -$11 AND client_id=$1 AND task_type_id=$2 AND is_active=1))
     ON CONFLICT(client_id,task_type_id,year,month) DO UPDATE SET
       amount=excluded.amount, is_paid=excluded.is_paid, paid_at=excluded.paid_at,
       is_invoiced=excluded.is_invoiced, invoiced_at=excluded.invoiced_at,
       status=CASE WHEN $10 THEN 'completed' ELSE status END,
       completed_at=CASE WHEN $10 THEN COALESCE(completed_at, excluded.completed_at) ELSE completed_at END,
       corrections_json=CASE WHEN $12 IS NULL THEN corrections_json
         ELSE json_insert(corrections_json, '$[#]', json($12)) END,
       updated_at=datetime('now')
     WHERE amount IS $13 AND is_paid=$14 AND paid_at IS $15 AND is_invoiced=$16 AND invoiced_at IS $17`,
    [item.clientId, item.taskTypeId, item.year, item.month, after.amount, Number(after.isPaid),
     after.paidAt, Number(after.isInvoiced), after.invoicedAt, Number(complete), item.id, correction,
     before.amount, Number(before.isPaid), before.paidAt, Number(before.isInvoiced), before.invoicedAt]
  );
  if (result.rowsAffected !== 1) throw Error("Η εγγραφή έχει αλλάξει. Ελέγξτε τα ενημερωμένα στοιχεία και δοκιμάστε ξανά.");
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
 * monthly always, quarterly in Jan/Apr/Jul/Oct, semiannual in Jan/Jul,
 * yearly in Jan.
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
         OR (a.periodicity = 'semiannual' AND (($2 - 1) % 6) = 0)
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
  const rows = await db.select<Array<{ clientId: number; taskTypeId: number; year: number; month: number }>>(
    `SELECT client_id AS clientId, task_type_id AS taskTypeId, year, month
     FROM monthly_task_status
     WHERE year = $1 AND status = 'completed' AND month IN (${placeholders})`,
    [year, ...months]
  );

  return new Set(rows.map((r) => `${r.clientId}:${r.taskTypeId}:${r.year}:${r.month}`));
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

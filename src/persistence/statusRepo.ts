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
    m.created_at  AS createdAt,
    m.updated_at  AS updatedAt,
    c.name        AS clientName,
    t.name        AS taskName,
    t.color       AS taskColor
  FROM monthly_task_status m
  JOIN clients c    ON m.client_id = c.id
  JOIN task_types t ON m.task_type_id = t.id
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

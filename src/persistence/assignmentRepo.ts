import Database from "@tauri-apps/plugin-sql";
import type { ClientTaskAssignment, TaskType, Periodicity } from "../domain/types";
import { DUE_DAY_MIN, DUE_DAY_MAX, REMINDER_DAYS_MIN, REMINDER_DAYS_MAX } from "../domain/appConfig";
import { normalizeTasks } from "../utils/db";

// Joins return the assignment columns plus the task's display fields.
// All columns are aliased to camelCase to match the domain types.
const ASSIGNMENT_QUERY = `
  SELECT
    a.id,
    a.client_id      AS clientId,
    a.task_type_id   AS taskTypeId,
    (a.is_active = 1) AS isActive,
    a.start_date     AS startDate,
    a.end_date       AS endDate,
    a.periodicity    AS periodicity,
    a.due_day        AS dueDay,
    a.reminder_days  AS reminderDays,
    a.created_at     AS createdAt,
    a.updated_at     AS updatedAt,
    c.name           AS clientName,
    t.name           AS taskName,
    t.description    AS taskDescription,
    t.color          AS taskColor,
    (t.is_active = 1) AS taskIsActive
  FROM client_task_assignments a
  JOIN task_types t ON a.task_type_id = t.id
  JOIN clients c    ON a.client_id = c.id
`;

export interface ClientTaskWithTask extends ClientTaskAssignment {
  clientName: string;
  taskName: string;
  taskDescription: string | null;
  taskColor: string;
  taskIsActive: boolean;
}

export async function getAssignmentsByClient(
  db: Database,
  clientId: number
): Promise<ClientTaskWithTask[]> {
  return db.select<ClientTaskWithTask[]>(
    `${ASSIGNMENT_QUERY} WHERE a.client_id = $1 ORDER BY t.name`,
    [clientId]
  );
}

export async function getAllActiveAssignments(
  db: Database
): Promise<ClientTaskWithTask[]> {
  return db.select<ClientTaskWithTask[]>(
    `${ASSIGNMENT_QUERY} WHERE a.is_active = 1 ORDER BY c.name, t.name`
  );
}

export interface AssignmentSchedule {
  periodicity: Periodicity;
  dueDay: number;
  reminderDays: number;
}

const DEFAULTS: AssignmentSchedule = {
  periodicity: "monthly",
  dueDay: 28,
  reminderDays: 5,
};

/** Keeps only values a person could have meant, falling back to the defaults. */
export function normalizeSchedule(partial?: Partial<AssignmentSchedule>): AssignmentSchedule {
  const periodicity: Periodicity =
    partial?.periodicity === "quarterly" || partial?.periodicity === "yearly" || partial?.periodicity === "monthly"
      ? partial.periodicity
      : DEFAULTS.periodicity;

  const dueDay = Number(partial?.dueDay);
  const reminderDays = Number(partial?.reminderDays);

  // 0 is a valid choice for reminderDays ("warn me on the day itself"), so the
  // range checks must be explicit rather than relying on truthiness.
  //
  // These are the same bounds the form offers, and they used to be a second
  // copy of those numbers - which meant the form could accept something this
  // normaliser would quietly fall back from.
  const validDueDay =
    Number.isFinite(dueDay) && dueDay >= DUE_DAY_MIN && dueDay <= DUE_DAY_MAX;
  const validReminder =
    Number.isFinite(reminderDays) &&
    reminderDays >= REMINDER_DAYS_MIN &&
    reminderDays <= REMINDER_DAYS_MAX;

  return {
    periodicity,
    dueDay: validDueDay ? Math.trunc(dueDay) : DEFAULTS.dueDay,
    reminderDays: validReminder ? Math.trunc(reminderDays) : DEFAULTS.reminderDays,
  };
}

export async function createAssignment(
  db: Database,
  clientId: number,
  taskTypeId: number,
  startDate: string,
  schedule?: Partial<AssignmentSchedule>
): Promise<number> {
  const s = normalizeSchedule(schedule);
  const result = await db.execute(
    `INSERT INTO client_task_assignments
       (client_id, task_type_id, start_date, periodicity, due_day, reminder_days)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [clientId, taskTypeId, startDate, s.periodicity, s.dueDay, s.reminderDays]
  );
  return result.lastInsertId ?? 0;
}

export async function updateAssignmentSchedule(
  db: Database,
  id: number,
  schedule: Partial<AssignmentSchedule>
): Promise<void> {
  const s = normalizeSchedule(schedule);
  await db.execute(
    `UPDATE client_task_assignments SET
       periodicity = $1, due_day = $2, reminder_days = $3,
       updated_at = datetime('now')
     WHERE id = $4`,
    [s.periodicity, s.dueDay, s.reminderDays, id]
  );
}

export async function deactivateAssignment(db: Database, id: number): Promise<void> {
  await db.execute(
    "UPDATE client_task_assignments SET is_active = 0, updated_at = datetime('now') WHERE id = $1",
    [id]
  );
}

export async function activateAssignment(db: Database, id: number): Promise<void> {
  await db.execute(
    "UPDATE client_task_assignments SET is_active = 1, updated_at = datetime('now') WHERE id = $1",
    [id]
  );
}

export async function deleteAssignment(db: Database, id: number): Promise<void> {
  await db.execute("DELETE FROM client_task_assignments WHERE id = $1", [id]);
}

export async function hasActiveAssignment(
  db: Database,
  clientId: number,
  taskTypeId: number
): Promise<boolean> {
  const results = await db.select<Array<{ count: number }>>(
    "SELECT COUNT(*) as count FROM client_task_assignments WHERE client_id = $1 AND task_type_id = $2 AND is_active = 1",
    [clientId, taskTypeId]
  );
  return results[0]?.count > 0;
}

/** Active tasks for a client, used to seed the monthly status rows. */
export async function getTaskTypesForClient(
  db: Database,
  clientId: number
): Promise<TaskType[]> {
  return db.select<TaskType[]>(
    `SELECT t.id, t.name, t.description, t.color,
            t.is_active AS isActive,
            t.created_at AS createdAt, t.updated_at AS updatedAt
     FROM client_task_assignments a
     JOIN task_types t ON a.task_type_id = t.id
     WHERE a.client_id = $1 AND a.is_active = 1
     ORDER BY t.name`,
    [clientId]
  ).then(normalizeTasks);
}

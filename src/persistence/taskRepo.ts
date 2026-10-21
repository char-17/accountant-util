import Database from "@tauri-apps/plugin-sql";
import type { TaskType } from "../domain/types";
import { normalizeTasks } from "../utils/db";
import { foldGreek } from "../utils/greek";

/**
 * What a task is currently attached to, for the delete confirmation.
 *
 * `clients` counts assignments - who has this work. `history` counts rows in
 * monthly_task_status - how much recorded work carries this task's name. The two
 * are not the same: a task can have months of history and no assignments left.
 */
export interface TaskUsage {
  clients: number;
  history: number;
}

// SQLite returns columns in snake_case (is_active, created_at) and drivers are
// inconsistent about typing booleans, so rows are normalised in JS instead of
// relying on SQL casts. See normalizeTask in utils/db.ts.
const TASK_COLUMNS = `  id,
  name,
  description,
  color,
  is_active AS isActive,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

export async function getAllTaskTypes(db: Database): Promise<TaskType[]> {
  return normalizeTasks(await db.select<TaskType[]>(`SELECT ${TASK_COLUMNS} FROM task_types ORDER BY name`));
}

export async function getActiveTaskTypes(db: Database): Promise<TaskType[]> {
  return normalizeTasks(
    await db.select<TaskType[]>(`SELECT ${TASK_COLUMNS} FROM task_types WHERE is_active = 1 ORDER BY name`)
  );
}

export async function getTaskTypeById(db: Database, id: number): Promise<TaskType | null> {
  const results = normalizeTasks(
    await db.select<TaskType[]>(`SELECT ${TASK_COLUMNS} FROM task_types WHERE id = $1`, [id])
  );
  return results[0] ?? null;
}

export async function createTaskType(
  db: Database,
  data: Pick<TaskType, "name" | "color" | "description">
): Promise<number> {
  // color is NOT NULL in the schema; callers may pass an empty string from a form,
  // so fall back to a valid palette value instead of letting the INSERT fail.
  const color = data.color?.trim() || "#8B9DAD";
  const description = data.description?.trim() || null;

  const result = await db.execute(
    "INSERT INTO task_types (name, color, description) VALUES ($1, $2, $3)",
    [data.name.trim(), color, description]
  );
  return result.lastInsertId ?? 0;
}

export async function updateTaskType(
  db: Database,
  id: number,
  data: Partial<Pick<TaskType, "name" | "color" | "description" | "isActive">>
): Promise<void> {
  const name = data.name?.trim();
  const color = data.color?.trim();
  const description = data.description === undefined ? undefined : data.description.trim() || null;

  await db.execute(
    `UPDATE task_types SET
       name = COALESCE($1, name),
       color = COALESCE($2, color),
       description = COALESCE($3, description),
       is_active = COALESCE($4, is_active),
       updated_at = datetime('now')
     WHERE id = $5`,
    [name || null, color || null, description ?? null, data.isActive === undefined ? null : data.isActive ? 1 : 0, id]
  );
}

export async function deleteTaskType(db: Database, id: number): Promise<void> {
  await db.execute("DELETE FROM task_types WHERE id = $1", [id]);
}

export async function getUsedColors(db: Database): Promise<string[]> {
  const results = await db.select<Array<{ color: string }>>(
    "SELECT DISTINCT color FROM task_types WHERE is_active = 1"
  );
  return results.map((r) => r.color);
}

/**
 * How many clients each task is assigned to, keyed by task id.
 *
 * Asked of the database so the delete confirmation can say what it is about to
 * detach. A task carries history as well as assignments - deleting one leaves
 * the month's rows pointing at a task that no longer exists, which is why the
 * confirmation names both numbers rather than just the client count.
 *
 * Assignments and month rows are counted separately because they answer
 * different questions: "who does this work for" versus "how much recorded work
 * would lose its label".
 */
export async function getTaskUsage(db: Database): Promise<Record<number, TaskUsage>> {
  const assignments = await db.select<Array<{ taskTypeId: number; count: number }>>(
    `SELECT task_type_id AS taskTypeId, COUNT(*) as count
       FROM client_task_assignments
      GROUP BY task_type_id`
  );
  const months = await db.select<Array<{ taskTypeId: number; count: number }>>(
    `SELECT task_type_id AS taskTypeId, COUNT(*) as count
       FROM monthly_task_status
      GROUP BY task_type_id`
  );
  const total = (rows: Array<{ taskTypeId: number; count: number }>) =>
    rows.reduce<Record<number, number>>((acc, r) => {
      acc[r.taskTypeId] = r.count;
      return acc;
    }, {});
  const clients = total(assignments);
  const history = total(months);
  const out: Record<number, TaskUsage> = {};
  for (const id of new Set([...Object.keys(clients), ...Object.keys(history)])) {
    out[Number(id)] = {
      clients: clients[Number(id)] ?? 0,
      history: history[Number(id)] ?? 0,
    };
  }
  return out;
}

export async function isColorUsed(
  db: Database,
  color: string,
  excludeId?: number
): Promise<boolean> {
  const results = await db.select<Array<{ count: number }>>(
    "SELECT COUNT(*) as count FROM task_types WHERE color = $1 AND is_active = 1 AND id != $2",
    [color, excludeId ?? -1]
  );
  return results[0]?.count > 0;
}

/**
 * Whether another task already holds this name.
 *
 * Folded in JS rather than compared in SQL: SQLite's `=` folds ASCII only, so
 * "Μισθοδοσία" and "ΜΙΣΘΟΔΟΣΙΑ" would both be accepted and then sit next to each
 * other in the catalogue, indistinguishable. Same reasoning as the client
 * search - see the comment in clientRepo.clientNameExists.
 */
export async function taskNameExists(
  db: Database,
  name: string,
  excludeId?: number
): Promise<boolean> {
  const results = await db.select<Array<{ id: number; name: string }>>(
    "SELECT id, name FROM task_types WHERE id != $1",
    [excludeId ?? -1]
  );
  const target = foldGreek(name);
  return results.some((row) => foldGreek(row.name) === target);
}

export async function bulkInsertTaskTypes(
  db: Database,
  tasks: Array<Pick<TaskType, "name" | "color" | "description">>
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  // Names read once, for the same reason as in bulkInsertClients: the fold
  // happens in JS, so asking the question per task would re-read the table.
  const existing = new Set(
    (await db.select<Array<{ name: string }>>("SELECT name FROM task_types")).map((r) =>
      foldGreek(r.name)
    )
  );

  for (const task of tasks) {
    if (existing.has(foldGreek(task.name))) {
      skipped++;
      continue;
    }
    try {
      await createTaskType(db, task);
      existing.add(foldGreek(task.name));
      inserted++;
    } catch {
      skipped++;
    }
  }

  return { inserted, skipped };
}

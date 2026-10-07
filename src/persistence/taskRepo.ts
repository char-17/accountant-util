import Database from "@tauri-apps/plugin-sql";
import type { TaskType } from "../domain/types";
import { normalizeTasks } from "../utils/db";

// SQLite returns columns in snake_case (is_active, created_at) and drivers are
// inconsistent about typing booleans, so rows are normalised in JS instead of
// relying on SQL casts. See normalizeTask in utils/db.ts.
const TASK_COLUMNS = `
  id,
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

export async function taskNameExists(
  db: Database,
  name: string,
  excludeId?: number
): Promise<boolean> {
  const results = await db.select<Array<{ count: number }>>(
    "SELECT COUNT(*) as count FROM task_types WHERE name = $1 AND id != $2",
    [name.trim(), excludeId ?? -1]
  );
  return results[0]?.count > 0;
}

export async function bulkInsertTaskTypes(
  db: Database,
  tasks: Array<Pick<TaskType, "name" | "color" | "description">>
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const task of tasks) {
    const exists = await taskNameExists(db, task.name);
    if (exists) {
      skipped++;
      continue;
    }
    try {
      await createTaskType(db, task);
      inserted++;
    } catch {
      skipped++;
    }
  }

  return { inserted, skipped };
}

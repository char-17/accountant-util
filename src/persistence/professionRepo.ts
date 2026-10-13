import Database from "@tauri-apps/plugin-sql";
import type { Profession } from "../domain/types";

// Same shape as taskRepo: snake_case columns aliased to camelCase, and booleans
// normalised in JS because drivers disagree about typing them.
const PROFESSION_COLUMNS = `
  id,
  name,
  description,
  is_active AS isActive,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

const toBool = (v: unknown): boolean => v === 1 || v === true || v === "1";

const normalize = (rows: Array<Record<string, unknown>>): Profession[] =>
  rows.map((r) => ({
    ...(r as unknown as Profession),
    isActive: toBool(r.isActive),
  }));

export async function getAllProfessions(db: Database): Promise<Profession[]> {
  return normalize(await db.select<Array<Record<string, unknown>>>(
    `SELECT ${PROFESSION_COLUMNS} FROM professions ORDER BY name`
  ));
}

export async function getActiveProfessions(db: Database): Promise<Profession[]> {
  return normalize(await db.select<Array<Record<string, unknown>>>(
    `SELECT ${PROFESSION_COLUMNS} FROM professions WHERE is_active = 1 ORDER BY name`
  ));
}

export async function createProfession(
  db: Database,
  data: Pick<Profession, "name" | "description">
): Promise<number> {
  const result = await db.execute(
    "INSERT INTO professions (name, description) VALUES ($1, $2)",
    [data.name.trim(), data.description?.trim() || null]
  );
  return result.lastInsertId ?? 0;
}

export async function updateProfession(
  db: Database,
  id: number,
  data: Partial<Pick<Profession, "name" | "description" | "isActive">>
): Promise<void> {
  const name = data.name?.trim();
  // null and "" both mean "no description": the textarea hands back an empty
  // string, and the row's own null means it was never set. Both clear it.
  const description =
    data.description === undefined ? undefined : data.description?.trim() || null;

  await db.execute(
    `UPDATE professions SET
       name = COALESCE($1, name),
       description = COALESCE($2, description),
       is_active = COALESCE($3, is_active),
       updated_at = datetime('now')
     WHERE id = $4`,
    [
      name || null,
      description ?? null,
      data.isActive === undefined ? null : data.isActive ? 1 : 0,
      id,
    ]
  );
}

/**
 * Deletes a profession, but first detaches it from any client using it.
 *
 * The column has no ON DELETE SET NULL: SQLite only honours that with the
 * foreign_keys pragma enabled, and the app does not rely on it. Left alone, a
 * client would keep an id pointing at a row that no longer exists, and the
 * profession filter would silently match nothing for them. Deactivating is the
 * softer option and is offered next to this in the UI.
 */
export async function deleteProfession(db: Database, id: number): Promise<void> {
  await db.execute("UPDATE clients SET profession_id = NULL WHERE profession_id = $1", [id]);
  await db.execute("DELETE FROM professions WHERE id = $1", [id]);
}

export async function professionNameExists(
  db: Database,
  name: string,
  excludeId?: number
): Promise<boolean> {
  const rows = await db.select<Array<{ count: number }>>(
    "SELECT COUNT(*) as count FROM professions WHERE name = $1 AND id != $2",
    [name.trim(), excludeId ?? -1]
  );
  return rows[0]?.count > 0;
}

/** How many clients carry this profession, so the UI can say what it detaches. */
export async function countClientsWithProfession(
  db: Database,
  id: number
): Promise<number> {
  const rows = await db.select<Array<{ count: number }>>(
    "SELECT COUNT(*) as count FROM clients WHERE profession_id = $1",
    [id]
  );
  return rows[0]?.count ?? 0;
}

/**
 * The same count for every profession, keyed by id.
 *
 * Asked of the database rather than counted off the client list in memory: that
 * list is what the search box filters, so while a search is typed it holds a
 * subset, and a delete confirmation built from it would understate how many
 * clients it is about to detach.
 */
export async function getProfessionClientCounts(
  db: Database
): Promise<Record<number, number>> {
  const rows = await db.select<Array<{ professionId: number; count: number }>>(
    `SELECT profession_id AS professionId, COUNT(*) as count
       FROM clients
      WHERE profession_id IS NOT NULL
      GROUP BY profession_id`
  );
  return Object.fromEntries(rows.map((r) => [r.professionId, r.count]));
}

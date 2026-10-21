import Database from "@tauri-apps/plugin-sql";
import type { Client } from "../domain/types";
import { foldGreek } from "../utils/greek";

// See taskRepo.ts: SQLite columns are snake_case, domain types are camelCase.
const CLIENT_COLUMNS = `
  id,
  name,
  profession_id AS professionId,
  tax_id AS taxId,
  notes,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

export async function getAllClients(db: Database): Promise<Client[]> {
  return db.select<Client[]>(`SELECT ${CLIENT_COLUMNS} FROM clients ORDER BY name`);
}

// There is deliberately no searchClients. It used to be a `name LIKE '%term%'`,
// and SQLite's LIKE folds case for ASCII only - "%ΟΣ%" matched while "%ος%"
// matched nothing at all - so a Greek name could not be searched for at all.
// Neither lower() nor LIKE can be taught Greek here, and a column kept folded
// would have to be written and migrated to stay in step. The caller folds in JS
// instead; see utils/greek.ts and the comment in useClients.

export async function getClientById(db: Database, id: number): Promise<Client | null> {
  const results = await db.select<Client[]>(
    `SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = $1`,
    [id]
  );
  return results[0] ?? null;
}

export async function createClient(
  db: Database,
  data: Omit<Client, "id" | "createdAt" | "updatedAt">
): Promise<number> {
  const result = await db.execute(
    `INSERT INTO clients (name, profession_id, tax_id, notes)
     VALUES ($1, $2, $3, $4)`,
    [
      data.name.trim(),
      data.professionId ?? null,
      data.taxId?.trim() || null,
      data.notes?.trim() || null,
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function updateClient(
  db: Database,
  id: number,
  data: Partial<Omit<Client, "id" | "createdAt" | "updatedAt">>
): Promise<void> {
  await db.execute(
    `UPDATE clients SET
       name = COALESCE($1, name),
       tax_id = COALESCE($3, tax_id),
       notes = COALESCE($4, notes),
       -- Assigned through a flag rather than COALESCE: clearing a client's
       -- profession is a real action, and COALESCE would read null as "leave
       -- it alone", so the field could never be emptied. $6 says whether the
       -- caller mentioned the field at all.
       profession_id = CASE WHEN $6 = 1 THEN $2 ELSE profession_id END,
       updated_at = datetime('now')
     WHERE id = $5`,
    [
      data.name?.trim() || null,
      data.professionId ?? null,
      data.taxId === undefined ? null : data.taxId?.trim() || null,
      data.notes === undefined ? null : data.notes?.trim() || null,
      id,
      data.professionId === undefined ? 0 : 1,
    ]
  );
}

export async function deleteClient(db: Database, id: number): Promise<void> {
  await db.execute("DELETE FROM clients WHERE id = $1", [id]);
}

/**
 * Whether another client already holds this name.
 *
 * Compared in JS through foldGreek rather than in SQL. SQLite folds case for
 * ASCII only, so `name = 'Μισθοδοσία'` finds a row stored as exactly that and
 * nothing else - an accountant typing the same name a different way would be
 * handed a second client that looks identical in the list. The table holds
 * dozens of rows, so reading it costs one query, the same as the COUNT this
 * replaced.
 */
export async function clientNameExists(
  db: Database,
  name: string,
  excludeId?: number
): Promise<boolean> {
  const results = await db.select<Array<{ id: number; name: string }>>(
    "SELECT id, name FROM clients WHERE id != $1",
    [excludeId ?? -1]
  );
  const target = foldGreek(name);
  return results.some((row) => foldGreek(row.name) === target);
}

export async function bulkInsertClients(
  db: Database,
  clients: Array<Omit<Client, "id" | "createdAt" | "updatedAt">>
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  // Read the names once. clientNameExists loads the list itself, and calling it
  // from here per client would re-read the same rows n times over.
  const existing = new Set(
    (await db.select<Array<{ name: string }>>("SELECT name FROM clients")).map((r) =>
      foldGreek(r.name)
    )
  );

  for (const client of clients) {
    if (existing.has(foldGreek(client.name))) {
      skipped++;
      continue;
    }
    try {
      // The set is updated too, so two spellings of one name inside the same
      // batch are caught as well - the database has no such constraint to fall
      // back on.
      await createClient(db, client);
      existing.add(foldGreek(client.name));
      inserted++;
    } catch {
      skipped++;
    }
  }

  return { inserted, skipped };
}

import Database from "@tauri-apps/plugin-sql";
import type { Client } from "../domain/types";

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

export async function searchClients(db: Database, query: string): Promise<Client[]> {
  // The name is the only thing left to match on. It used to also search the
  // email and phone columns, which is why this is worth noting: the search box
  // no longer finds a client by any field but their name.
  return db.select<Client[]>(
    `SELECT ${CLIENT_COLUMNS} FROM clients
     WHERE name LIKE $1
     ORDER BY name`,
    [`%${query}%`]
  );
}

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

export async function clientNameExists(
  db: Database,
  name: string,
  excludeId?: number
): Promise<boolean> {
  const results = await db.select<Array<{ count: number }>>(
    "SELECT COUNT(*) as count FROM clients WHERE name = $1 AND id != $2",
    [name.trim(), excludeId ?? -1]
  );
  return results[0]?.count > 0;
}

export async function bulkInsertClients(
  db: Database,
  clients: Array<Omit<Client, "id" | "createdAt" | "updatedAt">>
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  for (const client of clients) {
    if (await clientNameExists(db, client.name)) {
      skipped++;
      continue;
    }
    try {
      await createClient(db, client);
      inserted++;
    } catch {
      skipped++;
    }
  }

  return { inserted, skipped };
}

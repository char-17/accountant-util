import { useState, useEffect, useCallback, useMemo } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { Client } from "../domain/types";
import * as clientRepo from "../persistence/clientRepo";
import { greekIncludes } from "../utils/greek";
import { toMessage } from "../utils/errors";

export type ClientInput = Omit<Client, "id" | "createdAt" | "updatedAt">;

export function useClients(db: Database | null) {
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const loadClients = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      // Every client, once. The search used to be a LIKE per keystroke, which
      // cannot be made to work for Greek at all - SQLite folds case for ASCII
      // only, so "%ΟΣ%" matched while "%ος%" found nothing - and re-queried the
      // whole table on every character typed. Filtering the loaded list through
      // foldGreek fixes the matching and drops the round trips with it.
      setAllClients(await clientRepo.getAllClients(db));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  // The name is the only thing matched on. It used to also match the email and
  // phone columns, which is worth remembering now that the search is here:
  // neither of those fields exists any more.
  const clients = useMemo(
    () =>
      searchQuery.trim() === ""
        ? allClients
        : allClients.filter((c) => greekIncludes(c.name, searchQuery)),
    [allClients, searchQuery]
  );

  /** Returns the new client's id, or throws with a readable message. */
  const createClient = async (data: ClientInput): Promise<number> => {
    if (!db) throw new Error("Η βάση δεδομένων δεν είναι έτοιμη.");
    if (await clientRepo.clientNameExists(db, data.name)) {
      throw new Error("Υπάρχει ήδη πελάτης με αυτό το όνομα.");
    }
    const id = await clientRepo.createClient(db, data);
    await loadClients();
    return id;
  };

  const updateClient = async (id: number, data: Partial<ClientInput>): Promise<void> => {
    if (!db) throw new Error("Η βάση δεδομένων δεν είναι έτοιμη.");
    if (data.name && (await clientRepo.clientNameExists(db, data.name, id))) {
      throw new Error("Υπάρχει ήδη πελάτης με αυτό το όνομα.");
    }
    await clientRepo.updateClient(db, id, data);
    await loadClients();
  };

  const deleteClient = async (id: number): Promise<void> => {
    if (!db) throw new Error("Η βάση δεδομένων δεν είναι έτοιμη.");
    await clientRepo.deleteClient(db, id);
    await loadClients();
  };

  return {
    clients,
    loading,
    searchQuery,
    setSearchQuery,
    createClient,
    updateClient,
    deleteClient,
    refresh: loadClients,
    toMessage,
  };
}

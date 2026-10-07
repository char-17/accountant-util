import { useState, useEffect, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { Client } from "../domain/types";
import * as clientRepo from "../persistence/clientRepo";
import { toMessage } from "../utils/errors";

export type ClientInput = Omit<Client, "id" | "createdAt" | "updatedAt">;

export function useClients(db: Database | null) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const loadClients = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const result = searchQuery
        ? await clientRepo.searchClients(db, searchQuery)
        : await clientRepo.getAllClients(db);
      setClients(result);
    } finally {
      setLoading(false);
    }
  }, [db, searchQuery]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

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

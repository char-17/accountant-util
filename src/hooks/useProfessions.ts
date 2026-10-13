import { useState, useEffect, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { Profession } from "../domain/types";
import * as professionRepo from "../persistence/professionRepo";
import { toMessage } from "../utils/errors";

export interface ProfessionInput {
  name: string;
  description?: string | null;
}

/**
 * The profession list. Mirrors useClients: the rows live here, every mutation
 * refreshes them, and the failure is surfaced rather than swallowed so a bad
 * write does not leave the list quietly out of date.
 */
export function useProfessions(db: Database | null) {
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [clientCounts, setClientCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProfessions = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      setProfessions(await professionRepo.getAllProfessions(db));
      setClientCounts(await professionRepo.getProfessionClientCounts(db));
      setError("");
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    void loadProfessions();
  }, [loadProfessions]);

  const createProfession = async (data: ProfessionInput): Promise<number> => {
    if (!db) return 0;
    const id = await professionRepo.createProfession(db, data);
    await loadProfessions();
    return id;
  };

  const updateProfession = async (
    id: number,
    data: Partial<ProfessionInput> & { isActive?: boolean }
  ): Promise<void> => {
    if (!db) return;
    await professionRepo.updateProfession(db, id, data);
    await loadProfessions();
  };

  /**
   * Deleting detaches the profession from any client using it, so the clients
   * are read back afterwards: the month totals and the profession filter both
   * read through this list.
   */
  const deleteProfession = async (id: number): Promise<void> => {
    if (!db) return;
    await professionRepo.deleteProfession(db, id);
    await loadProfessions();
  };

  return {
    professions,
    clientCounts,
    loading,
    error,
    refresh: loadProfessions,
    createProfession,
    updateProfession,
    deleteProfession,
  };
}

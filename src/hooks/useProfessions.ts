import { useState, useEffect, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { Profession } from "../domain/types";
import * as professionRepo from "../persistence/professionRepo";
import { getAvailableColor } from "../utils/colors";
import { toMessage, DUPLICATE_PROFESSION } from "../utils/errors";

export interface ProfessionInput {
  name: string;
  description?: string | null;
  color: string;
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
    // Folded comparison rather than the UNIQUE index alone: see the same check
    // in useTasks, and the reason in professionNameExists.
    if (await professionRepo.professionNameExists(db, data.name)) {
      throw new Error(DUPLICATE_PROFESSION);
    }
    const id = await professionRepo.createProfession(db, data);
    await loadProfessions();
    return id;
  };

  const updateProfession = async (
    id: number,
    data: Partial<ProfessionInput> & { isActive?: boolean }
  ): Promise<void> => {
    if (!db) return;
    // Only when a name was sent: updateProfession reads an absent name as
    // "leave it alone", and checking one that is not changing would reject a
    // colour change on the row's own name.
    if (data.name && (await professionRepo.professionNameExists(db, data.name, id))) {
      throw new Error(DUPLICATE_PROFESSION);
    }
    await professionRepo.updateProfession(db, id, data);
    await loadProfessions();
  };

  /**
   * The first palette colour no other active profession is using.
   *
   * Asked of the database rather than counted off the loaded list, so a colour
   * suggested for the new row is not the same one the row being typed already
   * has - which would otherwise happen every time a profession was renamed.
   */
  const suggestColor = async (): Promise<string> => {
    if (!db) return getAvailableColor([]);
    return getAvailableColor(await professionRepo.getUsedProfessionColors(db));
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
    suggestColor,
  };
}

import { useState, useEffect, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import * as statusRepo from "../persistence/statusRepo";

interface UseCompletedKeysResult {
  /** "clientId:taskTypeId:month" for every completed task in the given months. */
  keys: Set<string>;
  refresh: () => void;
}

/**
 * Which client/task/month triples are already done, for the months a reminder
 * can point at.
 *
 * Reminders are computed from assignments and deadlines, which have no idea
 * whether the accountant already did the work. Without this the same finished
 * task would keep appearing as overdue until the assignment itself was closed.
 */
export function useCompletedKeys(
  db: Database | null,
  year: number,
  months: number[]
): UseCompletedKeysResult {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0);

  // The months arrive as a new array each render, so the list is joined into a
  // stable key instead of being used as a dependency directly.
  const monthKey = [...months].sort((a, b) => a - b).join(",");

  const load = useCallback(async () => {
    if (!db) return;
    const list = monthKey === "" ? [] : monthKey.split(",").map(Number);
    setKeys(await statusRepo.getCompletedKeys(db, year, list));
  }, [db, year, monthKey]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  return { keys, refresh: () => setNonce((n) => n + 1) };
}
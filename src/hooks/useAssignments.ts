import { useState, useEffect, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { ClientTaskWithTask } from "../persistence/assignmentRepo";
import * as assignmentRepo from "../persistence/assignmentRepo";

export function useAssignments(db: Database | null) {
  const [assignments, setAssignments] = useState<ClientTaskWithTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      setAssignments(await assignmentRepo.getAllActiveAssignments(db));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    load();
  }, [load]);

  return { assignments, loading, refresh: load };
}

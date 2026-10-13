import { useState, useEffect, useCallback } from "react";
import Database from "@tauri-apps/plugin-sql";
import type { TaskType } from "../domain/types";
import * as taskRepo from "../persistence/taskRepo";
import type { TaskUsage } from "../persistence/taskRepo";
import { getAvailableColor } from "../utils/colors";

export function useTasks(db: Database | null) {
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [usage, setUsage] = useState<Record<number, TaskUsage>>({});
  const [loading, setLoading] = useState(true);

  const loadTasks = useCallback(async () => {
    if (!db) return;
    setLoading(true);
    try {
      const result = await taskRepo.getAllTaskTypes(db);
      setTasks(result);
      // Reloaded with the list rather than on demand: a delete confirmation has
      // to be able to say what is attached at the moment it is opened, and the
      // numbers go stale as soon as anyone adds an assignment elsewhere.
      setUsage(await taskRepo.getTaskUsage(db));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const createTask = async (data: Pick<TaskType, "name" | "color" | "description">) => {
    if (!db) return;
    await taskRepo.createTaskType(db, data);
    await loadTasks();
  };

  const updateTask = async (id: number, data: Partial<TaskType>) => {
    if (!db) return;
    await taskRepo.updateTaskType(db, id, data);
    await loadTasks();
  };

  const deleteTask = async (id: number) => {
    if (!db) return;
    await taskRepo.deleteTaskType(db, id);
    await loadTasks();
  };

  const suggestColor = async (): Promise<string> => {
    if (!db) return getAvailableColor([]);
    const usedColors = await taskRepo.getUsedColors(db);
    return getAvailableColor(usedColors);
  };

  return {
    tasks,
    usage,
    loading,
    createTask,
    updateTask,
    deleteTask,
    suggestColor,
    refresh: loadTasks,
  };
}

// ─── Domain Types ────────────────────────────────────────────────────────────

import type { Periodicity } from "./recurrence";

export type { Periodicity };

export interface Client {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string; // ΑΦΜ
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskType {
  id: number;
  name: string;
  description?: string;
  color: string; // hex color from muted palette
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientTaskAssignment {
  id: number;
  clientId: number;
  taskTypeId: number;
  isActive: boolean;
  startDate: string; // ISO date
  endDate?: string; // optional end date
  /** How often the task recurs. Defaults to monthly for older rows. */
  periodicity: Periodicity;
  /** Day of month the task falls due (1-31, clamped to the month's length). */
  dueDay: number;
  /** How many days before the deadline the reminder should appear. */
  reminderDays: number;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = "pending" | "completed";

export interface MonthlyTaskStatus {
  id: number;
  clientId: number;
  taskTypeId: number;
  year: number;
  month: number; // 1-12
  status: TaskStatus;
  completedAt?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── View Models ─────────────────────────────────────────────────────────────

export interface ClientWithTasks extends Client {
  assignments: ClientTaskAssignmentWithTask[];
}

export interface ClientTaskAssignmentWithTask extends ClientTaskAssignment {
  taskType: TaskType;
}

export interface MonthlyStatusWithDetails extends MonthlyTaskStatus {
  clientName: string;
  taskName: string;
  taskColor: string;
}

export interface MonthlySummary {
  year: number;
  month: number;
  totalClients: number;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  clientProgress: ClientProgress[];
}

export interface ClientProgress {
  clientId: number;
  clientName: string;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  isComplete: boolean;
}

// ─── Excel Import Types ──────────────────────────────────────────────────────

export interface ExcelImportPreview {
  clients: ParsedClient[];
  tasks: ParsedTask[];
  errors: ImportError[];
}

export interface ParsedClient {
  row: number;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  taxId?: string;
  notes?: string;
}

export interface ParsedTask {
  row: number;
  name: string;
  description?: string;
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
}

export interface ImportResult {
  clientsImported: number;
  tasksImported: number;
  duplicatesSkipped: number;
  errors: ImportError[];
}

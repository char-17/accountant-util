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
  /** Fee the accountant entered for this month's work. Null until they set one. */
  amount?: number;
  /** True once the fee has been collected. Implies `amount` is present. */
  isPaid: boolean;
  /** The date the accountant recorded for the collection. */
  paidAt?: string;
  /** True once an invoice has been issued for this work. */
  isInvoiced: boolean;
  /** The date the invoice was issued. */
  invoicedAt?: string;
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

// ─── Reports ─────────────────────────────────────────────────────────────────

/** Which span of months a report covers. */
export type ReportPeriod = "month" | "quarter" | "year" | "custom";

export interface ReportRange {
  year: number;
  /** Inclusive first month, 1-12. */
  fromMonth: number;
  /** Inclusive last month, 1-12. */
  toMonth: number;
}

/** One task row inside a report, already grouped under its client. */
export interface ReportServiceRow {
  key: string;
  taskName: string;
  taskColor: string;
  year: number;
  month: number;
  isPaid: boolean;
  isInvoiced: boolean;
  amount: number;
  paidAt?: string;
  invoicedAt?: string;
}

/** A client with their services underneath, in report order. */
export interface ReportClientGroup {
  clientId: number;
  clientName: string;
  rows: ReportServiceRow[];
  totalAmount: number;
  paidAmount: number;
  invoicedAmount: number;
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



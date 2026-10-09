import type { Client, TaskType, ClientTaskAssignment, MonthlyTaskStatus } from "./types";

// ─── Validation Rules ────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

export function validateClient(client: Partial<Client>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!client.name?.trim()) {
    errors.push({ field: "name", message: "Το όνομα είναι υποχρεωτικό" });
  }

  return errors;
}

export function validateTaskType(task: Partial<TaskType>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!task.name?.trim()) {
    errors.push({ field: "name", message: "Το όνομα εργασίας είναι υποχρεωτικό" });
  }

  if (task.color && !isValidColor(task.color)) {
    errors.push({ field: "color", message: "Μη έγκυρο χρώμα" });
  }

  return errors;
}

export function validateAssignment(
  assignment: Partial<ClientTaskAssignment>
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!assignment.clientId) {
    errors.push({ field: "clientId", message: "Επιλέξτε πελάτη" });
  }

  if (!assignment.taskTypeId) {
    errors.push({ field: "taskTypeId", message: "Επιλέξτε εργασία" });
  }

  if (!assignment.startDate) {
    errors.push({ field: "startDate", message: "Η ημερομηνία έναρξης είναι υποχρεωτική" });
  }

  return errors;
}

export function validateMonthlyStatus(
  status: Partial<MonthlyTaskStatus>
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!status.clientId) {
    errors.push({ field: "clientId", message: "Επιλέξτε πελάτη" });
  }

  if (!status.taskTypeId) {
    errors.push({ field: "taskTypeId", message: "Επιλέξτε εργασία" });
  }

  if (!status.year || status.year < 2000 || status.year > 2100) {
    errors.push({ field: "year", message: "Μη έγκυρο έτος" });
  }

  if (!status.month || status.month < 1 || status.month > 12) {
    errors.push({ field: "month", message: "Μη έγκυρος μήνας" });
  }

  return errors;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

/**
 * Οι συνθήκες για την καταγραφή είσπραξης και τιμολογίου.
 *
 * Ο κανόνας είναι ένας: χωρίς ποσό δεν μπορεί να υπάρξει «Εισπραγμένο». Το ίδιο
 * εφαρμόζεται και στη φόρμα και στο repository, γιατί μια τιμή μπορεί να φτάσει
 * στη βάση και από άλλο δρόμο.
 */
export interface PaymentState {
  amount?: number | null;
  isPaid: boolean;
  isInvoiced: boolean;
}

export function validatePayment(state: PaymentState): ValidationError[] {
  const errors: ValidationError[] = [];

  if (state.isPaid && (state.amount === null || state.amount === undefined)) {
    errors.push({
      field: "amount",
      message: "Συμπληρώστε το ποσό για να σημειωθεί ως εισπραγμένο",
    });
  }

  if (state.amount !== null && state.amount !== undefined && state.amount < 0) {
    errors.push({ field: "amount", message: "Το ποσό δεν μπορεί να είναι αρνητικό" });
  }

  return errors;
}

// ─── Business Rules ──────────────────────────────────────────────────────────

/**
 * Νέες αντιστοιχίσεις εφαρμόζονται από τον τρέχοντα και επόμενους μήνες.
 * Δεν αλλάζει αναδρομικά το ιστορικό.
 */
export function shouldApplyToMonth(
  assignmentStartDate: string,
  targetYear: number,
  targetMonth: number
): boolean {
  const start = new Date(assignmentStartDate);
  const target = new Date(targetYear, targetMonth - 1, 1);
  const startMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  return target >= startMonth;
}

/**
 * Ο μήνας με εργασίες δημιουργείται από ενεργές αντιστοιχίσεις πελάτη–εργασιών.
 */
export function getActiveAssignmentsForMonth(
  assignments: ClientTaskAssignment[],
  year: number,
  month: number
): ClientTaskAssignment[] {
  return assignments.filter((a) => {
    if (!a.isActive) return false;
    return shouldApplyToMonth(a.startDate, year, month);
  });
}

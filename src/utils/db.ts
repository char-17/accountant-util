/**
 * SQLite has no boolean type. Depending on the driver, a boolean column comes
 * back as 1/0, true/false, or "1". These helpers normalise whatever arrives so
 * the rest of the app can rely on real booleans.
 */
export function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

/**
 * Normalises rows that carry an `isActive` field, preserving the caller's type.
 * The generic keeps the rest of the row's shape intact while guaranteeing a
 * real boolean, so callers keep their domain types (TaskType etc.).
 */
export function normalizeTasks<T>(rows: T[]): T[] {
  return rows.map((row) => {
    if (row === null || typeof row !== "object" || !("isActive" in row)) {
      return row;
    }
    return { ...row, isActive: toBool(row.isActive) } as T;
  });
}

/** Format a stored calendar day without converting it between time zones. */
export function displayDate(value?: string | null, empty = "—"): string {
  const iso = value?.slice(0, 10);
  if (!isCalendarDate(iso)) return empty;
  return iso.split("-").reverse().join("/");
}

export function isCalendarDate(value?: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(value + "T00:00:00Z");
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

export function parseDisplayDate(text: string): string | null {
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!parts) return null;
  const iso = [parts[3], parts[2], parts[1]].join("-");
  return isCalendarDate(iso) ? iso : null;
}

export const greekDateOptions = { day: "2-digit", month: "2-digit", year: "numeric" } as const;

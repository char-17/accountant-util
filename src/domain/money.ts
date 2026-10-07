/**
 * Money handling for the monthly report.
 *
 * Kept in the domain layer and free of any database or UI dependency so the
 * rounding and parsing rules can be tested on their own: floating point sums
 * must not leak "1234.5600000000001" into a report the accountant prints.
 */

/** Cents. Money is rounded to whole cents everywhere before it is stored. */
export function roundMoney(value: number): number {
  // Math.round on a scaled value avoids the drift a raw toFixed parse would
  // introduce for values like 0.145.
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Adds amounts without accumulating float error. */
export function sumMoney(values: Array<number | null | undefined>): number {
  const cents = values.reduce<number>(
    (acc, v) => acc + (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : 0),
    0
  );
  return cents / 100;
}

/**
 * Parses what the accountant typed into a number of euros.
 *
 * Returns null for anything that is not a usable amount, including the empty
 * string: "no amount entered" and "amount of zero" are different states, and
 * only the caller can decide which one the form means.
 */
export function parseAmount(input: string): number | null {
  const text = input.trim().replace(/\s/g, "");
  if (text === "") return null;

  // A comma is the decimal separator in the Greek locale, so both "1.234,56" and
  // "1234.56" have to be understood. A trailing comma ("120,") is what the field
  // holds while the cents are still being typed, and a leading dot (".5") is a
  // normal way to write a fraction, so both are accepted rather than rejected.
  const normalized = text.includes(",") && text.lastIndexOf(",") > text.lastIndexOf(".")
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/,/g, "");

  // One separator at most, and at least one digit somewhere: "12", "12.", "12,5"
  // and ".5" are all amounts in progress, "1.2.3" and "" are not.
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return roundMoney(value);
}

/** Formats an amount for display, e.g. 1234.5 -> "1.234,50 €". */
export function formatAmount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("el-GR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
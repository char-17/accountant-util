// ─── Muted Color Palette ─────────────────────────────────────────────────────
// Ήπια, χαμηλού κορεσμού χρώματα για εργασίες

export const MUTED_PALETTE: string[] = [
  "#7B8D6E", // sage green
  "#8B9DAD", // dusty blue
  "#C4A882", // warm sand
  "#A88FA8", // muted mauve
  "#7E9E9E", // teal gray
  "#B08968", // warm brown
  "#8D99AE", // slate blue
  "#A3B18A", // olive green
  "#BC6C25", // burnt orange
  "#6B705C", // olive gray
  "#9A8C98", // dusty purple
  "#7F9EB2", // steel blue
  "#B5838D", // dusty rose
  "#A26769", // muted brick
  "#6D8EA0", // ocean gray
  "#9C9583", // warm gray
];

export function getAvailableColor(usedColors: string[]): string {
  const available = MUTED_PALETTE.filter((c) => !usedColors.includes(c));
  if (available.length > 0) {
    return available[0];
  }
  // Αν χρησιμοποιηθούν όλα, επιστρέφουμε το πρώτο (fallback)
  return MUTED_PALETTE[0];
}

export function isColorUsed(color: string, usedColors: string[]): boolean {
  return usedColors.includes(color);
}

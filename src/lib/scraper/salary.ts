/**
 * Parse a salary string and return the highest dollar figure.
 * Returns null if nothing can be parsed.
 */
export function parseTopSalary(salary: string | null | undefined): number | null {
  if (!salary || salary === "Not specified") return null;

  // Try range pattern: $X - $Y or $X–$Y or $X—$Y
  const rangePattern = /\$[\d,]+\.?\d*[kK]?\s*[-–—]\s*\$[\d,]+\.?\d*[kK]?/g;
  const ranges = salary.match(rangePattern);

  if (ranges && ranges.length > 0) {
    const amounts: number[] = [];
    for (const range of ranges) {
      const dollarAmounts = range.match(/\$[\d,]+\.?\d*[kK]?/g);
      if (dollarAmounts) {
        for (const amt of dollarAmounts) {
          const normalized = normalizeDollarAmount(amt);
          if (normalized !== null) amounts.push(normalized);
        }
      }
    }
    if (amounts.length > 0) return Math.max(...amounts);
  }

  // Fallback: standalone dollar amounts
  const standalone = salary.match(/\$[\d,]+\.?\d*[kK]?/g);
  if (standalone) {
    const amounts = standalone
      .map(normalizeDollarAmount)
      .filter((n): n is number => n !== null && n >= 50000);
    if (amounts.length > 0) return Math.max(...amounts);
  }

  return null;
}

export function normalizeDollarAmount(raw: string): number | null {
  // Strip everything except digits, '.', 'k'/'K'
  let cleaned = raw.replace(/[^0-9.kK]/g, "");
  const hasK = /[kK]/.test(cleaned);
  cleaned = cleaned.replace(/[kK]/g, "");

  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;

  return hasK ? num * 1000 : num;
}

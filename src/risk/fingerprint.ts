import { createHash } from "node:crypto";
import type { StatementRow } from "./statementCsv";

/**
 * Stable per-line keys. Two identical lines on one statement (two $4.50 coffees the
 * same day) stay distinct via their occurrence number, while uploading the same
 * statement twice produces the same keys, so nothing is double counted.
 */
export function fingerprints(rows: StatementRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = [r.date, r.description.toUpperCase(), r.amountCents, r.balanceCents ?? ""].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 32);
  });
}

import { parse } from "csv-parse/sync";

export interface StatementRow {
  line: number; // 1-based line in the uploaded file, for error messages
  date: string; // YYYY-MM-DD
  description: string;
  amountCents: number; // credit +, debit -
  balanceCents?: number;
}

export interface ParseResult {
  rows: StatementRow[];
  errors: { line: number; message: string }[];
}

/** "$1,234.56" | "-12.00" | "(12.00)" | "1234" → cents. Returns null if unparseable. */
export function parseMoney(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim();
  if (s === "") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return neg ? -cents : cents;
}

/** "2026-07-01" | "07/01/2026" | "7/1/2026" → "2026-07-01". Validates the calendar date. */
export function parseDate(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, "");
const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date", "postingdate", "transactiondate", "posted"],
  description: ["description", "memo", "details", "payee", "name"],
  amount: ["amount", "amt"],
  debit: ["debit", "withdrawal", "withdrawals", "debits"],
  credit: ["credit", "deposit", "deposits", "credits"],
  balance: ["balance", "runningbalance", "endingbalance"],
};

/**
 * Parses a bank CSV export. Accepts either a signed `amount` column or separate
 * `debit`/`credit` columns. Every bad row is reported with its line number.
 */
export function parseStatementCsv(text: string): ParseResult {
  let records: string[][];
  try {
    records = parse(text.replace(/^﻿/, ""), { relax_column_count: true, skip_empty_lines: true, trim: true });
  } catch (e) {
    return { rows: [], errors: [{ line: 0, message: `Not a valid CSV: ${(e as Error).message}` }] };
  }
  if (records.length === 0) return { rows: [], errors: [{ line: 0, message: "File is empty" }] };

  const header = records[0]!.map(norm);
  const col = (key: string) => header.findIndex((h) => HEADER_ALIASES[key]!.includes(h));
  const c = { date: col("date"), desc: col("description"), amount: col("amount"), debit: col("debit"), credit: col("credit"), balance: col("balance") };
  const missing = [
    c.date < 0 && "date",
    c.desc < 0 && "description",
    c.amount < 0 && (c.debit < 0 || c.credit < 0) && "amount (or debit and credit)",
  ].filter(Boolean);
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `Missing column(s): ${missing.join(", ")}` }] };

  const rows: StatementRow[] = [];
  const errors: ParseResult["errors"] = [];
  records.slice(1).forEach((r, i) => {
    const line = i + 2;
    const date = parseDate(r[c.date]);
    const description = (r[c.desc] ?? "").replace(/\s+/g, " ").trim();
    let amountCents: number | null;
    if (c.amount >= 0) amountCents = parseMoney(r[c.amount]);
    else {
      const debit = parseMoney(r[c.debit]);
      const credit = parseMoney(r[c.credit]);
      amountCents = credit !== null && credit !== 0 ? Math.abs(credit) : debit !== null ? -Math.abs(debit) : null;
    }
    const balanceCents = c.balance >= 0 ? parseMoney(r[c.balance]) : null;

    const problems = [
      !date && `bad date "${r[c.date] ?? ""}"`,
      !description && "empty description",
      amountCents === null && "bad or missing amount",
      amountCents === 0 && "zero amount",
      c.balance >= 0 && (r[c.balance] ?? "").trim() !== "" && balanceCents === null && `bad balance "${r[c.balance]}"`,
    ].filter(Boolean);
    if (problems.length) errors.push({ line, message: problems.join("; ") });
    else rows.push({ line, date: date!, description, amountCents: amountCents!, ...(balanceCents !== null ? { balanceCents } : {}) });
  });
  return { rows, errors };
}

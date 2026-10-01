import { parseMoney, parseDate, parseStatementCsv } from "../../src/risk/statementCsv";

describe("parseMoney", () => {
  it.each([
    ["1234.56", 123456],
    ["$1,234.56", 123456],
    ["-12.00", -1200],
    ["(12.00)", -1200],
    ["-$5", -500],
    ["0.5", 50],
    ["  42 ", 4200],
  ])("%s → %d", (raw, cents) => expect(parseMoney(raw)).toBe(cents));
  it.each(["", "abc", "1.234", "12,34.5.6", undefined])("rejects %s", (raw) => expect(parseMoney(raw)).toBeNull());
});

describe("parseDate", () => {
  it.each([
    ["2026-07-01", "2026-07-01"],
    ["07/01/2026", "2026-07-01"],
    ["7/1/2026", "2026-07-01"],
  ])("%s → %s", (raw, iso) => expect(parseDate(raw)).toBe(iso));
  it.each(["2026-02-30", "13/01/2026", "July 1", "2026/07/01", ""])("rejects %s", (raw) => expect(parseDate(raw)).toBeNull());
});

describe("parseStatementCsv", () => {
  it("reads a signed-amount export with quoted commas and a BOM", () => {
    const csv = '﻿Date,Description,Amount,Balance\n2026-07-01,"SQUARE INC, DEP",250.00,1250.00\n2026-07-01,ADP PAYROLL,-100.00,1150.00\n';
    const { rows, errors } = parseStatementCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, date: "2026-07-01", description: "SQUARE INC, DEP", amountCents: 25000, balanceCents: 125000 },
      { line: 3, date: "2026-07-01", description: "ADP PAYROLL", amountCents: -10000, balanceCents: 115000 },
    ]);
  });
  it("reads a debit/credit export with US dates and header aliases", () => {
    const csv = "Posting Date,Memo,Withdrawals,Deposits\n07/02/2026,RENT,1500.00,\n07/03/2026,DEPOSIT,,900.00\n";
    const { rows, errors } = parseStatementCsv(csv);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.date, r.amountCents])).toEqual([
      ["2026-07-02", -150000],
      ["2026-07-03", 90000],
    ]);
  });
  it("reports every bad row with its line number", () => {
    const csv = "Date,Description,Amount\n2026-07-01,OK,10.00\n2026-13-01,BAD DATE,10.00\n2026-07-02,,10.00\n2026-07-03,NO AMOUNT,\n2026-07-04,ZERO,0.00\n";
    const { errors } = parseStatementCsv(csv);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(errors[0]!.message).toMatch(/bad date/);
  });
  it("names missing columns", () => {
    expect(parseStatementCsv("Date,Amount\n2026-07-01,1\n").errors[0]!.message).toMatch(/description/);
    expect(parseStatementCsv("Date,Description,Debit\n2026-07-01,X,1\n").errors[0]!.message).toMatch(/amount/);
  });
  it("handles empty and garbage input without throwing", () => {
    expect(parseStatementCsv("").errors).toHaveLength(1);
    expect(parseStatementCsv('a,"b\n').errors).toHaveLength(1);
  });
});

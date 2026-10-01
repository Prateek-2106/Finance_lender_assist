import { classify } from "../../src/risk/classify";
import { PROFILES } from "../../fixtures/profiles";
import { generateStatement, toCsv } from "../../fixtures/generate";
import { parseStatementCsv } from "../../src/risk/statementCsv";
import { fingerprints } from "../../src/risk/fingerprint";

describe("classify: tricky real-world descriptions", () => {
  it.each<[string, number, string]>([
    ["SQUARE INC DEP 0412", 100, "revenue"],
    ["STRIPE TRANSFER ST-4821", 100, "revenue"], // says TRANSFER, but it's a card payout
    ["CAPITAL ONE MOBILE DEPOSIT", 100, "revenue"], // "CAPITAL" is a bank here, not a funder
    ["ONLINE TRANSFER FROM SAV 4821", 100, "transfer_in"],
    ["XFER FROM CHK 0091", 100, "transfer_in"],
    ["ONDECK CAPITAL FUNDING", 100, "loan_funding"],
    ["SBA LOAN PROCEEDS", 100, "loan_funding"],
    ["REVERSAL OF NSF FEE", 100, "reversal"], // a credit that mentions NSF is not a fee
    ["REFUND AMAZON MKTP", 100, "reversal"],
    ["NSF RETURNED ITEM FEE", -100, "nsf_fee"],
    ["OVERDRAFT FEE", -100, "nsf_fee"],
    ["ONDECK CAPITAL ACH DEBIT", -100, "lender_payment"],
    ["KAPITUS DAILY", -100, "lender_payment"],
    ["SBA LOAN PMT", -100, "lender_payment"],
    ["ONLINE TRANSFER TO SAV 4821", -100, "transfer_out"],
    ["ADP PAYROLL", -100, "expense"],
    ["sysco foods", -100, "expense"],
  ])("%s (%d) → %s", (desc, amt, cat) => expect(classify(desc, amt).category).toBe(cat));

  it("records which rule fired", () => {
    expect(classify("STRIPE TRANSFER ST-1", 1)).toEqual({ category: "revenue", rule: "credit.default" });
    expect(classify("KAPITUS DAILY", -1)).toEqual({ category: "lender_payment", rule: "debit.known_funder" });
  });
});

describe("classifier vs. ground truth on the six fixture businesses", () => {
  it.each(PROFILES.map((p) => [p.key, p] as const))("%s: every line matches its true category", (_key, p) => {
    const lines = generateStatement(p);
    const { rows, errors } = parseStatementCsv(toCsv(p, lines)); // through the real parser, both CSV layouts
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(lines.length);
    const wrong = rows.map((r, i) => ({ desc: r.description, got: classify(r.description, r.amountCents).category, want: lines[i]!.truth })).filter((x) => x.got !== x.want);
    expect(wrong).toEqual([]);
  });

  it("the generator is deterministic", () => {
    expect(generateStatement(PROFILES[0]!)).toEqual(generateStatement(PROFILES[0]!));
  });
});

describe("fingerprints", () => {
  const row = { line: 2, date: "2026-07-01", description: "COFFEE", amountCents: -450 };
  it("keeps identical same-day lines distinct but is stable across uploads", () => {
    const a = fingerprints([row, { ...row, line: 3 }]);
    expect(a[0]).not.toBe(a[1]);
    expect(fingerprints([row, { ...row, line: 3 }])).toEqual(a);
  });
  it("ignores description case and line position", () => {
    expect(fingerprints([{ ...row, description: "coffee", line: 99 }])).toEqual(fingerprints([row]));
  });
});

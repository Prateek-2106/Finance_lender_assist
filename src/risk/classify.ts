import type { TxnCategory } from "../domain";

export interface Classification {
  category: TxnCategory;
  rule: string;
}

/** Alternative lenders whose names identify funding (credit) or repayment (debit). */
export const KNOWN_FUNDERS = [
  "ONDECK",
  "KAPITUS",
  "BLUEVINE",
  "FUNDBOX",
  "CREDIBLY",
  "RAPID FINANCE",
  "FORWARD FINANCING",
  "LIBERTAS",
  "YELLOWSTONE CAP",
];

const funder = (d: string) => KNOWN_FUNDERS.find((f) => d.includes(f));

interface Rule {
  id: string;
  test: (desc: string) => boolean;
  category: TxnCategory;
}

// Order matters: first match wins. Each rule id is stored on the line so a
// reviewer can see exactly why a deposit did or didn't count as revenue.
const CREDIT_RULES: Rule[] = [
  { id: "credit.reversal", category: "reversal", test: (d) => /\b(REVERSAL|REVERSED|REFUND|CHARGEBACK)\b/.test(d) },
  { id: "credit.known_funder", category: "loan_funding", test: (d) => !!funder(d) },
  { id: "credit.funding_keyword", category: "loan_funding", test: (d) => /\b(LOAN PROCEEDS|ADVANCE FUNDING|MCA FUNDING|LOAN DISBURSEMENT)\b/.test(d) },
  { id: "credit.transfer_in", category: "transfer_in", test: (d) => /\b(TRANSFER|XFER) FROM\b/.test(d) },
];

const DEBIT_RULES: Rule[] = [
  { id: "debit.nsf", category: "nsf_fee", test: (d) => /\b(NSF|OVERDRAFT|OD FEE|RETURNED ITEM|INSUFFICIENT FUNDS)\b/.test(d) },
  { id: "debit.known_funder", category: "lender_payment", test: (d) => !!funder(d) },
  { id: "debit.loan_keyword", category: "lender_payment", test: (d) => /\b(LOAN PMT|LOAN PAYMENT|MCA PMT|SBA LOAN)\b/.test(d) },
  { id: "debit.transfer_out", category: "transfer_out", test: (d) => /\b(TRANSFER|XFER) TO\b/.test(d) },
];

export function classify(description: string, amountCents: number): Classification {
  const d = description.toUpperCase();
  const credit = amountCents > 0;
  for (const r of credit ? CREDIT_RULES : DEBIT_RULES) if (r.test(d)) return { category: r.category, rule: r.id };
  return credit ? { category: "revenue", rule: "credit.default" } : { category: "expense", rule: "debit.default" };
}

import type { TxnCategory } from "../src/domain";
import type { Profile } from "./profiles";

export interface GeneratedLine {
  date: string;
  description: string;
  amountCents: number;
  balanceCents: number;
  truth: TxnCategory;
}

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!;
  return { next, gauss, pick };
}

const REVENUE = ["SQUARE INC DEP", "STRIPE TRANSFER ST-", "CLOVER SETTLEMENT", "MERCHANT BANKCARD DEP", "MOBILE DEPOSIT", "DEPOSIT"];
const SUPPLIERS = ["SYSCO FOODS", "HOME DEPOT", "NAPA AUTO PARTS", "ULINE", "COSTCO WHSE", "SALLY BEAUTY"];

export function generateStatement(p: Profile): GeneratedLine[] {
  const r = rng(p.seed);
  const out: GeneratedLine[] = [];
  let bal = p.openingBalanceCents;
  const start = new Date(`${p.start}T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + p.months, 0));
  const k = p.expenseRatio / 0.83; // expense mix below sums to 83% of planned revenue
  let refunded = false;

  const push = (date: string, description: string, amountCents: number, truth: TxnCategory) => {
    bal += amountCents;
    out.push({ date, description, amountCents, balanceCents: bal, truth });
  };
  let nsfToday = 0;
  const debit = (date: string, description: string, cents: number, truth: TxnCategory) => {
    push(date, description, -Math.max(1, Math.round(cents)), truth);
    if (bal < 0 && nsfToday < 3) {
      nsfToday++;
      push(date, r.pick(["NSF RETURNED ITEM FEE", "OVERDRAFT FEE", "INSUFFICIENT FUNDS FEE"]), -3500, "nsf_fee");
    }
  };

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const month = (d.getUTCFullYear() - start.getUTCFullYear()) * 12 + d.getUTCMonth() - start.getUTCMonth();
    const dow = d.getUTCDay();
    const dom = d.getUTCDate();
    const businessDay = dow >= 1 && dow <= 5;
    const planned = p.baseMonthlyRevenueCents * p.monthMultipliers[month]!;
    nsfToday = 0;

    // ── credits
    for (const l of p.lenders)
      if (l.month === month && dom === 1 + l.month) push(date, `${l.name} FUNDING`, l.fundedCents, "loan_funding");
    if (businessDay) {
      const daily = Math.max(0, (planned / 21.7) * (1 + p.volatility * r.gauss()));
      const n = r.next() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        let desc = r.pick(REVENUE);
        if (desc.endsWith("-")) desc += String(Math.floor(r.next() * 9000 + 1000));
        const cents = Math.round(daily / n);
        if (cents > 0) push(date, desc, cents, "revenue");
      }
    }
    if (!refunded && month === 2 && dom === 10) {
      refunded = true;
      push(date, "REFUND AMAZON MKTP", 4599, "reversal");
    }
    if (p.savings && bal < 200_000 && businessDay) push(date, "ONLINE TRANSFER FROM SAV 4821", 500_000, "transfer_in");

    // ── debits
    // fixed costs follow the business's normal size, not this month's sales
    const base = p.baseMonthlyRevenueCents;
    if (dom === 1) debit(date, "RENT - OAK STREET PROPERTIES", base * 0.1 * k, "expense");
    if (dom === 15) debit(date, "NATIONAL GRID UTILITY", base * 0.03 * k, "expense");
    if (dow === 5) debit(date, "ADP PAYROLL", ((base * 0.35) / 4.33) * k, "expense");
    if (dow === 2 || dow === 4) debit(date, r.pick(SUPPLIERS), ((planned * 0.3) / 8.66) * k, "expense");
    if (businessDay && r.next() < 0.4) debit(date, r.pick(["SHELL OIL", "COMCAST BUSINESS", "STAPLES", "GOOGLE ADS"]), ((planned * 0.05) / 8.7) * k, "expense");
    if (businessDay)
      for (const l of p.lenders) if (month > l.month || (month === l.month && dom > 1 + l.month)) debit(date, `${l.name} ACH DEBIT`, l.dailyPaymentCents, "lender_payment");
    if (p.savings && dom === 28 && bal > planned * 0.4) debit(date, "ONLINE TRANSFER TO SAV 4821", 200_000, "transfer_out");
  }
  return out;
}

const fmtMoney = (c: number) => (c / 100).toFixed(2);
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/** Renders like a real bank export: one of two common layouts. */
export function toCsv(p: Profile, lines: GeneratedLine[]): string {
  const q = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  if (p.format === "amount")
    return ["Date,Description,Amount,Balance", ...lines.map((l) => [l.date, q(l.description), fmtMoney(l.amountCents), fmtMoney(l.balanceCents)].join(","))].join("\n") + "\n";
  return [
    "Posting Date,Description,Debit,Credit,Balance",
    ...lines.map((l) =>
      [usDate(l.date), q(l.description), l.amountCents < 0 ? fmtMoney(-l.amountCents) : "", l.amountCents > 0 ? fmtMoney(l.amountCents) : "", fmtMoney(l.balanceCents)].join(","),
    ),
  ].join("\n") + "\n";
}

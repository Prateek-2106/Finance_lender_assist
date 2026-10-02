import type { BankTransaction, FundingApplication } from "../domain";
import { AFFORDABILITY } from "./config";

export type MetricKey =
  | "trueMonthlyRevenue"
  | "revenueTrend"
  | "revenueVolatility"
  | "balanceCushion"
  | "negativeDays"
  | "nsfEvents"
  | "debtLoad"
  | "monthsInBusiness";

export interface Metric {
  id: string; // M1…M8: the handle reasons and the AI memo cite
  key: MetricKey;
  label: string;
  value: number | null; // null = not enough data to measure
  display: string;
  inputs: Record<string, number | string>; // enough to recompute by hand
}

export interface Facts {
  period: { from: string; to: string; days: number };
  monthsCovered: number;
  monthlyRevenue: { month: string; revenueCents: number; full: boolean }[];
  avgDailyRevenueCents: number; // per business day
  existingDailyLenderCents: number; // per business day, last 30 days
  statedToTrueRatio: number | null;
}

const DAY = 86_400_000;
const toDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const usd = (c: number) => `${c < 0 ? "-" : ""}$${Math.abs(Math.round(c / 100)).toLocaleString("en-US")}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function daysInMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function computeMetrics(app: FundingApplication, txns: BankTransaction[]): { metrics: Metric[]; facts: Facts } {
  if (txns.length === 0) throw new Error("computeMetrics needs at least one transaction");
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  const firstDay = toDay(sorted[0]!.date);
  const lastDay = toDay(sorted.at(-1)!.date);
  const days = lastDay - firstDay + 1;
  const monthsCovered = days / (365.25 / 12);
  const sum = (xs: BankTransaction[]) => xs.reduce((s, t) => s + t.amountCents, 0);
  const of = (cat: BankTransaction["category"]) => sorted.filter((t) => t.category === cat);
  const inLast = (n: number) => (t: BankTransaction) => toDay(t.date) > lastDay - n;

  // ── M1 true monthly revenue
  const revenue = of("revenue");
  const totalRevenue = sum(revenue);
  const trueMonthly = Math.round(totalRevenue / monthsCovered);

  // ── monthly buckets; a month is "full" if the statement covers every day of it
  const months = new Map<string, number>();
  for (let d = firstDay; d <= lastDay; d++) months.set(fromDay(d).slice(0, 7), 0);
  for (const t of revenue) months.set(t.date.slice(0, 7), (months.get(t.date.slice(0, 7)) ?? 0) + t.amountCents);
  const monthlyRevenue = [...months].map(([month, revenueCents]) => {
    const start = toDay(`${month}-01`);
    const end = start + daysInMonth(month) - 1;
    return { month, revenueCents, full: start >= firstDay && end <= lastDay };
  });
  const full = monthlyRevenue.filter((m) => m.full);

  // ── M2 trend: last 3 full months vs the 3 before (or the two halves if shorter)
  let trend: number | null = null;
  let trendInputs: Record<string, number | string> = { fullMonths: full.length };
  if (full.length >= 2) {
    const k = Math.min(3, Math.floor(full.length / 2));
    const recent = full.slice(-k);
    const prior = full.slice(-2 * k, -k);
    const r = recent.reduce((s, m) => s + m.revenueCents, 0);
    const p = prior.reduce((s, m) => s + m.revenueCents, 0);
    if (p > 0) trend = r / p;
    trendInputs = { recentMonths: recent.map((m) => m.month).join(","), recentCents: r, priorMonths: prior.map((m) => m.month).join(","), priorCents: p };
  }

  // ── M3 volatility: coefficient of variation of full-month revenue
  let cv: number | null = null;
  if (full.length >= 3) {
    const xs = full.map((m) => m.revenueCents);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    cv = mean > 0 ? sd / mean : null;
  }

  // ── M4/M5 daily balances: end-of-day balance, carried across quiet days
  const withBal = sorted.filter((t) => t.balanceCents !== undefined);
  let adb: number | null = null;
  let negDays: number | null = null;
  if (withBal.length === sorted.length) {
    const endOfDay = new Map<number, number>();
    for (const t of sorted) endOfDay.set(toDay(t.date), t.balanceCents!);
    const daily: { day: number; bal: number }[] = [];
    let bal = endOfDay.get(firstDay)!;
    for (let d = firstDay; d <= lastDay; d++) {
      if (endOfDay.has(d)) bal = endOfDay.get(d)!;
      daily.push({ day: d, bal });
    }
    adb = Math.round(daily.reduce((s, x) => s + x.bal, 0) / daily.length);
    negDays = daily.filter((x) => x.day > lastDay - 90 && x.bal < 0).length;
  }
  const cushion = adb !== null && trueMonthly > 0 ? adb / trueMonthly : null;

  // ── M6 NSF events, last 90 days
  const nsf90 = of("nsf_fee").filter(inLast(90)).length;

  // ── M7 debt load: existing lender payments as a share of revenue
  const lenderTotal = -sum(of("lender_payment"));
  const debtLoad = totalRevenue > 0 ? lenderTotal / totalRevenue : null;
  const lender30 = -sum(of("lender_payment").filter(inLast(30)));
  const existingDailyLenderCents = Math.round(lender30 / (AFFORDABILITY.businessDaysPerMonth * (30 / (365.25 / 12))));

  const period = { from: fromDay(firstDay), to: fromDay(lastDay), days };
  const metrics: Metric[] = [
    {
      id: "M1",
      key: "trueMonthlyRevenue",
      label: "True monthly revenue",
      value: trueMonthly,
      display: usd(trueMonthly),
      inputs: { revenueCents: totalRevenue, revenueDeposits: revenue.length, days, monthsCovered: Number(monthsCovered.toFixed(3)) },
    },
    { id: "M2", key: "revenueTrend", label: "Revenue trend", value: trend, display: trend === null ? "n/a" : `${trend >= 1 ? "+" : ""}${pct(trend - 1)}`, inputs: trendInputs },
    {
      id: "M3",
      key: "revenueVolatility",
      label: "Revenue volatility",
      value: cv,
      display: cv === null ? "n/a" : cv.toFixed(2),
      inputs: { fullMonths: full.length, monthly: full.map((m) => `${m.month}:${m.revenueCents}`).join(",") },
    },
    {
      id: "M4",
      key: "balanceCushion",
      label: "Average daily balance",
      value: cushion,
      display: adb === null ? "n/a" : `${usd(adb)} (${cushion!.toFixed(2)}× monthly revenue)`,
      inputs: adb === null ? { reason: "statement has no running balance" } : { avgDailyBalanceCents: adb, trueMonthlyRevenueCents: trueMonthly, days },
    },
    {
      id: "M5",
      key: "negativeDays",
      label: "Negative-balance days (90 days)",
      value: negDays,
      display: negDays === null ? "n/a" : String(negDays),
      inputs: { window: `${fromDay(Math.max(firstDay, lastDay - 89))}..${period.to}` },
    },
    { id: "M6", key: "nsfEvents", label: "NSF and overdraft events (90 days)", value: nsf90, display: String(nsf90), inputs: { window: `${fromDay(Math.max(firstDay, lastDay - 89))}..${period.to}` } },
    {
      id: "M7",
      key: "debtLoad",
      label: "Existing debt load",
      value: debtLoad,
      display: debtLoad === null ? "n/a" : pct(debtLoad),
      inputs: { lenderPaymentsCents: lenderTotal, lenderPayments: of("lender_payment").length, revenueCents: totalRevenue },
    },
    { id: "M8", key: "monthsInBusiness", label: "Time in business", value: app.monthsInBusiness, display: `${app.monthsInBusiness} months`, inputs: { source: "application" } },
  ];

  return {
    metrics,
    facts: {
      period,
      monthsCovered,
      monthlyRevenue,
      avgDailyRevenueCents: Math.round(trueMonthly / AFFORDABILITY.businessDaysPerMonth),
      existingDailyLenderCents,
      statedToTrueRatio: trueMonthly > 0 ? app.statedMonthlyRevenueCents / trueMonthly : null,
    },
  };
}

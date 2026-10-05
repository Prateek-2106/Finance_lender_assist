import type { FundingApplication } from "../domain";
import type { Assessment, Knockout } from "./assess";
import { estimatedApr } from "./apr";
import type { Metric } from "./metrics";
import { AFFORDABILITY, KNOCKOUTS } from "./config";

/**
 * What the business owner sees: plain words, no scorecard jargon, and for every
 * problem, what would change the answer. Written by code from the same numbers the
 * decision used, so it can never disagree with them.
 */
export interface ApplicantView {
  status: "not_assessed" | "approved" | "declined" | "pending_review";
  headline: string;
  summary: string;
  decidedBy?: string; // "Decided automatically" or "Reviewed by Priya Shah"
  decidedAt?: Date;
  note?: string; // the underwriter's note, when they wrote one
  offer?: {
    amountCents: number;
    paybackCents: number;
    costCents: number;
    dailyPaymentCents: number;
    termBusinessDays: number;
    approxMonths: number;
    estimatedAprPercent: number;
  };
  reasons: { text: string; whatWouldHelp: string }[];
  nextSteps: string[];
}

const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const usdCents = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const day = (d: Date) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function knockoutReason(k: Knockout, a: Assessment, app: FundingApplication) {
  const m1 = a.metrics.find((m) => m.id === "M1")!;
  switch (k.code) {
    case "time_in_business": {
      const months = KNOCKOUTS.minMonthsInBusiness - app.monthsInBusiness;
      return {
        text: `Funding on Vendor Street needs at least ${KNOCKOUTS.minMonthsInBusiness} months in business. You've been operating for ${app.monthsInBusiness}.`,
        whatWouldHelp: `You can apply again in about ${months} month${months === 1 ? "" : "s"}.`,
      };
    }
    case "min_revenue":
      return {
        text: `Sales deposits into your account average ${m1.display} a month. The minimum is ${usd(KNOCKOUTS.minMonthlyRevenueCents)}.`,
        whatWouldHelp: "If some sales go into another business account, upload that account's statements too.",
      };
    case "nsf_events":
      return {
        text: `Your account had ${a.metrics.find((m) => m.id === "M6")!.display} overdraft or returned-payment fees in the last 90 days.`,
        whatWouldHelp: "Keeping a cushion so payments don't bounce makes the biggest difference. We can look again after 90 days without fees.",
      };
    case "short_history":
      return {
        text: `The statements you uploaded cover ${a.facts.period.days} days. We need about 3 months to see how your sales move.`,
        whatWouldHelp: "Upload older statements so they cover at least 3 months.",
      };
    case "stated_revenue_mismatch":
      return {
        text: `You told us about ${usd(app.statedMonthlyRevenueCents)} a month in sales, but deposits from sales into this account average ${m1.display}.`,
        whatWouldHelp: "If sales go into more than one account, upload those statements too. Otherwise, tell us more about how you get paid.",
      };
    case "no_affordable_offer":
      return {
        text: `Payments on your existing loans or advances, about ${usd(a.facts.existingDailyLenderCents)} each business day, already use more of your daily sales (about ${usd(a.facts.avgDailyRevenueCents)}) than we allow for all repayments combined (${pct(AFFORDABILITY.maxHoldbackOfDailyRevenue)}).`,
        whatWouldHelp: "Paying off or finishing one of your current advances would make room for new funding.",
      };
    default:
      return { text: k.message, whatWouldHelp: "" };
  }
}

function metricReason(m: Metric): { text: string; whatWouldHelp: string } | null {
  if (m.value === null) return null;
  const v = m.value;
  switch (m.key) {
    case "trueMonthlyRevenue":
      return { text: `Sales deposits average about ${m.display} a month, which keeps the amount we can offer small.`, whatWouldHelp: "Offers grow with your sales; a few stronger months will raise it." };
    case "revenueTrend":
      return v < 1
        ? { text: `Your sales dropped about ${pct(1 - v)} over the last few months.`, whatWouldHelp: "A few months of steadier sales would help your next application." }
        : null;
    case "revenueVolatility":
      return {
        text: "Your sales go up and down a lot from month to month.",
        whatWouldHelp: "If your business is seasonal, applying during your busy season, or with a full year of statements, gives a fairer picture.",
      };
    case "balanceCushion":
      return { text: "Your account balance often runs low compared with your sales.", whatWouldHelp: "Keeping more cash in the account between payments helps." };
    case "negativeDays":
      return { text: `Your balance went below zero on ${v} day${v === 1 ? "" : "s"} in the last 90.`, whatWouldHelp: "Avoiding overdrafts for a few months will help." };
    case "nsfEvents":
      return { text: `You had ${v} overdraft or returned-payment fee${v === 1 ? "" : "s"} in the last 90 days.`, whatWouldHelp: "Avoiding overdrafts for a few months will help." };
    case "debtLoad":
      return { text: `Payments on existing loans or advances take about ${m.display} of your sales.`, whatWouldHelp: "Paying down existing financing makes room for new funding." };
    case "monthsInBusiness":
      return { text: `You've been in business ${v} months; more history gives lenders more confidence.`, whatWouldHelp: "This improves on its own as you keep operating." };
  }
}

export function applicantView(app: FundingApplication): ApplicantView {
  const a = app.assessment;
  const d = app.decision;
  if (!a || !d)
    return {
      status: "not_assessed",
      headline: "Upload a bank statement to see what you qualify for",
      summary: "We look at 3 to 6 months of your business bank account: your sales, your balance, and any loans you're already paying.",
      reasons: [],
      nextSteps: ["Export a CSV statement from your bank and upload it.", "Then choose Assess."],
    };

  const decidedBy = d.decidedBy.kind === "underwriter" ? `Reviewed by ${d.decidedBy.name}` : "Decided automatically from your bank statement";
  const reasons = [
    ...a.knockouts.map((k) => knockoutReason(k, a, app)),
    ...a.reasons
      .filter((r) => r.metricIds.length === 1 && !a.knockouts.some((k) => k.metricIds.length === 1 && k.metricIds[0] === r.metricIds[0]))
      .map((r) => metricReason(a.metrics.find((m) => m.id === r.metricIds[0])!))
      .filter((x): x is NonNullable<typeof x> => !!x),
  ];
  const common = { decidedBy, decidedAt: d.at, ...(d.note ? { note: d.note } : {}) };

  if (d.outcome === "approved" && d.offer) {
    const o = d.offer;
    const apr = estimatedApr(o.amountCents, o.dailyPaymentCents, o.termBusinessDays);
    const months = Math.round((o.termBusinessDays / 21.7) * 10) / 10;
    return {
      status: "approved",
      headline: `You're approved for ${usd(o.amountCents)}`,
      summary: `You'd repay ${usd(o.paybackCents)} in total, as ${usdCents(o.dailyPaymentCents)} each business day for about ${months} months. That's ${usd(o.paybackCents - o.amountCents)} for the money, about ${Math.round(apr * 100)}% a year as an estimated APR.`,
      ...common,
      offer: {
        amountCents: o.amountCents,
        paybackCents: o.paybackCents,
        costCents: o.paybackCents - o.amountCents,
        dailyPaymentCents: o.dailyPaymentCents,
        termBusinessDays: o.termBusinessDays,
        approxMonths: months,
        estimatedAprPercent: Math.round(apr * 1000) / 10,
      },
      reasons: o.amountCents < app.amountRequestedCents ? reasons : [],
      nextSteps: [
        o.amountCents < app.amountRequestedCents
          ? `This is less than the ${usd(app.amountRequestedCents)} you asked for, because of what your daily sales can comfortably repay.`
          : "This covers the full amount you asked for.",
        "Daily payments come out of your business account automatically. Compare this cost with other options before you accept.",
      ],
    };
  }
  if (d.outcome === "pending_review")
    return {
      status: "pending_review",
      headline: "A specialist is reviewing your application",
      summary: "Most applications are decided automatically. Yours needs a person to look at a few things first:",
      ...common,
      reasons,
      nextSteps: ["We'll email you as soon as it's decided.", "If you have other business bank accounts, uploading those statements can speed this up."],
    };
  return {
    status: "declined",
    headline: "We can't offer funding right now",
    summary: "Here's what the decision was based on, and what would help next time:",
    ...common,
    reasons,
    nextSteps: ["None of this affects your credit score.", "You can apply again once things change; we'll look at your newest statements."],
  };
}

import type { BankTransaction, FundingApplication } from "../domain";
import { AFFORDABILITY, BAND_A_MIN_FRACTION, BANDS, KNOCKOUTS, METRIC_CONFIG, OFFER_TERMS, SCORECARD_VERSION } from "./config";
import { evalCurve } from "./curve";
import { computeMetrics, type Facts, type Metric, type MetricKey } from "./metrics";

export type Band = (typeof BANDS)[number]["band"];
export type Decision = "approve" | "review" | "decline";

export interface Knockout {
  code: string;
  outcome: "decline" | "review";
  message: string;
  metricIds: string[];
}

export interface ScoreLine {
  metricId: string;
  key: MetricKey;
  weight: number;
  fraction: number; // 0..1 of the weight earned
  points: number;
}

export interface Offer {
  amountCents: number;
  factorRate: number;
  paybackCents: number;
  termBusinessDays: number;
  dailyPaymentCents: number;
  limitedBy: "requested" | "revenue" | "affordability" | "underwriter";
  caps: { requestedCents: number; revenueCents: number; affordabilityCents: number };
}

export interface Reason {
  text: string;
  metricIds: string[];
}

export interface Assessment {
  scorecardVersion: string;
  decision: Decision;
  score: number; // 0..100, one decimal
  band: Band;
  bandNote?: string; // why the band differs from what the score alone gives
  offer: Offer | null;
  reasons: Reason[]; // knockouts first, then the costliest metrics
  knockouts: Knockout[];
  scoreLines: ScoreLine[];
  metrics: Metric[];
  facts: Facts;
  assessedAt: Date;
}

const usd = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const pctInt = (x: number) => `${Math.round(x * 100)}%`;

/** Missing data scores neutral (0.5) instead of zero, and is named in the reasons. */
/** Fraction of its weight a metric earns when the statements can't measure it. */
export const NEUTRAL = 0.5;

export function assess(app: FundingApplication, txns: BankTransaction[], now = new Date()): Assessment {
  const { metrics, facts } = computeMetrics(app, txns);
  const m = Object.fromEntries(metrics.map((x) => [x.key, x])) as Record<MetricKey, Metric>;

  // ── knockouts
  const knockouts: Knockout[] = [];
  if (app.monthsInBusiness < KNOCKOUTS.minMonthsInBusiness)
    knockouts.push({ code: "time_in_business", outcome: "decline", message: `In business ${app.monthsInBusiness} months; the minimum is ${KNOCKOUTS.minMonthsInBusiness}`, metricIds: ["M8"] });
  if (m.trueMonthlyRevenue.value! < KNOCKOUTS.minMonthlyRevenueCents)
    knockouts.push({ code: "min_revenue", outcome: "decline", message: `True monthly revenue is ${m.trueMonthlyRevenue.display}; the minimum is ${usd(KNOCKOUTS.minMonthlyRevenueCents)}`, metricIds: ["M1"] });
  if (m.nsfEvents.value! > KNOCKOUTS.maxNsfEvents90d)
    knockouts.push({ code: "nsf_events", outcome: "decline", message: `${m.nsfEvents.value} NSF or overdraft fees in the last 90 days; the limit is ${KNOCKOUTS.maxNsfEvents90d}`, metricIds: ["M6"] });
  if (facts.period.days < KNOCKOUTS.minStatementDays)
    knockouts.push({ code: "short_history", outcome: "review", message: `Statements cover ${facts.period.days} days; at least 3 months are needed`, metricIds: [] });
  if (facts.statedToTrueRatio !== null && facts.statedToTrueRatio > KNOCKOUTS.maxStatedToTrueRatio)
    knockouts.push({
      code: "stated_revenue_mismatch",
      outcome: "review",
      message: `Stated revenue of ${usd(app.statedMonthlyRevenueCents)} a month is ${facts.statedToTrueRatio.toFixed(1)}× what the bank shows (${m.trueMonthlyRevenue.display})`,
      metricIds: ["M1"],
    });

  // ── scorecard
  const scoreLines: ScoreLine[] = metrics.map((x) => {
    const cfg = METRIC_CONFIG[x.key];
    const fraction = x.value === null ? NEUTRAL : evalCurve(cfg.curve, x.value);
    return { metricId: x.id, key: x.key, weight: cfg.weight, fraction, points: cfg.weight * fraction };
  });
  const score = Math.round(scoreLines.reduce((s, l) => s + l.points, 0) * 10) / 10;
  let band: Band = BANDS.find((b) => score >= b.min)!.band;
  const redFlags = scoreLines.filter((l) => l.fraction < BAND_A_MIN_FRACTION);
  const cappedAtB = band === "A" && redFlags.length > 0;
  if (cappedAtB) band = "B";

  // ── offer (bands A and B)
  let offer: Offer | null = null;
  let noRoom = false;
  if (band === "A" || band === "B") {
    const t = OFFER_TERMS[band];
    const revenueCap = t.revenueMultiple * m.trueMonthlyRevenue.value!;
    const maxDaily = AFFORDABILITY.maxHoldbackOfDailyRevenue * facts.avgDailyRevenueCents - facts.existingDailyLenderCents;
    const affordabilityCap = Math.max(0, (maxDaily * t.termBusinessDays) / t.factorRate);
    const caps = { requestedCents: app.amountRequestedCents, revenueCents: Math.round(revenueCap), affordabilityCents: Math.round(affordabilityCap) };
    const raw = Math.min(caps.requestedCents, caps.revenueCents, caps.affordabilityCents);
    const amount = Math.floor(raw / AFFORDABILITY.roundToCents) * AFFORDABILITY.roundToCents;
    if (amount < AFFORDABILITY.minOfferCents) noRoom = true;
    else {
      const payback = Math.round(amount * t.factorRate);
      offer = {
        amountCents: amount,
        factorRate: t.factorRate,
        paybackCents: payback,
        termBusinessDays: t.termBusinessDays,
        dailyPaymentCents: Math.ceil(payback / t.termBusinessDays),
        limitedBy: raw === caps.requestedCents ? "requested" : raw === caps.revenueCents ? "revenue" : "affordability",
        caps,
      };
    }
  }
  if (noRoom)
    knockouts.push({
      code: "no_affordable_offer",
      outcome: "review",
      message: `Existing lender payments of ${usd(facts.existingDailyLenderCents)} a day already exceed what ${pctInt(AFFORDABILITY.maxHoldbackOfDailyRevenue)} of daily revenue (${usd(facts.avgDailyRevenueCents)}) can carry`,
      metricIds: ["M7", "M1"],
    });

  // ── decision
  let decision: Decision;
  if (knockouts.some((k) => k.outcome === "decline") || band === "D") decision = "decline";
  else if (knockouts.some((k) => k.outcome === "review") || band === "C") decision = "review";
  else decision = "approve";

  // ── reasons: knockouts, then the metrics that cost the most points
  const reasons: Reason[] = knockouts.map((k) => ({ text: k.message, metricIds: k.metricIds }));
  const costly = [...scoreLines]
    .map((l) => ({ l, lost: l.weight - l.points }))
    .filter((x) => x.lost >= 0.25 * x.l.weight) // only factors that cost at least a quarter of their weight
    .sort((a, b) => b.lost - a.lost)
    .slice(0, 4);
  const coveredByKnockout = new Set(knockouts.filter((k) => k.metricIds.length === 1).flatMap((k) => k.metricIds));
  for (const { l } of costly) if (!coveredByKnockout.has(l.metricId)) reasons.push({ text: reasonFor(m[l.key]), metricIds: [l.metricId] });

  if (decision === "decline") offer = null; // never show terms we won't honor
  const bandNote = cappedAtB ? `Score qualifies for A, capped at B: ${redFlags.map((l) => l.metricId).join(", ")} earned under ${Math.round(BAND_A_MIN_FRACTION * 100)}% of its weight` : undefined;
  return { scorecardVersion: SCORECARD_VERSION, decision, score, band, ...(bandNote ? { bandNote } : {}), offer, reasons, knockouts, scoreLines, metrics, facts, assessedAt: now };
}

function reasonFor(x: Metric): string {
  if (x.value === null) return `${x.label} could not be measured from these statements`;
  const v = x.value;
  switch (x.key) {
    case "trueMonthlyRevenue":
      return `True monthly revenue of ${x.display} limits the size of an advance`;
    case "revenueTrend":
      return v < 1 ? `Revenue fell ${pctInt(1 - v)} over the most recent months compared with the months before` : `Revenue growth is modest (${x.display})`;
    case "revenueVolatility":
      return `Monthly revenue swings widely (coefficient of variation ${x.display})`;
    case "balanceCushion":
      return `Average daily balance is thin: ${x.display}`;
    case "negativeDays":
      return `${v} day${v === 1 ? "" : "s"} ended with a negative balance in the last 90 days`;
    case "nsfEvents":
      return `${v} NSF or overdraft fee${v === 1 ? "" : "s"} in the last 90 days`;
    case "debtLoad":
      return `Existing lender payments take ${x.display} of revenue`;
    case "monthsInBusiness":
      return `Limited operating history: ${x.display}`;
  }
}

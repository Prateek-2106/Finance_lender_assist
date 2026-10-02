// Scorecard v1. Every assessment records this version, so a decision can be
// replayed exactly even after the numbers below are tuned.

export const SCORECARD_VERSION = "2026-10-02.2";

/** Piecewise-linear curve: [metric value, fraction of weight earned] points, x ascending. */
export type Curve = readonly (readonly [number, number])[];

export const METRIC_CONFIG = {
  trueMonthlyRevenue: { weight: 20, curve: [[10_000_00, 0.1], [25_000_00, 0.55], [50_000_00, 0.85], [100_000_00, 1]] },
  revenueTrend: { weight: 15, curve: [[0.7, 0], [0.85, 0.35], [1.0, 0.8], [1.1, 1]] },
  revenueVolatility: { weight: 10, curve: [[0.05, 1], [0.15, 0.85], [0.3, 0.45], [0.5, 0]] },
  // average daily balance as a fraction of a month's revenue: the cushion
  balanceCushion: { weight: 15, curve: [[0, 0], [0.1, 0.4], [0.3, 0.85], [0.6, 1]] },
  negativeDays: { weight: 10, curve: [[0, 1], [2, 0.7], [5, 0.35], [10, 0]] },
  nsfEvents: { weight: 15, curve: [[0, 1], [1, 0.75], [3, 0.35], [6, 0]] },
  debtLoad: { weight: 10, curve: [[0, 1], [0.05, 0.7], [0.1, 0.4], [0.2, 0]] },
  monthsInBusiness: { weight: 5, curve: [[6, 0], [12, 0.4], [24, 0.7], [60, 1]] },
} as const satisfies Record<string, { weight: number; curve: Curve }>;

export const BANDS = [
  { band: "A", min: 75 },
  { band: "B", min: 60 },
  { band: "C", min: 45 },
  { band: "D", min: 0 },
] as const;

/** Band A also needs every metric to earn at least this share of its weight; otherwise it is capped at B. */
export const BAND_A_MIN_FRACTION = 0.3;

export const KNOCKOUTS = {
  minMonthsInBusiness: 6,
  minMonthlyRevenueCents: 10_000_00,
  maxNsfEvents90d: 8,
  minStatementDays: 85, // roughly 3 months
  maxStatedToTrueRatio: 1.5,
};

/** Revenue-based advance terms by band. */
export const OFFER_TERMS = {
  A: { revenueMultiple: 1.0, factorRate: 1.25, termBusinessDays: 120 },
  B: { revenueMultiple: 0.75, factorRate: 1.35, termBusinessDays: 100 },
} as const;

export const AFFORDABILITY = {
  maxHoldbackOfDailyRevenue: 0.15, // all lender payments together, new + existing
  businessDaysPerMonth: 21.7,
  minOfferCents: 5_000_00,
  roundToCents: 500_00,
};

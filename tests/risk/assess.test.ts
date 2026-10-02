import { assess, type Assessment } from "../../src/risk/assess";
import { classify } from "../../src/risk/classify";
import { PROFILES, type Profile } from "../../fixtures/profiles";
import { generateStatement } from "../../fixtures/generate";
import { AFFORDABILITY, SCORECARD_VERSION } from "../../src/risk/config";
import type { BankTransaction, FundingApplication } from "../../src/domain";

function run(p: Profile, overrides: Partial<FundingApplication> = {}): Assessment {
  const app: FundingApplication = {
    id: "a", tenantId: "t", industry: p.industry, monthsInBusiness: p.monthsInBusiness,
    statedMonthlyRevenueCents: p.statedMonthlyRevenueCents, amountRequestedCents: p.amountRequestedCents,
    useOfFunds: p.useOfFunds, status: "draft", createdAt: new Date(), ...overrides,
  };
  const txns: BankTransaction[] = generateStatement(p).map((l, i) => ({
    id: String(i), tenantId: "t", applicationId: "a", date: l.date, description: l.description, amountCents: l.amountCents,
    balanceCents: l.balanceCents, ...classify(l.description, l.amountCents), fingerprint: String(i), createdAt: new Date(),
  }));
  return assess(app, txns, new Date("2026-10-02T00:00:00Z"));
}
const profile = (key: string) => PROFILES.find((p) => p.key === key)!;

describe("the six fixture businesses land where an underwriter would put them", () => {
  it.each([
    ["steady-bakery", "approve", "A", null],
    ["seasonal-landscaper", "approve", "B", "M3"],
    ["stacked-auto", "review", "B", "M7"],
    ["struggling-salon", "decline", "D", "M6"],
    ["new-food-truck", "decline", "B", "M8"],
    ["inflated-contractor", "review", "A", "M1"],
  ] as const)("%s → %s (band %s), top reason cites %s", (key, decision, band, topMetric) => {
    const a = run(profile(key));
    expect(a.decision).toBe(decision);
    expect(a.band).toBe(band);
    if (topMetric) expect(a.reasons[0]!.metricIds).toContain(topMetric);
    else expect(a.reasons).toEqual([]);
  });
});

describe("offers", () => {
  it("never exceed any cap, and say which one bound", () => {
    for (const p of PROFILES) {
      const o = run(p).offer;
      if (!o) continue;
      expect(o.amountCents).toBeLessThanOrEqual(Math.min(o.caps.requestedCents, o.caps.revenueCents, o.caps.affordabilityCents));
      expect(o.amountCents % AFFORDABILITY.roundToCents).toBe(0);
      expect(o.paybackCents).toBe(Math.round(o.amountCents * o.factorRate));
      expect(o.dailyPaymentCents * o.termBusinessDays).toBeGreaterThanOrEqual(o.paybackCents);
    }
  });
  it("keep the new daily payment within 15% of daily revenue", () => {
    const a = run(profile("steady-bakery"));
    expect(a.offer!.dailyPaymentCents).toBeLessThanOrEqual(0.15 * a.facts.avgDailyRevenueCents + 1);
  });
  it("are limited by the amount requested when that's smallest", () => {
    const o = run(profile("steady-bakery"), { amountRequestedCents: 10_000_00 }).offer!;
    expect(o).toMatchObject({ amountCents: 10_000_00, limitedBy: "requested" });
  });
  it("are never shown on a decline", () => {
    expect(run(profile("new-food-truck")).offer).toBeNull();
    expect(run(profile("struggling-salon")).offer).toBeNull();
  });
  it("stacking leaves no room: review with a reason, no offer", () => {
    const a = run(profile("stacked-auto"));
    expect(a.offer).toBeNull();
    expect(a.knockouts.map((k) => k.code)).toContain("no_affordable_offer");
  });
});

describe("explainability and determinism", () => {
  it("records the scorecard version and a band note when A is capped", () => {
    const a = run(profile("seasonal-landscaper"));
    expect(a.scorecardVersion).toBe(SCORECARD_VERSION);
    expect(a.score).toBeGreaterThanOrEqual(75);
    expect(a.bandNote).toMatch(/capped at B.*M3/);
  });
  it("points sum to the score and every reason cites real metric ids", () => {
    for (const p of PROFILES) {
      const a = run(p);
      expect(Math.round(a.scoreLines.reduce((s, l) => s + l.points, 0) * 10) / 10).toBe(a.score);
      const ids = new Set(a.metrics.map((m) => m.id));
      for (const r of a.reasons) for (const id of r.metricIds) expect(ids.has(id)).toBe(true);
    }
  });
  it("same inputs → identical assessment", () => {
    expect(run(profile("stacked-auto"))).toEqual(run(profile("stacked-auto")));
  });
  it("a knockout and its metric never produce two reasons for the same thing", () => {
    const a = run(profile("new-food-truck"));
    expect(a.reasons.filter((r) => r.metricIds.includes("M8"))).toHaveLength(1);
  });
});

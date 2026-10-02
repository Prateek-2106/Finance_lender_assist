import { computeMetrics } from "../../src/risk/metrics";
import type { BankTransaction, FundingApplication } from "../../src/domain";

const app: FundingApplication = {
  id: "a", tenantId: "t", industry: "cafe", monthsInBusiness: 36, statedMonthlyRevenueCents: 2_000_000,
  amountRequestedCents: 1_000_000, useOfFunds: "x", status: "draft", createdAt: new Date(),
};
let n = 0;
const t = (date: string, amountCents: number, category: BankTransaction["category"], balanceCents?: number): BankTransaction => ({
  id: String(++n), tenantId: "t", applicationId: "a", date, description: category, amountCents, category, rule: "test",
  fingerprint: String(n), createdAt: new Date(), ...(balanceCents !== undefined ? { balanceCents } : {}),
});
const byKey = (txns: BankTransaction[]) => Object.fromEntries(computeMetrics(app, txns).metrics.map((m) => [m.key, m]));

describe("computeMetrics on a hand-checked statement", () => {
  // Jan–Jun 2026, revenue 10k,10k,10k,12k,12k,12k (in dollars) on the 15th; one transfer and one loan credit
  const months = ["01", "02", "03", "04", "05", "06"];
  const rev = [10_000_00, 10_000_00, 10_000_00, 12_000_00, 12_000_00, 12_000_00];
  const txns = [
    t("2026-01-01", -1, "expense", 500_00),
    ...months.map((mm, i) => t(`2026-${mm}-15`, rev[i]!, "revenue", 1000_00)),
    t("2026-03-20", 50_000_00, "loan_funding", 51_000_00),
    t("2026-04-02", 9_999_00, "transfer_in", 60_000_00),
    t("2026-06-30", -1_320_00, "lender_payment", 1000_00),
  ];
  const m = byKey(txns);

  it("M1 counts only revenue, per month covered", () => {
    // 66,000 over 181 days = 66,000 / (181 / 30.4375)
    expect(m.trueMonthlyRevenue!.value).toBe(Math.round(66_000_00 / (181 / 30.4375)));
  });
  it("M2 compares the last 3 full months with the 3 before", () => {
    expect(m.revenueTrend!.value).toBeCloseTo(36 / 30);
  });
  it("M3 is the coefficient of variation of full months", () => {
    // mean 11k, sd 1k → 0.0909
    expect(m.revenueVolatility!.value).toBeCloseTo(1 / 11, 4);
  });
  it("M7 is lender payments over revenue", () => {
    expect(m.debtLoad!.value).toBeCloseTo(1320 / 66000);
  });
  it("M8 comes from the application", () => {
    expect(m.monthsInBusiness!.value).toBe(36);
  });
  it("every metric carries an id and its inputs", () => {
    const { metrics } = computeMetrics(app, txns);
    expect(metrics.map((x) => x.id)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"]);
    for (const x of metrics) expect(Object.keys(x.inputs).length).toBeGreaterThan(0);
  });
});

describe("daily balances", () => {
  it("carry the last balance across quiet days and count negative days in the last 90", () => {
    const txns = [
      t("2026-06-01", 100_00, "revenue", 100_00),
      t("2026-06-03", -300_00, "expense", -200_00), // negative from the 3rd…
      t("2026-06-06", 500_00, "revenue", 300_00), // …until the 6th: 3 negative days (3, 4, 5)
    ];
    const m = byKey(txns);
    expect(m.negativeDays!.value).toBe(3);
    // daily: 100, 100, -200, -200, -200, 300 → avg -16.67
    expect((m.balanceCushion!.inputs.avgDailyBalanceCents as number)).toBe(Math.round((100 + 100 - 600 + 300) * 100 / 6));
  });
  it("are unmeasurable (null) without a running balance column", () => {
    const m = byKey([t("2026-06-01", 100_00, "revenue"), t("2026-06-30", -50_00, "expense")]);
    expect(m.balanceCushion!.value).toBeNull();
    expect(m.negativeDays!.value).toBeNull();
  });
  it("NSF counts only the last 90 days of the statement", () => {
    const txns = [t("2026-01-02", -35_00, "nsf_fee", 0), t("2026-06-01", -35_00, "nsf_fee", 0), t("2026-06-30", 10_00, "revenue", 10)];
    expect(byKey(txns).nsfEvents!.value).toBe(1);
  });
});

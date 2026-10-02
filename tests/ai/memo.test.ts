import { buildMemoPrompt, verifyMemo, extractNumbers, writeMemo, MemoReplySchema } from "../../src/ai/memo";
import { assess } from "../../src/risk/assess";
import { classify } from "../../src/risk/classify";
import { PROFILES } from "../../fixtures/profiles";
import { generateStatement } from "../../fixtures/generate";
import type { FundingApplication } from "../../src/domain";
import { fakeLlm } from "../helpers/fakeLlm";

const p = PROFILES.find((x) => x.key === "stacked-auto")!;
const app: FundingApplication = {
  id: "a", tenantId: "t", industry: p.industry, monthsInBusiness: p.monthsInBusiness,
  statedMonthlyRevenueCents: p.statedMonthlyRevenueCents, amountRequestedCents: p.amountRequestedCents,
  useOfFunds: p.useOfFunds, status: "assessed", createdAt: new Date(),
};
const txns = generateStatement(p).map((l, i) => ({
  id: String(i), tenantId: "t", applicationId: "a", date: l.date, description: l.description, amountCents: l.amountCents,
  balanceCents: l.balanceCents, ...classify(l.description, l.amountCents), fingerprint: String(i), createdAt: new Date(),
}));
const a = assess(app, txns);
// sanity: M1 = $60,322, M7 = 22.2%, decision = review
const reply = (over: object = {}) => MemoReplySchema.parse({
  summary: { text: "Metro has healthy, steady revenue of $60,322 a month but is already paying two lenders.", cites: ["M1", "M7"] },
  strengths: [{ text: "Revenue is stable with a coefficient of variation of 0.06.", cites: ["M3"] }],
  risks: [{ text: "Existing lender payments take 22.2% of revenue.", cites: ["M7"] }],
  recommendation: "review",
  ...over,
});

describe("extractNumbers", () => {
  it("reads money, percentages and multipliers", () => {
    expect(extractNumbers("$60,322 and 22.2% at 1.13× over -$1,326")).toEqual([60322, 22.2, 1.13, -1326]);
  });
});

describe("verifyMemo", () => {
  it("keeps grounded claims", () => {
    const m = verifyMemo(app, a, reply(), "fake");
    expect(m.summary?.cites).toEqual(["M1", "M7"]);
    expect(m.strengths).toHaveLength(1);
    expect(m.risks).toHaveLength(1);
    expect(m.dropped).toEqual([]);
    expect(m.disagreement).toBe(false);
  });
  it("drops a claim citing a metric that doesn't exist", () => {
    const m = verifyMemo(app, a, reply({ risks: [{ text: "Customer concentration is high.", cites: ["M9"] }] }), "fake");
    expect(m.risks).toEqual([]);
    expect(m.dropped[0]!.why).toMatch(/unknown source M9/);
  });
  it("drops a claim with no citation", () => {
    const m = verifyMemo(app, a, reply({ strengths: [{ text: "The owner seems experienced.", cites: [] }] }), "fake");
    expect(m.dropped[0]!.why).toBe("no citation");
  });
  it("drops a claim whose number isn't in the metric it cites", () => {
    const m = verifyMemo(app, a, reply({ summary: { text: "Revenue is about $95,000 a month.", cites: ["M1"] } }), "fake");
    expect(m.summary).toBeNull();
    expect(m.dropped[0]!.why).toMatch(/95000 not found in M1/);
  });
  it("drops a right number cited to the wrong metric", () => {
    const m = verifyMemo(app, a, reply({ risks: [{ text: "Debt load is 22.2%.", cites: ["M3"] }] }), "fake");
    expect(m.risks).toEqual([]);
  });
  it("accepts small counts and sensible rounding", () => {
    const m = verifyMemo(app, a, reply({ risks: [{ text: "Over the last 90 days, lenders took about 22% of revenue.", cites: ["M7"] }] }), "fake");
    expect(m.risks).toHaveLength(1);
  });
  it("rejects claims about an offer when there is none", () => {
    expect(a.offer).toBeNull();
    const m = verifyMemo(app, a, reply({ strengths: [{ text: "The offer is affordable.", cites: ["OFFER"] }] }), "fake");
    expect(m.dropped[0]!.why).toMatch(/no(ne| offer)/);
  });
  // Regression: llama3.1:8b, 2026-10-02 live run. A true claim taken from the knockout was dropped
  // because "15%" lives in the knockout rule, not in the metrics the model cited.
  it("keeps a true claim whose number comes from a knockout on the cited metrics", () => {
    const live = { text: "The applicant's existing lender payments already exceed 15% of their daily revenue, which may indicate a cash flow issue.", cites: ["M7", "M1"] };
    expect(verifyMemo(app, a, reply({ risks: [live] }), "fake").risks).toHaveLength(1);
    expect(verifyMemo(app, a, reply({ risks: [{ ...live, cites: ["K1"] }] }), "fake").risks).toHaveLength(1);
  });
  it("still drops a wrong number in the same sentence", () => {
    const wrong = { text: "Existing lender payments already exceed 25% of daily revenue.", cites: ["M7", "M1"] };
    expect(verifyMemo(app, a, reply({ risks: [wrong] }), "fake").dropped[0]!.why).toMatch(/25/);
  });
  it("knockout numbers don't leak to claims citing unrelated metrics", () => {
    const m = verifyMemo(app, a, reply({ strengths: [{ text: "Volatility is low, under 15%.", cites: ["M3"] }] }), "fake");
    expect(m.strengths).toEqual([]);
  });

  it("flags, but does not obey, a model that disagrees with the engine", () => {
    const m = verifyMemo(app, a, reply({ recommendation: "approve" }), "fake");
    expect(m).toMatchObject({ engineDecision: "review", modelRecommendation: "approve", disagreement: true });
  });
});

describe("tolerates small-model formatting drift", () => {
  it("accepts cites as a string or with brackets, and a capitalised recommendation", () => {
    const r = MemoReplySchema.parse({ summary: { text: "x", cites: "[M1], M7" }, recommendation: " Review " });
    expect(r.summary.cites).toEqual(["M1", "M7"]);
    expect(r.recommendation).toBe("review");
  });
});

describe("the prompt", () => {
  it("contains the metrics and engine decision, never names, contacts or keys", () => {
    const sensitive = { ...app, tenantId: "TENANT-SECRET-ID", id: "APP-ID-123" } as FundingApplication & Record<string, unknown>;
    (sensitive as Record<string, unknown>).ownerName = "Pat Example";
    const { prompt, system } = buildMemoPrompt(sensitive, a);
    for (const s of ["M1", "M7", "$60,322", "review", "K1", "Existing lender payments"]) expect(prompt).toContain(s);
    for (const s of ["TENANT-SECRET-ID", "APP-ID-123", "Pat Example", "apiKey", "phone", "email"]) expect(prompt + system).not.toContain(s);
  });
});

describe("writeMemo end to end with a scripted model", () => {
  it("parses, verifies and records the model", async () => {
    const { llm } = fakeLlm("```json\n" + JSON.stringify(reply()) + "\n```");
    const m = await writeMemo(llm, app, a);
    expect(m.model).toBe("fake/test");
    expect(m.scorecardVersion).toBe(a.scorecardVersion);
  });
});

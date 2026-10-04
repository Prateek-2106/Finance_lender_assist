import request from "supertest";
import { estimatedApr } from "../../src/risk/apr";
import { makeApp, signUp } from "../helpers/app";
import { assessedApplication } from "../helpers/funding";

describe("estimatedApr", () => {
  it("a 1.25 factor over 120 business days is about 97% a year, far above '25%'", () => {
    expect(estimatedApr(3_100_000, 32_292, 120)).toBeCloseTo(0.968, 2);
  });
  it("an ordinary 1-year loan comes out near its real rate", () => {
    expect(estimatedApr(100_000, Math.ceil((100_000 * 1.0544) / 252), 252)).toBeCloseTo(0.109, 2);
  });
  it("no cost is 0%; bad inputs throw", () => {
    expect(estimatedApr(1000, 10, 100)).toBe(0);
    expect(() => estimatedApr(0, 1, 1)).toThrow(RangeError);
  });
});

async function viewFor(key: string, overrides: Record<string, unknown> = {}) {
  const { app } = makeApp();
  const t = await signUp(app, { name: "Biz" });
  const as = { Host: t.host, Authorization: `Bearer ${t.apiKey}` };
  const { id } = await assessedApplication(app, as, key, overrides);
  return (await request(app).get(`/api/applications/${id}`).set(as)).body;
}

describe("what the applicant sees", () => {
  it("approved: amount, total cost, daily payment, months and APR in plain words", async () => {
    const { applicantView: v, application } = await viewFor("steady-bakery");
    expect(v.status).toBe("approved");
    expect(v.headline).toBe("You're approved for $31,000");
    expect(v.summary).toBe(
      "You'd repay $38,750 in total, as $322.92 each business day for about 5.5 months. That's $7,750 for the money, about 97% a year as an estimated APR.",
    );
    expect(v.decidedBy).toBe("Decided automatically from your bank statement");
    expect(v.nextSteps[0]).toMatch(/less than the \$40,000 you asked for/);
    expect(application).not.toHaveProperty("memo"); // the underwriting memo is internal
  });

  it("declined: every reason comes with what would help, no jargon", async () => {
    const { applicantView: v } = await viewFor("struggling-salon");
    expect(v.status).toBe("declined");
    expect(v.headline).toBe("We can't offer funding right now");
    expect(v.reasons[0].text).toMatch(/overdraft or returned-payment fees in the last 90 days/);
    for (const r of v.reasons) {
      expect(r.whatWouldHelp.length).toBeGreaterThan(10);
      expect(r.text).not.toMatch(/\bM\d\b|band|score|coefficient/i);
    }
  });

  it("too new: says when they can apply again", async () => {
    const { applicantView: v } = await viewFor("new-food-truck");
    expect(v.reasons[0]).toEqual({
      text: "Funding on Mainstreet needs at least 6 months in business. You've been operating for 4.",
      whatWouldHelp: "You can apply again in about 2 months.",
    });
  });

  it("under review: explains why a person is looking, and stacking in everyday words", async () => {
    const { applicantView: v } = await viewFor("stacked-auto");
    expect(v.status).toBe("pending_review");
    expect(v.headline).toBe("A specialist is reviewing your application");
    expect(v.reasons[0].text).toMatch(/existing loans or advances, about \$823 each business day/);
    expect(v.reasons[0].whatWouldHelp).toMatch(/Paying off or finishing one of your current advances/);
  });
});

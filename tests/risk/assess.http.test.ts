import request from "supertest";
import { makeApp, signUp } from "../helpers/app";
import { PROFILES } from "../../fixtures/profiles";
import { generateStatement, toCsv } from "../../fixtures/generate";
import { ApplicationCreateSchema } from "../../src/schemas";

const p = PROFILES.find((x) => x.key === "inflated-contractor")!;
const body = {
  industry: p.industry, monthsInBusiness: p.monthsInBusiness, statedMonthlyRevenueCents: p.statedMonthlyRevenueCents,
  amountRequestedCents: p.amountRequestedCents, useOfFunds: p.useOfFunds,
};

async function setup() {
  const ctx = makeApp();
  const owner = await signUp(ctx.app, { name: "Summit Contracting" });
  const other = await signUp(ctx.app, { name: "Someone Else" });
  const as = (w: typeof owner) => ({ Host: w.host, Authorization: `Bearer ${w.apiKey}` });
  const appId = (await request(ctx.app).post("/api/applications").set(as(owner)).send(body)).body.application.id as string;
  return { ...ctx, owner, other, as, appId };
}

describe("POST /api/applications/:id/assess", () => {
  it("needs statements first", async () => {
    const { app, owner, as, appId } = await setup();
    expect((await request(app).post(`/api/applications/${appId}/assess`).set(as(owner))).status).toBe(400);
  });

  it("assesses, stores the result, and locks further uploads", async () => {
    const { app, owner, as, appId } = await setup();
    const csv = toCsv(p, generateStatement(p));
    await request(app).post(`/api/applications/${appId}/statements`).set(as(owner)).set("content-type", "text/csv").send(csv);

    const res = await request(app).post(`/api/applications/${appId}/assess`).set(as(owner));
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe("assessed");
    expect(res.body.application.assessment).toMatchObject({ decision: "review", band: "A" });
    expect(res.body.application.assessment.reasons[0].text).toMatch(/Stated revenue/);

    const stored = await request(app).get(`/api/applications/${appId}`).set(as(owner));
    expect(stored.body.application.assessment.score).toBe(res.body.application.assessment.score);

    const late = await request(app).post(`/api/applications/${appId}/statements`).set(as(owner)).set("content-type", "text/csv").send(csv);
    expect(late.status).toBe(422);

    // re-assessing is allowed and gives the same answer
    const again = await request(app).post(`/api/applications/${appId}/assess`).set(as(owner));
    expect(again.body.application.assessment.score).toBe(res.body.application.assessment.score);
  });

  it("is owner-only and tenant-scoped", async () => {
    const { app, owner, other, as, appId } = await setup();
    expect((await request(app).post(`/api/applications/${appId}/assess`).set("Host", owner.host)).status).toBe(401);
    expect((await request(app).post(`/api/applications/${appId}/assess`).set(as(other))).status).toBe(404);
  });
});

describe("fair lending guardrail", () => {
  it("the application schema drops personal and protected fields, so scoring can never see them", () => {
    const parsed = ApplicationCreateSchema.parse({
      ...body, ownerName: "Pat", ownerAge: 52, ownerGender: "f", ownerRace: "x", ownerZip: "14214", maritalStatus: "married",
    });
    expect(Object.keys(parsed).sort()).toEqual(["amountRequestedCents", "industry", "monthsInBusiness", "statedMonthlyRevenueCents", "useOfFunds"]);
  });
});

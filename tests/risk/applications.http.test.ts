import request from "supertest";
import { makeApp, signUp } from "../helpers/app";
import { PROFILES } from "../../fixtures/profiles";
import { generateStatement, toCsv } from "../../fixtures/generate";

const body = {
  industry: "restaurant",
  monthsInBusiness: 84,
  statedMonthlyRevenueCents: 4_500_000,
  amountRequestedCents: 4_000_000,
  useOfFunds: "Second oven",
};

async function setup() {
  const ctx = makeApp();
  const joe = await signUp(ctx.app, { name: "Rosa's Bakery" });
  const ana = await signUp(ctx.app, { name: "Ana's Salon" });
  const as = (who: typeof joe) => ({ Host: who.host, Authorization: `Bearer ${who.apiKey}` });
  const created = await request(ctx.app).post("/api/applications").set(as(joe)).send(body);
  return { ...ctx, joe, ana, as, appId: created.body.application.id as string, created };
}

const upload = (app: Parameters<typeof request>[0], headers: Record<string, string>, appId: string, csv: string) =>
  request(app).post(`/api/applications/${appId}/statements`).set(headers).set("content-type", "text/csv").send(csv);

describe("funding applications", () => {
  it("creates a draft application for the tenant", async () => {
    const { created, joe } = await setup();
    expect(created.status).toBe(201);
    expect(created.body.application).toMatchObject({ ...body, tenantId: joe.tenant.id, status: "draft" });
  });
  it("validates input", async () => {
    const { app, joe, as } = await setup();
    const res = await request(app).post("/api/applications").set(as(joe)).send({ ...body, amountRequestedCents: -1 });
    expect(res.status).toBe(400);
  });
  it("requires the owner key and isolates tenants", async () => {
    const { app, joe, ana, as, appId } = await setup();
    expect((await request(app).get(`/api/applications/${appId}`).set("Host", joe.host)).status).toBe(401);
    expect((await request(app).get(`/api/applications/${appId}`).set(as(ana))).status).toBe(404);
    expect((await upload(app, as(ana), appId, "Date,Description,Amount\n2026-07-01,X,1\n")).status).toBe(404);
  });
});

describe("statement upload", () => {
  const p = PROFILES.find((x) => x.key === "stacked-auto")!;
  const lines = generateStatement(p);
  const csv = toCsv(p, lines);

  it("classifies every line and totals match the ground truth", async () => {
    const { app, joe, as, appId } = await setup();
    const res = await upload(app, as(joe), appId, csv);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: lines.length, inserted: lines.length, duplicates: 0 });

    const summary = await request(app).get(`/api/applications/${appId}/transactions`).set(as(joe));
    expect(summary.body.period).toEqual({ from: "2026-04-01", to: lines.at(-1)!.date });
    for (const cat of ["revenue", "lender_payment", "loan_funding", "expense"]) {
      const truth = lines.filter((l) => l.truth === cat);
      expect(summary.body.totals[cat], cat).toEqual({ count: truth.length, amountCents: truth.reduce((s, l) => s + l.amountCents, 0) });
    }
    const lender = await request(app).get(`/api/applications/${appId}/transactions?category=lender_payment`).set(as(joe));
    expect(lender.body.transactions.every((t: { rule: string }) => t.rule === "debit.known_funder")).toBe(true);
  });

  it("re-uploading the same statement adds nothing; an overlapping one adds only new lines", async () => {
    const { app, joe, as, appId } = await setup();
    await upload(app, as(joe), appId, csv);
    expect((await upload(app, as(joe), appId, csv)).body).toEqual({ received: lines.length, inserted: 0, duplicates: lines.length });
    const extra = csv + "2026-10-01,SQUARE INC DEP,100.00,\n";
    expect((await upload(app, as(joe), appId, extra)).body.inserted).toBe(1);
  });

  it("rejects a bad file with line numbers and saves nothing", async () => {
    const { app, joe, as, appId } = await setup();
    const res = await upload(app, as(joe), appId, "Date,Description,Amount\n2026-07-01,OK,10.00\n2026-07-02,BAD,ten\n");
    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual([{ line: 3, message: "bad or missing amount" }]);
    const summary = await request(app).get(`/api/applications/${appId}/transactions`).set(as(joe));
    expect(summary.body.transactions).toEqual([]);
  });

  it("rejects an empty body and an unknown category filter", async () => {
    const { app, joe, as, appId } = await setup();
    expect((await upload(app, as(joe), appId, "")).status).toBe(400);
    expect((await request(app).get(`/api/applications/${appId}/transactions?category=bogus`).set(as(joe))).status).toBe(400);
  });
});

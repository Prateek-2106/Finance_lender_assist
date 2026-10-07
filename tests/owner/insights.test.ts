import request from "supertest";
import { makeApp, signUp } from "../helpers/app";
import { insights } from "../../src/services/insights";

const items = [{ description: "Water heater flush", quantity: 1, unitPriceCents: 12900 }];

describe("after payment: the pipeline feeds insights", () => {
  it("counts the funnel, revenue, days to pay and returning customers", async () => {
    const { app, deps } = makeApp();
    const joe = await signUp(app, { name: "Joe's Plumbing" });
    const as = { Host: joe.host, Authorization: `Bearer ${joe.apiKey}` };
    const lead = (name: string, email: string) =>
      request(app).post("/api/leads").set("Host", joe.host).send({ name, email, message: "Leak" }).then((r) => r.body.lead.id as string);

    const l1 = await lead("Ann", "ann@x.co");
    await lead("Ann", "ann@x.co"); // same customer again
    const l3 = await lead("Bob", "bob@x.co");
    await lead("Cy", "cy@x.co");

    // Ann: sent → accepted → invoiced → paid. Bob: sent → declined. Cy: never quoted.
    const est = async (leadId: string) => (await request(app).post("/api/estimates").set(as).send({ leadId, lineItems: items })).body.estimate.id as string;
    const a = await est(l1);
    for (const to of ["sent", "accepted"]) await request(app).post(`/api/estimates/${a}/transition`).set(as).send({ to });
    const inv = (await request(app).post(`/api/estimates/${a}/invoice`).set(as)).body.invoice;
    await request(app).post(`/api/invoices/${inv.id}/pay`).set(as);
    const b = await est(l3);
    for (const to of ["sent", "declined"]) await request(app).post(`/api/estimates/${b}/transition`).set(as).send({ to });

    const { body } = await request(app).get("/api/insights").set(as);
    const s = body.insights;
    expect(s.funnel).toEqual({ leads: 4, estimatesSent: 2, accepted: 1, paid: 1 });
    expect(s.conversion).toEqual({ leadToEstimatePercent: 50, estimateToAcceptedPercent: 50, acceptedToPaidPercent: 100 });
    expect(s.revenue).toMatchObject({ paidCents: 12900, averageJobCents: 12900, outstandingCents: 0 });
    expect(s.revenue.byMonth).toHaveLength(6);
    expect(s.revenue.byMonth.at(-1).revenueCents).toBe(12900);
    expect(s.customers).toEqual({ total: 3, returning: 1 });
    expect(s.leadsBySource).toEqual({ web: 4, sms: 0 });

    // and it's tenant-scoped like everything else
    const other = await signUp(app, { name: "Someone Else" });
    const empty = await insights(deps.repos, other.tenant.id);
    expect(empty.funnel).toEqual({ leads: 0, estimatesSent: 0, accepted: 0, paid: 0 });
    expect(empty.conversion.leadToEstimatePercent).toBeNull();
  });

  it("gross income is before sales tax; the tax collected is shown apart", async () => {
    const { app } = makeApp();
    const joe = await signUp(app, { name: "Joe's Plumbing", taxRateBps: 1000 });
    const as = { Host: joe.host, Authorization: `Bearer ${joe.apiKey}` };
    const est = (await request(app).post("/api/estimates").set(as).send({ customer: { name: "Ann", email: "ann@x.co" }, lineItems: items })).body.estimate.id;
    for (const to of ["sent", "accepted"]) await request(app).post(`/api/estimates/${est}/transition`).set(as).send({ to });
    const inv = (await request(app).post(`/api/estimates/${est}/invoice`).set(as)).body.invoice;
    await request(app).post(`/api/invoices/${inv.id}/pay`).set(as);
    const s = (await request(app).get("/api/insights").set(as)).body.insights;
    expect(s.revenue).toMatchObject({ paidCents: 14190, grossCents: 12900, taxCollectedCents: 1290, averageJobCents: 12900 });
    expect(s.revenue.byMonth.at(-1)).toMatchObject({ grossCents: 12900, taxCents: 1290, revenueCents: 14190, invoices: 1 });
  });

  it("is owner-only", async () => {
    const { app } = makeApp();
    const joe = await signUp(app, { name: "Joe" });
    expect((await request(app).get("/api/insights").set("Host", joe.host)).status).toBe(401);
  });
});

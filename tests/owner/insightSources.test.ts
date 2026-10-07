// Every number on the Statistics page can be opened to the records behind it, and they add up.
import request from "supertest";
import { makeApp, signUp } from "../helpers/app";
import { computeTotals } from "../../src/lib/money";

async function setup() {
  const { app, deps } = makeApp();
  const joe = await signUp(app, { name: "Joe's Plumbing", taxRateBps: 875 });
  const as = { Host: joe.host, Authorization: `Bearer ${joe.apiKey}` };
  const tenantId = joe.tenant.id;
  const leads = [];
  for (const [name, email] of [["Ann", "ann@x.co"], ["Ann", "ann@x.co"], ["Bob", "bob@x.co"]])
    leads.push((await request(app).post("/api/leads").set("Host", joe.host).send({ name, email, message: "Leak" })).body.lead.id);
  // Paid invoices in two months, and one still open
  const paid = async (paidAt: string, lineItems: { description: string; quantity: number; unitPriceCents: number }[], name: string) => {
    const e = await deps.repos.estimates.create({ tenantId, lineItems, taxRateBps: 875, status: "invoiced", customer: { name } });
    return deps.repos.invoices.create({
      tenantId, estimateId: e.id, number: await deps.repos.invoices.nextNumber(tenantId), billTo: { name }, lineItems, taxRateBps: 875,
      totals: computeTotals(lineItems, 875), status: paidAt ? "paid" : "open", ...(paidAt ? { paidAt: new Date(paidAt) } : {}), createdAt: new Date("2026-08-25T12:00:00Z"),
    });
  };
  const flush = { description: "Water heater flush", quantity: 1, unitPriceCents: 12900 };
  const labor = { description: "Labor", quantity: 1.5, unitPriceCents: 9500 };
  await paid("2026-09-03T15:00:00Z", [flush, labor], "Ann");
  await paid("2026-09-20T15:00:00Z", [flush], "Cy");
  await paid("2026-10-02T15:00:00Z", [labor], "Bob");
  await paid("", [flush], "Dee");
  const get = (q: string) => request(app).get(`/api/insights/sources?${q}`).set(as);
  return { app, as, get, joe };
}

describe("GET /api/insights/sources", () => {
  it("a month's income opens to the invoices paid that month and the services on them", async () => {
    const { get } = await setup();
    const { body } = await get("kind=paid&month=2026-09");
    const s = body.sources;
    expect(s.invoices.map((i: { customer: string }) => i.customer)).toEqual(["Cy", "Ann"]); // newest payment first
    expect(s.invoices[1]).toMatchObject({ number: "INV-0001", subtotalCents: 27150, daysToPay: 9.1 });
    expect(s.invoices[1].items).toEqual([
      { description: "Water heater flush", quantity: 1, unitPriceCents: 12900, amountCents: 12900 },
      { description: "Labor", quantity: 1.5, unitPriceCents: 9500, amountCents: 14250 },
    ]);
    expect(s.services).toEqual([
      { description: "Water heater flush", quantity: 2, amountCents: 25800 },
      { description: "Labor", quantity: 1.5, amountCents: 14250 },
    ]);
    // ...and they add up to the month's gross income
    const sum = s.invoices.reduce((a: number, i: { subtotalCents: number }) => a + i.subtotalCents, 0);
    expect(sum).toBe(s.services.reduce((a: number, x: { amountCents: number }) => a + x.amountCents, 0));
  });

  it("all-time paid matches gross income; unpaid matches what's owed", async () => {
    const { get, app, as } = await setup();
    const stats = (await request(app).get("/api/insights").set(as)).body.insights;
    const paid = (await get("kind=paid")).body.sources.invoices;
    expect(paid).toHaveLength(stats.funnel.paid);
    expect(paid.reduce((a: number, i: { subtotalCents: number }) => a + i.subtotalCents, 0)).toBe(stats.revenue.grossCents);
    const open = (await get("kind=unpaid")).body.sources.invoices;
    expect(open.map((i: { customer: string }) => i.customer)).toEqual(["Dee"]);
    expect(open[0].totalCents).toBe(stats.revenue.outstandingCents);
  });

  it("requests, quotes and customers open to their lists", async () => {
    const { get } = await setup();
    const req = (await get("kind=requests")).body.sources.requests;
    expect(req).toHaveLength(3);
    expect((await get("kind=requests&source=sms")).body.sources.requests).toHaveLength(0);
    expect((await get("kind=accepted")).body.sources.estimates).toHaveLength(4); // invoiced counts as won
    expect((await get("kind=customers&returning=1")).body.sources.customers.map((c: { name: string }) => c.name)).toEqual(["Ann"]);
  });

  it("checks its input, and is owner-only", async () => {
    const { get, app, joe } = await setup();
    expect((await get("kind=everything")).status).toBe(400);
    expect((await get("kind=paid&month=September")).status).toBe(400);
    expect((await request(app).get("/api/insights/sources?kind=paid").set("Host", joe.host)).status).toBe(401);
  });
});

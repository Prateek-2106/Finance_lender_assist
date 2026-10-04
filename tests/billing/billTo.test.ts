import request from "supertest";
import { makeApp, signUp } from "../helpers/app";
import { renderInvoicePdf } from "../../src/lib/invoicePdf";

const items = [{ description: "Water heater flush", quantity: 1, unitPriceCents: 12900 }];

async function setup() {
  const ctx = makeApp();
  const joe = await signUp(ctx.app, { name: "Joe's Plumbing", taxRateBps: 875 });
  const as = { Host: joe.host, Authorization: `Bearer ${joe.apiKey}` };
  return { ...ctx, joe, as };
}
async function invoiceFor(app: Parameters<typeof request>[0], as: Record<string, string>, body: object) {
  const { body: b } = await request(app).post("/api/estimates").set(as).send({ lineItems: items, ...body });
  for (const to of ["sent", "accepted"]) await request(app).post(`/api/estimates/${b.estimate.id}/transition`).set(as).send({ to });
  return { estimate: b.estimate, invoice: (await request(app).post(`/api/estimates/${b.estimate.id}/invoice`).set(as)).body.invoice };
}

describe("who the job is for", () => {
  it("an estimate from a lead carries the customer, and the invoice freezes it as Bill to", async () => {
    const { app, joe, as } = await setup();
    const lead = await request(app).post("/api/leads").set("Host", joe.host).send({ name: "Ann Lee", phone: "716-555-0123", email: "ANN@x.co", message: "Leak" });
    const { estimate, invoice } = await invoiceFor(app, as, { leadId: lead.body.lead.id });
    expect(estimate.customer).toEqual({ name: "Ann Lee", phone: "+17165550123", email: "ann@x.co" });
    expect(invoice.billTo).toEqual(estimate.customer);
    const paid = await request(app).post(`/api/invoices/${invoice.id}/pay`).set(as);
    expect(paid.body.receipt.billTo.name).toBe("Ann Lee");
  });

  it("an estimate without a lead can name its customer directly (cleaned like a lead)", async () => {
    const { app, as } = await setup();
    const { invoice } = await invoiceFor(app, as, { customer: { name: "Walk-in Bob", phone: "(716) 555 9999" } });
    expect(invoice.billTo).toEqual({ name: "Walk-in Bob", phone: "+17165559999" });
    expect((await request(app).post("/api/estimates").set(as).send({ lineItems: items, customer: { name: "X", email: "bad" } })).status).toBe(400);
  });

  it("the PDF prints a Bill to block", async () => {
    const buf = await renderInvoicePdf(
      {
        id: "i", tenantId: "t", estimateId: "e", number: "INV-0007", billTo: { name: "Ann Lee", phone: "+17165550123", email: "ann@x.co" },
        lineItems: items, taxRateBps: 0, totals: { subtotalCents: 12900, taxCents: 0, totalCents: 12900 }, status: "open", createdAt: new Date(),
      },
      { name: "Joe's Plumbing" },
      { compress: false },
    );
    const text = [...buf.toString("latin1").matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1]!, "hex").toString("latin1")).join("");
    for (const s of ["Bill to", "Ann Lee", "+17165550123", "ann@x.co"]) expect(text).toContain(s);
  });

  it("repeat requests from the same person link to one customer", async () => {
    const { app, joe, as } = await setup();
    const a = await request(app).post("/api/leads").set("Host", joe.host).send({ name: "Ann", email: "ann@x.co", message: "Leak" });
    const b = await request(app).post("/api/leads").set("Host", joe.host).send({ name: "Ann Lee", email: "ann@x.co", phone: "716-555-0123", message: "Anode rod" });
    expect(b.body.lead.customerId).toBe(a.body.lead.customerId);
    const customers = (await request(app).get("/api/customers").set(as)).body.customers;
    expect(customers).toEqual([expect.objectContaining({ name: "Ann Lee", leadCount: 2, phone: "+17165550123" })]);
  });
});

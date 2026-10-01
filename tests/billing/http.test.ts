import request from "supertest";
import { makeApp, signUp } from "../helpers/app";
import { renderInvoicePdf } from "../../src/lib/invoicePdf";

const items = [
  { description: "Water heater flush", quantity: 1, unitPriceCents: 12900 },
  { description: "Labor", quantity: 2, unitPriceCents: 9500 },
];

async function setup() {
  const ctx = makeApp();
  const joe = await signUp(ctx.app, { name: "Joe's Plumbing", taxRateBps: 875 });
  const ana = await signUp(ctx.app, { name: "Ana's Salon" });
  const as = (who: typeof joe) => ({ Host: who.host, Authorization: `Bearer ${who.apiKey}` });
  return { ...ctx, joe, ana, as };
}

describe("estimate → invoice → receipt over HTTP", () => {
  it("runs the whole lifecycle", async () => {
    const { app, joe, as } = await setup();
    const created = await request(app).post("/api/estimates").set(as(joe)).send({ lineItems: items });
    expect(created.status).toBe(201);
    expect(created.body.estimate.totals.totalCents).toBe(34691);
    const id = created.body.estimate.id;

    for (const to of ["sent", "accepted"])
      expect((await request(app).post(`/api/estimates/${id}/transition`).set(as(joe)).send({ to })).status).toBe(200);

    const inv = await request(app).post(`/api/estimates/${id}/invoice`).set(as(joe));
    expect(inv.status).toBe(201);
    expect(inv.body.invoice.number).toBe("INV-0001");

    const again = await request(app).post(`/api/estimates/${id}/invoice`).set(as(joe));
    expect(again.status).toBe(200);
    expect(again.body.invoice.id).toBe(inv.body.invoice.id);

    const paid = await request(app).post(`/api/invoices/${inv.body.invoice.id}/pay`).set(as(joe));
    expect(paid.status).toBe(200);
    expect(paid.body.receipt).toMatchObject({ invoiceNumber: "INV-0001", amountPaidCents: 34691 });
  });

  it("returns 422 for illegal transitions and 400 for bad input", async () => {
    const { app, joe, as } = await setup();
    const { body } = await request(app).post("/api/estimates").set(as(joe)).send({ lineItems: items });
    const bad = await request(app).post(`/api/estimates/${body.estimate.id}/transition`).set(as(joe)).send({ to: "accepted" });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatch(/draft.*accepted/);
    expect((await request(app).post("/api/estimates").set(as(joe)).send({ lineItems: [{ description: "x", quantity: 1, unitPriceCents: 1.5 }] })).status).toBe(400);
    expect((await request(app).post(`/api/estimates/${body.estimate.id}/transition`).set(as(joe)).send({ to: "teleported" })).status).toBe(400);
  });

  it("requires the owner key and isolates tenants", async () => {
    const { app, joe, ana, as } = await setup();
    expect((await request(app).post("/api/estimates").set("Host", joe.host).send({ lineItems: items })).status).toBe(401);
    const { body } = await request(app).post("/api/estimates").set(as(joe)).send({ lineItems: items });
    expect((await request(app).get(`/api/estimates/${body.estimate.id}`).set(as(ana))).status).toBe(404);
  });

  it("serves the invoice as a PDF", async () => {
    const { app, joe, as } = await setup();
    const { body } = await request(app).post("/api/estimates").set(as(joe)).send({ lineItems: items });
    for (const to of ["sent", "accepted"]) await request(app).post(`/api/estimates/${body.estimate.id}/transition`).set(as(joe)).send({ to });
    const inv = await request(app).post(`/api/estimates/${body.estimate.id}/invoice`).set(as(joe));
    const pdf = await request(app)
      .get(`/api/invoices/${inv.body.invoice.id}/pdf`)
      .set(as(joe))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("renderInvoicePdf", () => {
  it("contains the business name, invoice number and total", async () => {
    const buf = await renderInvoicePdf(
      {
        id: "i1",
        tenantId: "t1",
        estimateId: "e1",
        number: "INV-0042",
        lineItems: items,
        taxRateBps: 875,
        totals: { subtotalCents: 31900, taxCents: 2791, totalCents: 34691 },
        status: "open",
        createdAt: new Date("2026-10-01T00:00:00Z"),
      },
      { name: "Joe's Plumbing" },
      { compress: false },
    );
    // pdfkit writes text as hex glyph strings; decode them to search the content
    const hex = [...buf.toString("latin1").matchAll(/<([0-9a-f]+)>/g)].map((m) => Buffer.from(m[1]!, "hex").toString("latin1")).join("");
    for (const s of ["INV-0042", "$346.91", "8.75%"]) expect(hex).toContain(s);
  });
});

import request from "supertest";
import { makeApp, signUp, fakeMailer } from "../helpers/app";
import { assessedApplication } from "../helpers/funding";
import { computeTwilioSignature } from "../../src/webhooks/twilio";

async function setup(ownerEmail: string | undefined = "joe@joesplumbing.com") {
  const mail = fakeMailer();
  const ctx = makeApp({ mailer: mail.mailer });
  const joe = await signUp(ctx.app, { name: "Joe's Plumbing", taxRateBps: 875, ...(ownerEmail ? { ownerEmail } : {}) });
  const as = { Host: joe.host, Authorization: `Bearer ${joe.apiKey}` };
  const messages = async () => (await request(ctx.app).get("/api/messages").set(as)).body.messages as { template: string; status: string; to?: string; error?: string }[];
  return { ...ctx, mail, joe, as, messages };
}
const items = [
  { description: "Water heater flush", quantity: 1, unitPriceCents: 12900 },
  { description: "Labor", quantity: 2, unitPriceCents: 9500 },
];

describe("emails at each stage", () => {
  it("a quote request emails the customer a confirmation and the owner a new-lead alert", async () => {
    const { app, joe, mail, emailsSettled, messages } = await setup();
    await request(app).post("/api/leads").set("Host", joe.host).send({ name: "Ann Lee", email: "ann@x.co", message: "Leaky heater" });
    await emailsSettled();
    expect(mail.sent.map((m) => [m.to, m.subject])).toEqual(
      expect.arrayContaining([
        ["ann@x.co", "We got your request - Joe's Plumbing"],
        ["joe@joesplumbing.com", "New lead: Ann Lee"],
      ]),
    );
    expect(mail.sent.find((m) => m.to === "joe@joesplumbing.com")!.text).toContain("https://joes-plumbing.lvh.me/app#/leads");
    expect((await messages()).every((m) => m.status === "sent")).toBe(true);
  });

  it("a text-message lead has no email: the customer email is logged as skipped, not lost", async () => {
    const { app, joe, mail, emailsSettled, messages } = await setup();
    const path = `/webhooks/sms/${joe.tenant.id}`;
    const params = { From: "+17165550123", Body: "Need a quote" };
    await request(app)
      .post(path)
      .type("form")
      .set("X-Twilio-Signature", computeTwilioSignature("test-token", `https://hooks.example.com${path}`, params))
      .send(params);
    await emailsSettled();
    expect(mail.sent.map((m) => m.to)).toEqual(["joe@joesplumbing.com"]);
    expect(await messages()).toContainEqual(expect.objectContaining({ template: "lead_received_customer", status: "skipped", error: "no email address on file" }));
  });

  it("estimate sent, invoice issued (with PDF, only once) and receipt all reach the customer", async () => {
    const { app, joe, as, mail, emailsSettled } = await setup();
    const lead = await request(app).post("/api/leads").set("Host", joe.host).send({ name: "Ann Lee", email: "ann@x.co", message: "Leak" });
    const { body } = await request(app).post("/api/estimates").set(as).send({ leadId: lead.body.lead.id, lineItems: items });
    const id = body.estimate.id;
    for (const to of ["sent", "accepted"]) await request(app).post(`/api/estimates/${id}/transition`).set(as).send({ to });
    const inv = await request(app).post(`/api/estimates/${id}/invoice`).set(as);
    await request(app).post(`/api/estimates/${id}/invoice`).set(as); // converting twice must not email twice
    await request(app).post(`/api/invoices/${inv.body.invoice.id}/pay`).set(as);
    await emailsSettled();

    const toAnn = mail.sent.filter((m) => m.to === "ann@x.co");
    expect(toAnn.map((m) => m.subject)).toEqual([
      "We got your request - Joe's Plumbing",
      "Your estimate from Joe's Plumbing: $346.91",
      "Invoice INV-0001 from Joe's Plumbing",
      "Receipt for INV-0001 - Joe's Plumbing",
    ]);
    const invoiceMail = toAnn[2]!;
    expect(invoiceMail.attachments?.[0]).toMatchObject({ filename: "INV-0001.pdf", contentType: "application/pdf" });
    expect(invoiceMail.attachments![0]!.content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(toAnn[3]!.text).toContain("$346.91");
  });

  it("a failing mail server never breaks the action, and the failure is logged", async () => {
    const { app, joe, mail, emailsSettled, messages } = await setup();
    mail.fail = true;
    const res = await request(app).post("/api/leads").set("Host", joe.host).send({ name: "Ann", email: "ann@x.co", message: "Leak" });
    expect(res.status).toBe(201);
    await emailsSettled();
    const log = await messages();
    expect(log).toHaveLength(2);
    expect(log.every((m) => m.status === "failed" && m.error === "SMTP connection refused")).toBe(true);
  });

  it("with email turned off, every message is logged as skipped", async () => {
    const ctx = makeApp(); // no mailer
    const joe = await signUp(ctx.app, { name: "Joe", ownerEmail: "joe@x.co" });
    await request(ctx.app).post("/api/leads").set("Host", joe.host).send({ name: "Ann", email: "ann@x.co", message: "Leak" });
    await ctx.emailsSettled();
    const log = (await request(ctx.app).get("/api/messages").set({ Host: joe.host, Authorization: `Bearer ${joe.apiKey}` })).body.messages;
    expect(log.map((m: { status: string }) => m.status)).toEqual(["skipped", "skipped"]);
  });

  it("the owner is emailed the funding decision in plain words", async () => {
    const { app, as, mail, emailsSettled } = await setup();
    await assessedApplication(app, as, "steady-bakery");
    await emailsSettled();
    const m = mail.sent.find((x) => x.to === "joe@joesplumbing.com")!;
    expect(m.subject).toBe("You're approved - $40,000 request");
    expect(m.text).toContain("You're approved for $31,000");
    expect(m.text).toContain("estimated APR");
  });

  it("an owner can set where their notifications go", async () => {
    const { app, as } = await setup(undefined);
    const res = await request(app).patch("/api/settings").set(as).send({ ownerEmail: " Joe@Example.COM " });
    expect(res.body.settings.ownerEmail).toBe("joe@example.com");
    expect((await request(app).patch("/api/settings").set(as).send({ ownerEmail: "nope" })).status).toBe(400);
  });
});

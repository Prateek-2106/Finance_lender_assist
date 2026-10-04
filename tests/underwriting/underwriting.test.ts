import request from "supertest";
import { makeApp, signUp, fakeMailer, asUnderwriter, UW_KEY_2 } from "../helpers/app";
import { assessedApplication } from "../helpers/funding";
import { fakeLlm } from "../helpers/fakeLlm";

async function setup(llmReplies: object[] = []) {
  const mail = fakeMailer();
  const fake = fakeLlm(...llmReplies);
  const ctx = makeApp({ mailer: mail.mailer, llm: fake.llm });
  const metro = await signUp(ctx.app, { name: "Metro Auto Repair", ownerEmail: "owner@metro.co" });
  const summit = await signUp(ctx.app, { name: "Summit Contracting" });
  const rosa = await signUp(ctx.app, { name: "Rosa's Bakery" });
  const as = (w: typeof metro) => ({ Host: w.host, Authorization: `Bearer ${w.apiKey}` });
  const stacked = await assessedApplication(ctx.app, as(metro), "stacked-auto");
  const inflated = await assessedApplication(ctx.app, as(summit), "inflated-contractor");
  const bakery = await assessedApplication(ctx.app, as(rosa), "steady-bakery");
  return { ...ctx, mail, prompts: fake.prompts, metro, summit, rosa, as, stacked, inflated, bakery };
}
const decide = (app: Parameters<typeof request>[0], id: string, body: object, key?: string) =>
  request(app).post(`/api/underwriting/applications/${id}/decision`).set(asUnderwriter(key)).send(body);

describe("underwriter sign-in", () => {
  it("needs an underwriter key; a business owner's key is not one", async () => {
    const { app, metro } = await setup();
    expect((await request(app).get("/api/underwriting/queue")).status).toBe(401);
    expect((await request(app).get("/api/underwriting/queue").set("Authorization", `Bearer ${metro.apiKey}`)).status).toBe(403);
    expect((await request(app).get("/api/underwriting/me").set(asUnderwriter())).body).toEqual({ name: "Priya Shah" });
  });
});

describe("the review queue", () => {
  it("holds only 'review' cases, from every business, oldest first, with business names", async () => {
    const { app, stacked, inflated } = await setup();
    const { body } = await request(app).get("/api/underwriting/queue").set(asUnderwriter());
    expect(body.pending.map((r: { id: string }) => r.id)).toEqual([stacked.id, inflated.id]);
    expect(body.pending[0]).toMatchObject({ business: "Metro Auto Repair", engine: { decision: "review" } });
    expect(body.recent.map((r: { business: string }) => r.business)).toEqual(["Rosa's Bakery"]); // decided automatically
  });

  it("the detail compares the bank's revenue with invoices paid through Mainstreet", async () => {
    const { app, inflated } = await setup();
    const { body } = await request(app).get(`/api/underwriting/applications/${inflated.id}`).set(asUnderwriter());
    expect(body.business.name).toBe("Summit Contracting");
    expect(body.platformRevenue).toMatchObject({ paidInvoices: 0, paidCents: 0 });
    expect(body.platformRevenue.bankRevenueCents).toBeGreaterThan(0);
  });
});

describe("deciding a case", () => {
  it("approving records who, when and why; the owner sees 'Reviewed by' and the note, and is emailed", async () => {
    const { app, metro, as, stacked, mail, emailsSettled } = await setup();
    const res = await decide(app, stacked.id, { outcome: "approve", amountCents: 1_500_000, note: "One advance pays off in 3 weeks; small amount is affordable then." });
    expect(res.status).toBe(200);
    expect(res.body.application.decision).toMatchObject({ outcome: "approved", decidedBy: { kind: "underwriter", name: "Priya Shah" } });
    expect(res.body.application.decision.offer).toMatchObject({ amountCents: 1_500_000, factorRate: 1.35, limitedBy: "underwriter" });
    expect(res.body.totalHoldbackOfDailyRevenue).toBeGreaterThan(0.15); // the console shows the risk taken knowingly
    expect(res.body.application.decisionLog.map((d: { decidedBy: { kind: string } }) => d.decidedBy.kind)).toEqual(["scorecard", "underwriter"]);

    const owner = (await request(app).get(`/api/applications/${stacked.id}`).set(as(metro))).body.applicantView;
    expect(owner).toMatchObject({ status: "approved", headline: "You're approved for $15,000", decidedBy: "Reviewed by Priya Shah" });
    expect(owner.note).toMatch(/One advance pays off/);

    await emailsSettled();
    const sent = mail.sent.filter((m) => m.to === "owner@metro.co").map((m) => m.subject);
    expect(sent).toEqual(["Your application is being reviewed - $60,000 request", "You're approved - $60,000 request"]);
  });

  it("declining needs a real note; the decision can't be made twice or re-scored", async () => {
    const { app, metro, as, stacked } = await setup();
    expect((await decide(app, stacked.id, { outcome: "decline", note: "no" })).status).toBe(400);
    expect((await decide(app, stacked.id, { outcome: "decline", note: "Debt load too high to add more right now." })).status).toBe(200);
    const again = await decide(app, stacked.id, { outcome: "approve", amountCents: 500_000, note: "Changed my mind about this one." }, UW_KEY_2);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/Already declined \(Priya Shah\)/);
    expect((await request(app).post(`/api/applications/${stacked.id}/assess`).set(as(metro))).status).toBe(422);
  });

  it("an approval can't exceed the request, a month of revenue, or skip $500 steps", async () => {
    const { app, inflated } = await setup();
    const note = "Testing amount validation for this case.";
    expect((await decide(app, inflated.id, { outcome: "approve", amountCents: 8_000_000, note })).body.error).toMatch(/more than the business asked for/);
    expect((await decide(app, inflated.id, { outcome: "approve", amountCents: 1_234_500, note })).body.error).toMatch(/multiple of \$500/);
    expect((await decide(app, inflated.id, { outcome: "approve", amountCents: 1_000_000, factorRate: 2, note })).status).toBe(400);
  });

  it("only 'review' cases can be decided by hand", async () => {
    const { app, bakery } = await setup();
    expect((await decide(app, bakery.id, { outcome: "decline", note: "Overriding the scorecard here." })).status).toBe(409);
  });
});

describe("the underwriting memo lives in the console", () => {
  it("writes and verifies it for the underwriter; the business never sees it", async () => {
    const { app, metro, as, stacked, prompts } = await setup([
      {
        summary: { text: "Review: lender payments already exceed 15% of daily revenue.", cites: ["K1"] },
        risks: [{ text: "Existing lender payments take 22.2% of revenue.", cites: ["M7"] }, { text: "Owner has bad credit.", cites: ["M12"] }],
        recommendation: "approve",
      },
    ]);
    const res = await request(app).post(`/api/underwriting/applications/${stacked.id}/memo`).set(asUnderwriter());
    expect(res.status).toBe(200);
    expect(res.body.memo.risks).toHaveLength(1);
    expect(res.body.memo.dropped[0].why).toMatch(/M12/);
    expect(res.body.memo.disagreement).toBe(true);
    expect(prompts[0]!.prompt).not.toContain("Metro Auto Repair");
    expect((await request(app).post(`/api/applications/${stacked.id}/memo`).set(as(metro))).status).toBe(404);
    expect((await request(app).get(`/api/applications/${stacked.id}`).set(as(metro))).body.application).not.toHaveProperty("memo");
  });
});

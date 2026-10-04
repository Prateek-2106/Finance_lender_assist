import request from "supertest";
import express from "express";
import { asUnderwriter, BASE, fakeMailer, makeApp, signUp, UW_KEY } from "../helpers/app";
import { fakeLlm } from "../helpers/fakeLlm";
import { hashApiKey } from "../../src/lib/apiKey";
import { rateLimit } from "../../src/lib/rateLimit";
import { spendAiBudget } from "../../src/services/aiBudget";
import { createMemoryRepos } from "../../src/repos/memory";
import type { Config } from "../../src/deps";

const DEMO_UW = "uw_demo_public_test_01";
const ADMIN = "admin_token_for_tests_123";

function publicSite(extra: Partial<Config> = {}, llm = fakeLlm().llm) {
  const mail = fakeMailer();
  const base = makeApp().deps.config; // the usual test config, then a public deployment's settings on top
  const config: Config = {
    ...base,
    openSignup: false,
    adminTokenHash: hashApiKey(ADMIN),
    demo: { enabled: true, ttlDays: 3, underwriterKey: DEMO_UW },
    underwriters: [...base.underwriters!, { name: "Demo underwriter", keyHash: hashApiKey(DEMO_UW), demoOnly: true }],
    ...extra,
  };
  const ctx = makeApp({ llm, mailer: mail.mailer, config });
  return { ...ctx, mail };
}

async function startDemo(app: express.Express) {
  const res = await request(app).post("/api/demo");
  expect(res.status).toBe(201);
  const host = `${res.body.subdomain}.${BASE}`;
  return { ...res.body, host, as: { Host: host, Authorization: `Bearer ${res.body.apiKey}` } } as {
    subdomain: string; apiKey: string; dashboardUrl: string; expiresAt: string; host: string; as: Record<string, string>;
  };
}

describe("sign-up on a public deployment", () => {
  it("is closed to visitors and open to the admin token", async () => {
    const { app } = publicSite();
    const body = { name: "Chase Bank" };
    expect((await request(app).post("/api/tenants").send(body)).status).toBe(401);
    expect((await request(app).post("/api/tenants").set("Authorization", "Bearer wrong_token_000000").send(body)).status).toBe(403);
    expect((await request(app).post("/api/tenants").set("Authorization", `Bearer ${ADMIN}`).send(body)).status).toBe(201);
  });

  it("stays open when the server allows it (local development)", async () => {
    const { app } = makeApp();
    await signUp(app, { name: "Joe's Plumbing" });
  });
});

describe("GET /api/platform", () => {
  it("tells the homepage what it can offer", async () => {
    const { app } = publicSite();
    const p = (await request(app).get("/api/platform")).body.platform;
    expect(p).toMatchObject({ baseDomain: BASE, signupOpen: false, demo: { ttlDays: 3, underwriterKey: DEMO_UW }, aiEnabled: true });
  });
});

describe("POST /api/demo", () => {
  it("creates a lived-in business of your own, with a key only for it", async () => {
    const { app } = publicSite();
    const demo = await startDemo(app);
    expect(demo.subdomain).toMatch(/^demo-[0-9a-f]{6}$/);
    expect(demo.dashboardUrl).toBe(`https://${demo.subdomain}.${BASE}/app#key=${demo.apiKey}`);
    expect(new Date(demo.expiresAt).getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);

    const leads = (await request(app).get("/api/leads").set(demo.as)).body.leads;
    expect(leads.length).toBeGreaterThanOrEqual(10);
    const insights = (await request(app).get("/api/insights").set(demo.as)).body.insights;
    expect(insights.revenue.paidCents).toBeGreaterThan(0);
    expect(insights.revenue.outstandingInvoices).toBe(1);
    expect(insights.customers.returning).toBeGreaterThan(0);

    const apps = (await request(app).get("/api/applications").set(demo.as)).body.applications as { decision: { outcome: string } }[];
    expect(apps.map((a) => a.decision.outcome).sort()).toEqual(["approved", "declined", "pending_review"]);

    // Two visitors never share a business
    const other = await startDemo(app);
    expect(other.subdomain).not.toBe(demo.subdomain);
    expect((await request(app).get("/api/leads").set({ ...demo.as, Host: other.host })).status).toBe(403);
  });

  it("is off unless the server enables it", async () => {
    const { app } = publicSite({ demo: { enabled: false, ttlDays: 3 } });
    expect((await request(app).post("/api/demo")).status).toBe(404);
  });

  it("limits how many demos one visitor can start", async () => {
    const { app } = publicSite({ rateLimits: { leadsPerHour: 30, demosPerHour: 2 } });
    await startDemo(app);
    await startDemo(app);
    const res = await request(app).post("/api/demo");
    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("an expired demo is gone", async () => {
    const { app, deps } = publicSite();
    const demo = await startDemo(app);
    const t = (await deps.repos.tenants.findBySubdomain(demo.subdomain))!;
    await deps.repos.tenants.update(t.id, { demo: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).get("/api/site").set("Host", demo.host);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/expired/);
  });
});

describe("emails from demo businesses", () => {
  it("are kept to view, never sent", async () => {
    const { app, mail, emailsSettled } = publicSite();
    const demo = await startDemo(app);
    await request(app).post("/api/leads").set("Host", demo.host).send({ name: "Visitor", email: "someone-real@gmail.com", message: "Leaky faucet" });
    await emailsSettled();
    expect(mail.sent).toHaveLength(0);

    const messages = (await request(app).get("/api/messages").set(demo.as)).body.messages;
    expect(messages.length).toBe(2); // to the customer and to the owner
    expect(messages[0]).toMatchObject({ status: "skipped", error: expect.stringMatching(/demo/), hasPreview: true });
    expect(messages[0].preview).toBeUndefined(); // the list stays small
    const one = (await request(app).get(`/api/messages/${messages[0].id}`).set(demo.as)).body.message;
    expect(one.preview.html).toContain("<");
  });
});

describe("the public demo underwriter key", () => {
  it("sees and decides demo businesses only", async () => {
    const { app } = publicSite();
    const demo = await startDemo(app);
    // A real business with a case waiting for review
    const real = await request(app).post("/api/tenants").set("Authorization", `Bearer ${ADMIN}`).send({ name: "Real Auto Repair" });
    const realAs = { Host: `${real.body.tenant.subdomain}.${BASE}`, Authorization: `Bearer ${real.body.apiKey}` };
    const { PROFILES } = await import("../../fixtures/profiles");
    const { generateStatement, toCsv } = await import("../../fixtures/generate");
    const p = PROFILES.find((x) => x.key === "stacked-auto")!;
    const a = await request(app).post("/api/applications").set(realAs).send({
      industry: p.industry, monthsInBusiness: p.monthsInBusiness, statedMonthlyRevenueCents: p.statedMonthlyRevenueCents, amountRequestedCents: p.amountRequestedCents, useOfFunds: p.useOfFunds,
    });
    const realId = a.body.application.id;
    await request(app).post(`/api/applications/${realId}/statements`).set({ ...realAs, "Content-Type": "text/csv" }).send(toCsv(p, generateStatement(p)));
    await request(app).post(`/api/applications/${realId}/assess`).set(realAs);

    const staff = (await request(app).get("/api/underwriting/queue").set(asUnderwriter(UW_KEY))).body.pending as { id: string; business: string }[];
    expect(staff.map((x) => x.business).sort()).toEqual(["Maple Street Plumbing", "Real Auto Repair"]);

    const pub = asUnderwriter(DEMO_UW);
    expect((await request(app).get("/api/underwriting/me").set(pub)).body).toEqual({ name: "Demo underwriter", demoOnly: true });
    const queue = (await request(app).get("/api/underwriting/queue").set(pub)).body.pending as { id: string; business: string }[];
    expect(queue.map((x) => x.business)).toEqual(["Maple Street Plumbing"]);
    expect((await request(app).get(`/api/underwriting/applications/${realId}`).set(pub)).status).toBe(404);
    expect((await request(app).post(`/api/underwriting/applications/${realId}/decision`).set(pub).send({ outcome: "decline", note: "Trying to decide a real case" })).status).toBe(404);

    const res = await request(app).post(`/api/underwriting/applications/${queue[0]!.id}/decision`).set(pub).send({ outcome: "decline", note: "Too much existing debt for now." });
    expect(res.status).toBe(200);
    expect(res.body.application.decision.decidedBy).toEqual({ kind: "underwriter", name: "Demo underwriter" });
    void demo;
  });
});

describe("AI daily budget", () => {
  const config = (global: number, perBusiness: number) => ({ baseDomain: BASE, publicUrl: "https://x", twilioAuthToken: "", aiDailyLimit: { global, perBusiness } });

  it("caps each business, then everyone, per UTC day", async () => {
    const repos = createMemoryRepos();
    const day = new Date("2026-10-04T12:00:00Z");
    await spendAiBudget({ repos, config: config(3, 2) }, "a", day);
    await spendAiBudget({ repos, config: config(3, 2) }, "a", day);
    await expect(spendAiBudget({ repos, config: config(3, 2) }, "a", day)).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/2 AI drafts/) });
    await spendAiBudget({ repos, config: config(3, 2) }, "b", day);
    await expect(spendAiBudget({ repos, config: config(3, 2) }, "c", day)).rejects.toMatchObject({ status: 429, message: expect.stringMatching(/daily limit/) });
    await spendAiBudget({ repos, config: config(3, 2) }, "a", new Date("2026-10-05T00:00:01Z")); // a new day
  });

  it("the draft button answers 429 once a business has used its share, without calling the model", async () => {
    const fake = fakeLlm({ lineItems: [{ sku: "WH-FLUSH", quantity: 1 }], questions: [] });
    const { app, deps } = publicSite({ aiDailyLimit: { global: 100, perBusiness: 0 } }, fake.llm);
    const demo = await startDemo(app);
    const lead = (await request(app).get("/api/leads").set(demo.as)).body.leads[0];
    const res = await request(app).post(`/api/leads/${lead.id}/draft-estimate`).set(demo.as);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/AI drafts for today/);
    expect(fake.prompts).toHaveLength(0);
    void deps;
  });
});

describe("rateLimit", () => {
  it("counts per visitor address and resets after the window", () => {
    let now = 0;
    const mw = rateLimit({ name: "x", max: 2, windowMs: 1000, now: () => now });
    const hit = (ip: string) => {
      let err: unknown;
      mw({ ip } as express.Request, {} as express.Response, (e?: unknown) => (err = e));
      return err;
    };
    expect(hit("1.1.1.1")).toBeUndefined();
    expect(hit("1.1.1.1")).toBeUndefined();
    expect(() => hit("1.1.1.1")).toThrow(/Too many/);
    expect(hit("2.2.2.2")).toBeUndefined();
    now = 1001;
    expect(hit("1.1.1.1")).toBeUndefined();
  });

  it("behind one proxy, a visitor can't dodge the limit by forging X-Forwarded-For", async () => {
    const { app } = publicSite({ rateLimits: { leadsPerHour: 30, demosPerHour: 1 }, trustProxyHops: 1 });
    // The proxy appends the real address last; whatever the visitor wrote comes before it.
    const xff = (forged: string) => ({ "X-Forwarded-For": `${forged}, 203.0.113.7` });
    expect((await request(app).post("/api/demo").set(xff("1.1.1.1"))).status).toBe(201);
    expect((await request(app).post("/api/demo").set(xff("9.9.9.9"))).status).toBe(429);
    // ...while a different real visitor behind the same proxy is counted separately
    expect((await request(app).post("/api/demo").set({ "X-Forwarded-For": "203.0.113.8" })).status).toBe(201);
  });
});

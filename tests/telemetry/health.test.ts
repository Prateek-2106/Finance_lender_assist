// The System health page's numbers: per route, per database operation, outside calls, and vitals.
import request from "supertest";
import { BASE, fakeMailer, makeApp, signUp } from "../helpers/app";
import { Health } from "../../src/telemetry/health";
import { Prometheus } from "../../src/telemetry/prometheus";
import { SESSION_COOKIE } from "../../src/auth/session";

describe("Health: the rolling window", () => {
  it("percentiles, counts and errors over the window, one point per minute", () => {
    let now = Date.parse("2026-10-09T12:00:30Z");
    const h = new Health(() => now);
    for (let i = 1; i <= 100; i++) h.record("route", "GET /api/leads", i, i !== 100);
    now += 60_000;
    h.record("route", "GET /api/leads", 500);
    const s = h.snapshot(5);
    const leads = s.routes.find((r) => r.key === "GET /api/leads")!;
    expect(leads).toMatchObject({ count: 101, errors: 1, p50: 51, max: 500 });
    expect(leads.p99).toBe(100);
    expect(s.series).toHaveLength(5);
    expect(s.series.slice(-2).map((p) => p.requests)).toEqual([100, 1]);
    expect(s.totals).toMatchObject({ requests: 101, errors: 1 });

    // Older than the window: left out; older than an hour: forgotten
    expect(h.snapshot(1).totals.requests).toBe(1);
    now += 61 * 60_000;
    h.record("route", "GET /", 1);
    expect(h.snapshot(60).totals.requests).toBe(1);
  });

  it("keeps a bounded sample per minute however busy it gets", () => {
    const h = new Health(() => 0);
    for (let i = 0; i < 20_000; i++) h.record("db", "leads.create", i % 10);
    const s = h.snapshot(1).db[0]!;
    expect(s.count).toBe(20_000);
    expect(s.p50).toBeGreaterThanOrEqual(3);
    expect(s.p50).toBeLessThanOrEqual(6);
  });

  it("samples vitals", () => {
    const h = new Health();
    const v = h.sampleVitals();
    expect(v.heapUsedMb).toBeGreaterThan(0);
    expect(h.current()).toMatchObject({ node: process.version });
  });
});

describe("timing real requests", () => {
  it("labels routes by pattern, and splits out the database time each one used", async () => {
    const health = new Health();
    const { app } = makeApp({ health });
    const joe = await signUp(app, { name: "Joe's Plumbing" });
    const as = { Host: joe.host, Authorization: `Bearer ${joe.apiKey}` };
    const lead = (await request(app).post("/api/leads").set("Host", joe.host).send({ name: "Ann", email: "ann@x.co", message: "Leak" })).body.lead;
    await request(app).get("/api/leads").set(as);
    await request(app).get(`/api/leads/${lead.id}`).set(as);
    await request(app).get("/api/nope").set(as);
    await request(app).get("/api/leads/no-such-lead").set(as); // a 404 thrown from the handler keeps its label
    await request(app).get("/health");

    const s = health.snapshot(5);
    const keys = s.routes.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["POST /api/tenants", "POST /api/leads", "GET /api/leads", "GET /api/leads/:id", "GET (no such route)"]));
    expect(keys.some((k) => k.includes(lead.id) || k.includes("no-such-lead"))).toBe(false); // ids never become labels
    expect(s.routes.find((r) => r.key === "GET /api/leads/:id")!.count).toBe(2);
    expect(keys.some((k) => k.includes("/health"))).toBe(false);

    const list = s.routes.find((r) => r.key === "GET /api/leads")!;
    expect(list.dbCallsPerRequest).toBeGreaterThanOrEqual(2); // finds the business, then its requests
    expect(list.dbShare).toBeGreaterThan(0);
    expect(list.dbShare).toBeLessThanOrEqual(1);
    expect(s.db.map((d) => d.key)).toEqual(expect.arrayContaining(["tenants.findBySubdomain", "leads.listByTenant", "leads.create", "customers.upsertByContact"]));
  });

  it("counts a failing database call and the 500 it causes", async () => {
    const health = new Health();
    const { app, deps } = makeApp({ health });
    deps.repos.tenants.findBySubdomain = async () => {
      throw new Error("database down");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await request(app).get("/api/leads").set("Host", `joe.${BASE}`)).status).toBe(500);
    spy.mockRestore();
    const s = health.snapshot(1);
    expect(s.db.find((d) => d.key === "tenants.findBySubdomain")).toMatchObject({ count: 1, errors: 1 });
    expect(s.totals.errors).toBe(1);
  });

  it("times outside calls: email", async () => {
    const health = new Health();
    const mail = fakeMailer();
    const { app, emailsSettled } = makeApp({ health, mailer: mail.mailer });
    const joe = await signUp(app, { name: "Joe", ownerEmail: "joe@x.co" });
    await request(app).post("/api/leads").set("Host", joe.host).send({ name: "Ann", email: "ann@x.co", message: "Leak" });
    await emailsSettled();
    expect(health.snapshot(1).external.find((e) => e.key === "Email: send")).toMatchObject({ count: 2, errors: 0 });
  });
});

describe("/ready, /metrics and the admin health page", () => {
  it("/ready says whether the database answers", async () => {
    const { app, deps } = makeApp();
    expect((await request(app).get("/ready")).body).toMatchObject({ ok: true });
    deps.repos.ping = async () => {
      throw new Error("no route to host");
    };
    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/no route to host/);
  });

  it("/metrics is off without a token, and needs the token when on", async () => {
    expect((await request(makeApp().app).get("/metrics")).status).toBe(404);
    const base = makeApp().deps.config;
    const { app } = makeApp({ config: { ...base, metricsToken: "scrape-me" }, health: new Health(Date.now, new Prometheus({ defaults: false })) });
    await request(app).get("/api/platform");
    expect((await request(app).get("/metrics")).status).toBe(401);
    expect((await request(app).get("/metrics").set("Authorization", "Bearer wrong-one")).status).toBe(401);
    const res = await request(app).get("/metrics").set("Authorization", "Bearer scrape-me");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/http_request_duration_seconds_count\{service="vendorstreet",route="GET \/api\/platform"\} 1/);
    expect(res.text).toContain("db_operation_duration_seconds");
  });

  it("the admin health page shows everything, to admins only", async () => {
    const mail = fakeMailer();
    const base = makeApp().deps.config;
    const health = new Health();
    const { app, emailsSettled } = makeApp({ mailer: mail.mailer, health, config: { ...base, adminEmails: ["boss@example.com"] } });
    const post = (path: string, body: object) => request(app).post(path).set({ Host: BASE }).send(body);
    await post("/api/auth/signup", { email: "boss@example.com", password: "correct horse battery" });
    await emailsSettled();
    const code = /\b(\d{6})\b/.exec(mail.sent.at(-1)!.subject)![1];
    const res = await post("/api/auth/verify-email", { email: "boss@example.com", code });
    const cookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith(SESSION_COOKIE))!.split(";")[0]!;

    expect((await request(app).get("/api/admin/health").set("Host", BASE)).status).toBe(401);
    const page = await request(app).get("/api/admin/health?minutes=5").set({ Host: BASE, Cookie: cookie });
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ minutes: 5, database: { ok: true }, process: { node: process.version } });
    expect(page.body.series).toHaveLength(5);
    expect(page.body.routes.map((r: { key: string }) => r.key)).toContain("POST /api/auth/verify-email");
    expect(page.body.external.map((e: { key: string }) => e.key)).toContain("Database ping");
  });
});

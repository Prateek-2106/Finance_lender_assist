import request from "supertest";
import { BASE, fakeMailer, makeApp, signUp } from "../helpers/app";
import { fakeLlm } from "../helpers/fakeLlm";
import { SESSION_COOKIE } from "../../src/auth/session";
import { COUNTERS, TIMINGS, emfMetrics, memoryMetrics } from "../../src/telemetry/metrics";
import { costUsd, instrumentLlm, priceFor, usageKeys } from "../../src/telemetry/aiUsage";
import { createMemoryRepos } from "../../src/repos/memory";
import { lastDays } from "../../src/routes/admin";
import type { LlmClient } from "../../src/deps";

describe("CloudWatch metrics (EMF)", () => {
  it("writes one record with every count and timing, in CloudWatch's format", () => {
    const lines: string[] = [];
    const m = emfMetrics({ write: (l) => lines.push(l), now: () => 1_760_000_000_000 });
    m.count("Requests");
    m.count("Requests");
    m.count("AiCostUsd", 0.0012345678);
    m.time("Latency", 12.4);
    m.flush();
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec._aws).toEqual({
      Timestamp: 1_760_000_000_000,
      CloudWatchMetrics: [
        {
          Namespace: "VendorStreet",
          Dimensions: [["Service"]],
          Metrics: [
            { Name: "Requests", Unit: "Count" },
            { Name: "AiCostUsd", Unit: "None" },
            { Name: "Latency", Unit: "Milliseconds" },
          ],
        },
      ],
    });
    expect(rec).toMatchObject({ Service: "web", Requests: 2, AiCostUsd: 0.001235, Latency: [12] });
  });

  it("splits timings into records of 100 (CloudWatch's limit) and sends counts once", () => {
    const lines: string[] = [];
    const m = emfMetrics({ write: (l) => lines.push(l) });
    m.count("Requests", 250);
    for (let i = 0; i < 250; i++) m.time("Latency", i);
    m.flush();
    const recs = lines.map((l) => JSON.parse(l));
    expect(recs.map((r) => r.Latency.length)).toEqual([100, 100, 50]);
    expect(recs.map((r) => r.Requests)).toEqual([250, undefined, undefined]);
    expect(recs[1]._aws.CloudWatchMetrics[0].Metrics).toEqual([{ Name: "Latency", Unit: "Milliseconds" }]);
  });

  it("writes nothing for a quiet minute, and starts fresh after each flush", () => {
    const lines: string[] = [];
    const m = emfMetrics({ write: (l) => lines.push(l) });
    m.flush();
    m.count("EmailsSent");
    m.flush();
    m.flush();
    expect(lines).toHaveLength(1);
  });

  it("stays within CloudWatch's 10 free custom metrics", () => {
    expect(Object.keys(COUNTERS).length + Object.keys(TIMINGS).length).toBeLessThanOrEqual(10);
  });
});

describe("request metrics", () => {
  it("counts requests and errors and times them, but not health checks", async () => {
    const metrics = memoryMetrics();
    const { app, deps } = makeApp({ metrics });
    await request(app).get("/health");
    expect(metrics.counts.Requests).toBeUndefined();
    await request(app).get("/api/nothing-here").set("Host", BASE);
    expect(metrics.counts).toMatchObject({ Requests: 1, ClientErrors: 1 });
    deps.repos.tenants.findBySubdomain = async () => {
      throw new Error("database down");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await request(app).get("/api/leads").set("Host", `joe.${BASE}`)).status).toBe(500);
    spy.mockRestore();
    expect(metrics.counts).toMatchObject({ Requests: 2, ClientErrors: 1, ServerErrors: 1 });
    expect(metrics.timings.Latency).toHaveLength(2);
  });

  it("counts emails sent and failed", async () => {
    const metrics = memoryMetrics();
    const mail = fakeMailer();
    const { app, emailsSettled } = makeApp({ metrics, mailer: mail.mailer });
    const joe = await signUp(app, { name: "Joe's Plumbing", ownerEmail: "joe@example.com" });
    const lead = { name: "Ann", email: "ann@example.com", message: "Leaky faucet in the kitchen" };
    await request(app).post("/api/leads").set("Host", joe.host).send(lead);
    await emailsSettled();
    expect(metrics.counts.EmailsSent).toBe(2);
    mail.fail = true;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await request(app).post("/api/leads").set("Host", joe.host).send(lead);
    await emailsSettled();
    spy.mockRestore();
    expect(metrics.counts.EmailsFailed).toBe(2);
  });
});

describe("AI usage", () => {
  const usageLlm = (fail = false): LlmClient => ({
    model: "anthropic/claude-haiku-4-5-20251001",
    complete: async () => "unused",
    completeWithUsage: async () => {
      if (fail) throw new Error("overloaded");
      return { text: "{}", usage: { inputTokens: 2000, outputTokens: 400 } };
    },
  });

  it("prices calls by model", () => {
    expect(priceFor("anthropic/claude-haiku-4-5-20251001")).toEqual({ input: 1, output: 5 });
    expect(priceFor("anthropic/claude-sonnet-5-5")).toEqual({ input: 2, output: 10 });
    expect(priceFor("ollama/llama3.1:8b")).toEqual({ input: 0, output: 0 });
    expect(priceFor("anthropic/some-future-model")).toEqual({ input: 5, output: 25 }); // unknown: assume expensive
    expect(costUsd({ inputTokens: 2000, outputTokens: 400 }, { input: 1, output: 5 })).toBeCloseTo(0.004);
  });

  it("counts calls, failures, tokens and cost, and keeps daily totals in the database", async () => {
    const metrics = memoryMetrics();
    const repos = createMemoryRepos();
    const now = () => new Date("2026-10-06T12:00:00Z");
    const ok = instrumentLlm(usageLlm(), { metrics, repos, now });
    expect(await ok.complete({ system: "s", prompt: "p" })).toBe("{}");
    expect(await ok.complete({ system: "s", prompt: "p" })).toBe("{}");
    await expect(instrumentLlm(usageLlm(true), { metrics, repos, now }).complete({ system: "s", prompt: "p" })).rejects.toThrow("overloaded");

    expect(metrics.counts).toMatchObject({ AiCalls: 3, AiFailures: 1 });
    expect(metrics.counts.AiCostUsd).toBeCloseTo(0.008);
    expect(metrics.timings.AiLatency).toHaveLength(3);
    const k = usageKeys("2026-10-06");
    expect(await repos.usage.peek(k.inputTokens)).toBe(4000);
    expect(await repos.usage.peek(k.outputTokens)).toBe(800);
    expect(await repos.usage.peek(k.costMicroUsd)).toBe(8000);
    expect(await repos.usage.peek(k.failures)).toBe(1);
  });

  it("still works with a model that doesn't report tokens", async () => {
    const metrics = memoryMetrics();
    const { llm } = fakeLlm("hello");
    expect(await instrumentLlm(llm, { metrics, repos: createMemoryRepos() }).complete({ system: "s", prompt: "p" })).toBe("hello");
    expect(metrics.counts).toEqual({ AiCalls: 1 });
  });
});

describe("GET /api/admin/overview", () => {
  const PW = "correct horse battery";
  async function setup() {
    const mail = fakeMailer();
    const ctx = makeApp({ mailer: mail.mailer });
    ctx.deps.config.adminEmails = ["boss@example.com"];
    ctx.deps.config.demo = { enabled: true, ttlDays: 3 };
    const post = (path: string, body: object, cookie?: string) =>
      request(ctx.app).post(path).set({ Host: BASE, Origin: `https://${BASE}`, ...(cookie ? { Cookie: cookie } : {}) }).send(body);
    async function register(email: string) {
      await post("/api/auth/signup", { email, password: PW });
      await ctx.emailsSettled();
      const code = /\b(\d{6})\b/.exec([...mail.sent].reverse().find((m) => m.to === email.toLowerCase())!.subject)![1];
      const res = await post("/api/auth/verify-email", { email, code });
      return ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith(SESSION_COOKIE))!.split(";")[0]!;
    }
    const overview = (cookie?: string) => request(ctx.app).get("/api/admin/overview").set({ Host: BASE, ...(cookie ? { Cookie: cookie } : {}) });
    return { ...ctx, post, register, overview };
  }

  it("is only for signed-in admins", async () => {
    const { register, overview, app } = await setup();
    expect((await overview()).status).toBe(401);
    const someone = await register("someone@example.com");
    expect((await overview(someone)).status).toBe(403);
    expect((await request(app).get("/api/auth/me").set({ Host: BASE, Cookie: someone })).body.admin).toBe(false);
    const boss = await register("Boss@Example.com");
    expect((await request(app).get("/api/auth/me").set({ Host: BASE, Cookie: boss })).body.admin).toBe(true);
    expect((await overview(boss)).status).toBe(200);
  });

  it("shows sign-ups, businesses, demos, real leads and emails by day", async () => {
    const { register, overview, post } = await setup();
    const boss = await register("boss@example.com");
    await register("owner@example.com");
    const biz = await post("/api/auth/businesses", { name: "River Electric", subdomain: "river-electric" }, boss);
    expect(biz.status).toBe(201);
    expect((await post("/api/demo", {})).status).toBe(201); // a demo, with its seeded fake leads

    const res = await overview(boss);
    const today = res.body.days.at(-1);
    expect(res.body.days).toHaveLength(14);
    expect(today.day).toBe(lastDays(1)[0]);
    expect(res.body.totals).toEqual({ total: 2, confirmed: 2, real: 1, demosLive: 1 });
    expect(today).toMatchObject({ signups: 2, businesses: 1, demos: 1, leads: 0, emailsSent: 2, emailsFailed: 0 });
    expect(res.body.ai).toMatchObject({ model: null, period: { calls: 0, costUsd: 0 } });
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

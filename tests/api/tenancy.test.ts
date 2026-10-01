import request from "supertest";
import { makeApp, signUp, BASE } from "../helpers/app";
import { tenantForHost } from "../../src/middleware/tenant";

const lead = { name: "Ann", phone: "716-555-0123", message: "Leaky water heater" };

async function twoTenants() {
  const ctx = makeApp();
  const joe = await signUp(ctx.app, { name: "Joe's Plumbing" });
  const ana = await signUp(ctx.app, { name: "Ana's Salon" });
  return { ...ctx, joe, ana };
}

describe("tenantForHost", () => {
  it("resolves subdomains of the base domain, ignoring case, port and trailing dot", async () => {
    const { deps, joe } = await twoTenants();
    for (const host of [`joes-plumbing.${BASE}`, `JOES-PLUMBING.${BASE}:3000`, `joes-plumbing.${BASE}.`])
      expect((await tenantForHost(deps, host))?.id, host).toBe(joe.tenant.id);
  });
  it("returns null for the bare base domain, unknown subdomains and nested subdomains", async () => {
    const { deps } = await twoTenants();
    for (const host of [BASE, `nobody.${BASE}`, `a.joes-plumbing.${BASE}`, "localhost"])
      expect(await tenantForHost(deps, host), host).toBeNull();
  });
  it("resolves a VERIFIED custom domain, but not a pending one", async () => {
    const { deps, joe, ana } = await twoTenants();
    await deps.repos.tenants.update(joe.tenant.id, {
      customDomain: { hostname: "joesplumbing.com", status: "verified", verificationToken: "t" },
    });
    await deps.repos.tenants.update(ana.tenant.id, {
      customDomain: { hostname: "anasalon.com", status: "pending", verificationToken: "t" },
    });
    expect((await tenantForHost(deps, "joesplumbing.com"))?.id).toBe(joe.tenant.id);
    expect(await tenantForHost(deps, "anasalon.com")).toBeNull();
  });
});

describe("POST /api/leads (public lead capture)", () => {
  it("creates the lead for the tenant identified by the Host header", async () => {
    const { app, joe } = await twoTenants();
    const res = await request(app).post("/api/leads").set("Host", joe.host).send(lead);
    expect(res.status).toBe(201);
    expect(res.body.lead).toMatchObject({ tenantId: joe.tenant.id, source: "web", phone: "+17165550123" });
  });
  it("ignores tenantId / source smuggled in the body", async () => {
    const { app, joe, ana } = await twoTenants();
    const res = await request(app)
      .post("/api/leads")
      .set("Host", joe.host)
      .send({ ...lead, tenantId: ana.tenant.id, source: "sms" });
    expect(res.body.lead.tenantId).toBe(joe.tenant.id);
    expect(res.body.lead.source).toBe("web");
  });
  it("404s for hosts that are not a tenant", async () => {
    const { app } = await twoTenants();
    expect((await request(app).post("/api/leads").set("Host", `ghost.${BASE}`).send(lead)).status).toBe(404);
    expect((await request(app).post("/api/leads").set("Host", BASE).send(lead)).status).toBe(404);
  });
  it("validates input (400)", async () => {
    const { app, joe } = await twoTenants();
    const res = await request(app).post("/api/leads").set("Host", joe.host).send({ name: "Ann", message: "hi" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/leads (owner only)", () => {
  it("401 without a key, 403 with another tenant's key", async () => {
    const { app, joe, ana } = await twoTenants();
    expect((await request(app).get("/api/leads").set("Host", joe.host)).status).toBe(401);
    const res = await request(app).get("/api/leads").set("Host", joe.host).set("Authorization", `Bearer ${ana.apiKey}`);
    expect(res.status).toBe(403);
  });
  it("lists only this tenant's leads, newest first, honoring ?limit", async () => {
    const { app, joe, ana } = await twoTenants();
    for (const m of ["first", "second", "third"])
      await request(app).post("/api/leads").set("Host", joe.host).send({ ...lead, message: m });
    await request(app).post("/api/leads").set("Host", ana.host).send({ ...lead, message: "ana's lead" });

    const auth = { Host: joe.host, Authorization: `Bearer ${joe.apiKey}` };
    const all = await request(app).get("/api/leads").set(auth);
    expect(all.status).toBe(200);
    expect(all.body.leads.map((l: { message: string }) => l.message)).toEqual(["third", "second", "first"]);

    const two = await request(app).get("/api/leads?limit=2").set(auth);
    expect(two.body.leads).toHaveLength(2);
    expect((await request(app).get("/api/leads?limit=0").set(auth)).status).toBe(400);
  });
  it("cannot read another tenant's lead by id, even with a valid key for its own site", async () => {
    const { app, joe, ana } = await twoTenants();
    const created = await request(app).post("/api/leads").set("Host", ana.host).send(lead);
    const res = await request(app)
      .get(`/api/leads/${created.body.lead.id}`)
      .set({ Host: joe.host, Authorization: `Bearer ${joe.apiKey}` });
    expect(res.status).toBe(404);
    const own = await request(app)
      .get(`/api/leads/${created.body.lead.id}`)
      .set({ Host: ana.host, Authorization: `Bearer ${ana.apiKey}` });
    expect(own.status).toBe(200);
  });
});

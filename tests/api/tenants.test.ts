import request from "supertest";
import { makeApp } from "../helpers/app";

describe("GET /health", () => {
  it("responds ok", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("POST /api/tenants", () => {
  it("creates a tenant, returns 201 + Location + a one-time apiKey", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/api/tenants").send({ name: "Joe's Plumbing", taxRateBps: 875 });
    expect(res.status).toBe(201);
    expect(res.body.tenant).toMatchObject({ name: "Joe's Plumbing", subdomain: "joes-plumbing", taxRateBps: 875 });
    expect(res.body.tenant.id).toBeTypeOf("string");
    expect(res.headers.location).toBe(`/api/tenants/${res.body.tenant.id}`);
    expect(res.body.apiKey).toMatch(/^sk_/);
  });

  it("never leaks apiKeyHash", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/api/tenants").send({ name: "Joe" });
    expect(JSON.stringify(res.body)).not.toContain("apiKeyHash");
  });

  it("stores only the hash of the key", async () => {
    const { app, deps } = makeApp();
    const res = await request(app).post("/api/tenants").send({ name: "Joe" });
    const stored = await deps.repos.tenants.findById(res.body.tenant.id);
    expect(stored?.apiKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(res.body.apiKey);
  });

  it("returns 400 with issues for invalid input", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/api/tenants").send({ name: "J", taxRateBps: -1 });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual(expect.arrayContaining(["name"]));
  });

  it("returns 400 (not 500) for malformed JSON", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/api/tenants").set("content-type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTypeOf("string");
  });

  it("returns 409 when the subdomain is taken", async () => {
    const { app } = makeApp();
    await request(app).post("/api/tenants").send({ name: "Joe's Plumbing" });
    const res = await request(app).post("/api/tenants").send({ name: "Joes Plumbing" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/taken/i);
  });
});

describe("GET /api/tenants/:id", () => {
  it("returns the public tenant", async () => {
    const { app } = makeApp();
    const created = await request(app).post("/api/tenants").send({ name: "Joe" });
    const res = await request(app).get(`/api/tenants/${created.body.tenant.id}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant.name).toBe("Joe");
    expect(res.body.tenant).not.toHaveProperty("apiKeyHash");
  });
  it("404s with a JSON error for unknown ids", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/api/tenants/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});

describe("error handling", () => {
  it("unknown routes return JSON 404", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/json/);
  });
  it("unexpected errors become a generic 500 that leaks no internals", async () => {
    const { app, deps } = makeApp();
    deps.repos.tenants.findById = async () => {
      throw new Error("db password is hunter2");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app).get("/api/tenants/x");
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
  });
});

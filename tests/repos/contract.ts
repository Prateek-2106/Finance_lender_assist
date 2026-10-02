// The repository contract: ANY Repos implementation must pass these.
// Run against the in-memory reference AND your MongoDB implementation.
import type { Repos, NewTenant } from "../../src/repos/types";
import { ConflictError, NotFoundError } from "../../src/errors";

const tenantInput = (subdomain: string, extra: Partial<NewTenant> = {}): NewTenant => ({
  name: subdomain,
  subdomain,
  priceList: [{ sku: "A", name: "Thing", unitPriceCents: 1000 }],
  taxRateBps: 800,
  apiKeyHash: "0".repeat(64),
  ...extra,
});

export function repoContract(name: string, makeRepos: () => Promise<Repos>) {
  describe(`Repos contract: ${name}`, () => {
    let repos: Repos;
    beforeEach(async () => {
      repos = await makeRepos();
    });

    describe("tenants", () => {
      it("creates with id + createdAt and round-trips every field", async () => {
        const t = await repos.tenants.create(tenantInput("joe"));
        expect(t.id).toBeTypeOf("string");
        expect(t.createdAt).toBeInstanceOf(Date);
        const found = await repos.tenants.findById(t.id);
        expect(found).toEqual(t);
        expect(found).not.toHaveProperty("_id");
      });
      it("finds by subdomain and by custom domain", async () => {
        const t = await repos.tenants.create(
          tenantInput("joe", { customDomain: { hostname: "joe.com", status: "pending", verificationToken: "x" } }),
        );
        expect((await repos.tenants.findBySubdomain("joe"))?.id).toBe(t.id);
        expect((await repos.tenants.findByCustomDomain("joe.com"))?.id).toBe(t.id);
        expect(await repos.tenants.findBySubdomain("nope")).toBeNull();
        expect(await repos.tenants.findById("nope")).toBeNull();
      });
      it("enforces unique subdomains with ConflictError", async () => {
        await repos.tenants.create(tenantInput("joe"));
        await expect(repos.tenants.create(tenantInput("joe"))).rejects.toBeInstanceOf(ConflictError);
      });
      it("allows many tenants WITHOUT a custom domain, but no two with the same hostname", async () => {
        await repos.tenants.create(tenantInput("a"));
        await repos.tenants.create(tenantInput("b"));
        const cd = { hostname: "same.com", status: "pending" as const, verificationToken: "x" };
        const c = await repos.tenants.create(tenantInput("c"));
        await repos.tenants.update(c.id, { customDomain: cd });
        const d = await repos.tenants.create(tenantInput("d"));
        await expect(repos.tenants.update(d.id, { customDomain: cd })).rejects.toBeInstanceOf(ConflictError);
      });
      it("update returns the new document; missing id → NotFoundError", async () => {
        const t = await repos.tenants.create(tenantInput("joe"));
        const u = await repos.tenants.update(t.id, { name: "Joe 2" });
        expect(u.name).toBe("Joe 2");
        expect((await repos.tenants.findById(t.id))?.name).toBe("Joe 2");
        await expect(repos.tenants.update("missing", { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe("leads", () => {
      it("lists newest first, scoped to tenant, with limit", async () => {
        for (const m of ["1", "2", "3"])
          await repos.leads.create({ tenantId: "t1", name: "A", email: "a@b.co", message: m, source: "web" });
        await repos.leads.create({ tenantId: "t2", name: "B", email: "b@b.co", message: "other", source: "sms" });
        const list = await repos.leads.listByTenant("t1");
        expect(list.map((l) => l.message)).toEqual(["3", "2", "1"]);
        expect(await repos.leads.listByTenant("t1", { limit: 1 })).toHaveLength(1);
      });
      it("findById is tenant-scoped", async () => {
        const l = await repos.leads.create({ tenantId: "t1", name: "A", email: "a@b.co", message: "x", source: "web" });
        expect((await repos.leads.findById("t1", l.id))?.id).toBe(l.id);
        expect(await repos.leads.findById("t2", l.id)).toBeNull();
      });
    });

    describe("estimates", () => {
      it("create / find / update, all tenant-scoped", async () => {
        const e = await repos.estimates.create({
          tenantId: "t1",
          lineItems: [{ description: "x", quantity: 1, unitPriceCents: 100 }],
          taxRateBps: 0,
          status: "draft",
        });
        expect(await repos.estimates.findById("t2", e.id)).toBeNull();
        const u = await repos.estimates.update("t1", e.id, { status: "sent" });
        expect(u.status).toBe("sent");
        await expect(repos.estimates.update("t2", e.id, { status: "accepted" })).rejects.toBeInstanceOf(NotFoundError);
      });
      it("lists newest first, scoped to tenant", async () => {
        const base = { lineItems: [], taxRateBps: 0, status: "draft" as const };
        const a = await repos.estimates.create({ ...base, tenantId: "t1" });
        const b = await repos.estimates.create({ ...base, tenantId: "t1" });
        await repos.estimates.create({ ...base, tenantId: "t2" });
        expect((await repos.estimates.listByTenant("t1")).map((e) => e.id)).toEqual([b.id, a.id]);
        expect(await repos.estimates.listByTenant("t1", { limit: 1 })).toHaveLength(1);
      });
    });

    describe("invoices", () => {
      it("numbers are sequential per tenant and atomic under concurrency", async () => {
        const nums = await Promise.all(Array.from({ length: 10 }, () => repos.invoices.nextNumber("t1")));
        expect(new Set(nums).size).toBe(10);
        expect([...nums].sort()).toEqual(Array.from({ length: 10 }, (_, i) => `INV-${String(i + 1).padStart(4, "0")}`));
        expect(await repos.invoices.nextNumber("t2")).toBe("INV-0001");
      });
      it("finds by estimate, tenant-scoped", async () => {
        const inv = await repos.invoices.create({
          tenantId: "t1",
          estimateId: "e1",
          number: "INV-0001",
          lineItems: [],
          taxRateBps: 0,
          totals: { subtotalCents: 0, taxCents: 0, totalCents: 0 },
          status: "open",
        });
        expect((await repos.invoices.findByEstimate("t1", "e1"))?.id).toBe(inv.id);
        expect(await repos.invoices.findByEstimate("t2", "e1")).toBeNull();
        const paid = await repos.invoices.update("t1", inv.id, { status: "paid", paidAt: new Date() });
        expect(paid.paidAt).toBeInstanceOf(Date);
      });
    });

    describe("applications and transactions", () => {
      const app = (tenantId: string) => ({
        tenantId,
        industry: "restaurant",
        monthsInBusiness: 36,
        statedMonthlyRevenueCents: 4_500_000,
        amountRequestedCents: 3_000_000,
        useOfFunds: "equipment",
        status: "draft" as const,
      });
      const line = (applicationId: string, fingerprint: string, date: string) => ({
        tenantId: "t1",
        applicationId,
        date,
        description: "SQUARE DEP",
        amountCents: 1000,
        category: "revenue" as const,
        rule: "credit.default",
        fingerprint,
      });

      it("applications list newest first, scoped to tenant", async () => {
        const x = await repos.applications.create(app("t1"));
        const y = await repos.applications.create(app("t1"));
        await repos.applications.create(app("t2"));
        expect((await repos.applications.listByTenant("t1")).map((a) => a.id)).toEqual([y.id, x.id]);
      });
      it("applications are tenant-scoped", async () => {
        const a = await repos.applications.create(app("t1"));
        expect(await repos.applications.findById("t2", a.id)).toBeNull();
        expect((await repos.applications.update("t1", a.id, { status: "assessed" })).status).toBe("assessed");
        await expect(repos.applications.update("t2", a.id, { status: "assessed" })).rejects.toBeInstanceOf(NotFoundError);
      });
      it("insertMany skips fingerprints already stored for the same application", async () => {
        const first = await repos.transactions.insertMany([line("a1", "f1", "2026-07-01"), line("a1", "f2", "2026-07-02")]);
        expect(first).toEqual({ inserted: 2, duplicates: 0 });
        const again = await repos.transactions.insertMany([line("a1", "f2", "2026-07-02"), line("a1", "f3", "2026-07-03")]);
        expect(again).toEqual({ inserted: 1, duplicates: 1 });
        // same fingerprint under a different application is a different line
        expect(await repos.transactions.insertMany([line("a2", "f1", "2026-07-01")])).toEqual({ inserted: 1, duplicates: 0 });
        expect(await repos.transactions.insertMany([])).toEqual({ inserted: 0, duplicates: 0 });
      });
      it("lists in date order, filtered by category and scoped by tenant", async () => {
        await repos.transactions.insertMany([
          line("a1", "f2", "2026-07-02"),
          line("a1", "f1", "2026-07-01"),
          { ...line("a1", "f3", "2026-07-03"), category: "expense", amountCents: -500 },
        ]);
        const all = await repos.transactions.listByApplication("t1", "a1");
        expect(all.map((t) => t.date)).toEqual(["2026-07-01", "2026-07-02", "2026-07-03"]);
        expect(await repos.transactions.listByApplication("t1", "a1", { category: "expense" })).toHaveLength(1);
        expect(await repos.transactions.listByApplication("t2", "a1")).toHaveLength(0);
      });
    });
  });
}

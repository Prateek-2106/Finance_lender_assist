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
      it("update with an undefined field removes it", async () => {
        const t = await repos.tenants.create(tenantInput("joe", { customDomain: { hostname: "joe.com", status: "verified", verificationToken: "x" } }));
        const u = await repos.tenants.update(t.id, { customDomain: undefined });
        expect(u).not.toHaveProperty("customDomain");
        expect(await repos.tenants.findByCustomDomain("joe.com")).toBeNull();
        // and the hostname is free for someone else
        const other = await repos.tenants.create(tenantInput("ann"));
        await repos.tenants.update(other.id, { customDomain: { hostname: "joe.com", status: "pending", verificationToken: "y" } });
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
      it("finds the open estimate for a lead, ignoring sent ones and other tenants", async () => {
        const base = { lineItems: [], taxRateBps: 0 };
        await repos.estimates.create({ ...base, tenantId: "t1", leadId: "L1", status: "sent" });
        const open = await repos.estimates.create({ ...base, tenantId: "t1", leadId: "L1", status: "needs_review" });
        await repos.estimates.create({ ...base, tenantId: "t2", leadId: "L1", status: "draft" });
        expect((await repos.estimates.findOpenByLead("t1", "L1"))?.id).toBe(open.id);
        expect(await repos.estimates.findOpenByLead("t1", "L2")).toBeNull();
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

    describe("usage counters", () => {
      it("count up atomically per key", async () => {
        const all = await Promise.all(Array.from({ length: 5 }, () => repos.usage.increment("ai:2026-10-04")));
        expect([...all].sort()).toEqual([1, 2, 3, 4, 5]);
        expect(await repos.usage.increment("ai:2026-10-05")).toBe(1);
      });
    });

    describe("customers", () => {
      it("the same email or phone is the same customer; details refresh and visits count", async () => {
        const a = await repos.customers.upsertByContact("t1", { name: "Ann", email: "ann@x.co" });
        const b = await repos.customers.upsertByContact("t1", { name: "Ann Lee", email: "ann@x.co", phone: "+17165550123" });
        expect(b.id).toBe(a.id);
        expect(b).toMatchObject({ name: "Ann Lee", phone: "+17165550123", leadCount: 2 });
        const c = await repos.customers.upsertByContact("t1", { name: "A. Lee", phone: "+17165550123" });
        expect(c.id).toBe(a.id);
        expect(c.leadCount).toBe(3);
      });
      it("a contact without a name keeps the known name, and a new one is named by phone", async () => {
        await repos.customers.upsertByContact("t1", { name: "Ann", phone: "+17165550123" });
        expect((await repos.customers.upsertByContact("t1", { phone: "+17165550123" })).name).toBe("Ann");
        expect((await repos.customers.upsertByContact("t1", { phone: "+17165559999" })).name).toBe("+17165559999");
      });
      it("is scoped per business", async () => {
        const a = await repos.customers.upsertByContact("t1", { name: "Ann", email: "ann@x.co" });
        const b = await repos.customers.upsertByContact("t2", { name: "Ann", email: "ann@x.co" });
        expect(b.id).not.toBe(a.id);
        expect(await repos.customers.findById("t2", a.id)).toBeNull();
        expect(await repos.customers.listByTenant("t1")).toHaveLength(1);
      });
    });

    describe("messages", () => {
      it("records status changes and lists newest first per business", async () => {
        const m1 = await repos.messages.create({ tenantId: "t1", template: "a", subject: "A", status: "queued" });
        await repos.messages.create({ tenantId: "t1", template: "b", subject: "B", status: "queued" });
        await repos.messages.create({ tenantId: "t2", template: "c", subject: "C", status: "queued" });
        await repos.messages.setStatus(m1.id, "sent", { sentAt: new Date() });
        const list = await repos.messages.listByTenant("t1");
        expect(list.map((m) => m.template)).toEqual(["b", "a"]);
        expect(list[1]!.status).toBe("sent");
        expect(list[1]!.sentAt).toBeInstanceOf(Date);
      });

      it("finds one message only within its own business", async () => {
        const m = await repos.messages.create({ tenantId: "t1", template: "a", subject: "A", status: "skipped", preview: { html: "<p>hi</p>" } });
        expect((await repos.messages.findById("t1", m.id))?.preview?.html).toBe("<p>hi</p>");
        expect(await repos.messages.findById("t2", m.id)).toBeNull();
      });
    });

    describe("accounts", () => {
      it("usage counters can be read without counting", async () => {
        expect(await repos.usage.peek("x")).toBe(0);
        await repos.usage.increment("x");
        await repos.usage.increment("x");
        expect(await repos.usage.peek("x")).toBe(2);
      });

      it("one user per email, whatever its case", async () => {
        const a = await repos.users.upsertByEmail("Ann@Example.com ");
        const b = await repos.users.upsertByEmail("ann@example.com");
        expect(a.created).toBe(true);
        expect(b.created).toBe(false);
        expect(b.user.id).toBe(a.user.id);
        expect(a.user.email).toBe("ann@example.com");
        expect((await repos.users.findByEmail(" ANN@example.com"))?.id).toBe(a.user.id);
        expect(await repos.users.findByEmail("nobody@example.com")).toBeNull();
        const u = await repos.users.update(a.user.id, { name: "Ann", lastLoginAt: new Date("2026-10-06T00:00:00Z"), passwordHash: "scrypt$x", emailVerifiedAt: new Date("2026-10-06T00:00:00Z") });
        expect(u.passwordHash).toBe("scrypt$x");
        expect(u.name).toBe("Ann");
        expect((await repos.users.findById(a.user.id))?.lastLoginAt).toEqual(new Date("2026-10-06T00:00:00Z"));
      });

      it("memberships: adding twice keeps the first role; listed per user", async () => {
        await repos.memberships.add({ userId: "u1", tenantId: "t1", role: "owner" });
        await repos.memberships.add({ userId: "u1", tenantId: "t1", role: "staff" });
        await repos.memberships.add({ userId: "u1", tenantId: "t2", role: "staff" });
        expect((await repos.memberships.find("u1", "t1"))?.role).toBe("owner");
        expect(await repos.memberships.find("u2", "t1")).toBeNull();
        expect((await repos.memberships.listByUser("u1")).map((m) => m.tenantId).sort()).toEqual(["t1", "t2"]);
      });

      it("an emailed code works once, counts every guess, and locks after too many", async () => {
        const now = new Date("2026-10-06T12:00:00Z");
        const later = new Date(+now + 60_000);
        await repos.emailCodes.issue({ email: "a@x.co", purpose: "verify", codeHash: "right", expiresAt: later });
        expect(await repos.emailCodes.attempt("a@x.co", "verify", "wrong", now, 3)).toBe("wrong");
        expect(await repos.emailCodes.attempt("a@x.co", "reset", "right", now, 3)).toBe("expired"); // another purpose has no code
        expect(await repos.emailCodes.attempt("a@x.co", "verify", "right", now, 3)).toBe("ok");
        expect(await repos.emailCodes.attempt("a@x.co", "verify", "right", now, 3)).toBe("expired"); // used

        await repos.emailCodes.issue({ email: "b@x.co", purpose: "reset", codeHash: "right", expiresAt: later });
        const guesses = await Promise.all([1, 2, 3, 4, 5].map(() => repos.emailCodes.attempt("b@x.co", "reset", "nope", now, 3)));
        expect(guesses.filter((g) => g === "wrong")).toHaveLength(3); // parallel guesses can't exceed the limit
        expect(await repos.emailCodes.attempt("b@x.co", "reset", "right", now, 3)).toBe("locked"); // even the right code, now

        await repos.emailCodes.issue({ email: "b@x.co", purpose: "reset", codeHash: "fresh", expiresAt: later }); // a new code resets the count
        expect(await repos.emailCodes.attempt("b@x.co", "reset", "fresh", now, 3)).toBe("ok");
        await repos.emailCodes.issue({ email: "c@x.co", purpose: "verify", codeHash: "x", expiresAt: new Date(+now - 1) });
        expect(await repos.emailCodes.attempt("c@x.co", "verify", "x", now, 3)).toBe("expired");
      });

      it("sessions are found until they expire, and can be deleted", async () => {
        const now = new Date("2026-10-06T12:00:00Z");
        await repos.sessions.create({ idHash: "s1", userId: "u1", expiresAt: new Date(+now + 60_000) });
        await repos.sessions.create({ idHash: "s2", userId: "u1", expiresAt: new Date(+now - 1) });
        expect((await repos.sessions.find("s1", now))?.userId).toBe("u1");
        expect(await repos.sessions.find("s2", now)).toBeNull();
        await repos.sessions.delete("s1");
        expect(await repos.sessions.find("s1", now)).toBeNull();
        for (const id of ["a", "b", "c"]) await repos.sessions.create({ idHash: id, userId: "u2", expiresAt: new Date(+now + 60_000) });
        await repos.sessions.deleteByUser("u2", "b");
        expect(await repos.sessions.find("a", now)).toBeNull();
        expect(await repos.sessions.find("b", now)).not.toBeNull(); // the one kept
        expect(await repos.sessions.find("c", now)).toBeNull();
      });

      it("purging a business removes its memberships", async () => {
        const t = await repos.tenants.create({ name: "Gone", subdomain: "gone", taxRateBps: 0, priceList: [], apiKeyHash: "h" });
        await repos.memberships.add({ userId: "u9", tenantId: t.id, role: "owner" });
        await repos.purgeTenant(t.id);
        expect(await repos.memberships.listByUser("u9")).toEqual([]);
      });
    });

    describe("demo cleanup", () => {
      it("lists expired demos and purges a business with everything it owns, leaving others alone", async () => {
        const mk = (sub: string, expiresAt?: Date) =>
          repos.tenants.create({ name: sub, subdomain: sub, taxRateBps: 0, priceList: [], apiKeyHash: "h", ...(expiresAt ? { demo: { expiresAt } } : {}) });
        const old = await mk("demo-old", new Date("2026-01-01"));
        const fresh = await mk("demo-new", new Date("2099-01-01"));
        const real = await mk("real-biz");
        expect((await repos.tenants.listExpiredDemos(new Date("2026-06-01"))).map((t) => t.subdomain)).toEqual(["demo-old"]);

        for (const t of [old, real]) {
          const lead = await repos.leads.create({ tenantId: t.id, name: "A", message: "m", source: "web" });
          await repos.customers.upsertByContact(t.id, { name: "A", email: "a@x.co" });
          await repos.messages.create({ tenantId: t.id, template: "x", subject: "x", status: "skipped" });
          const e = await repos.estimates.create({ tenantId: t.id, leadId: lead.id, lineItems: [], taxRateBps: 0, status: "draft" });
          await repos.invoices.create({ tenantId: t.id, estimateId: e.id, number: await repos.invoices.nextNumber(t.id), lineItems: [], taxRateBps: 0, totals: { subtotalCents: 0, taxCents: 0, totalCents: 0 }, status: "open" });
          const a = await repos.applications.create({ tenantId: t.id, industry: "x", monthsInBusiness: 1, statedMonthlyRevenueCents: 1, amountRequestedCents: 1, useOfFunds: "x", status: "draft" });
          await repos.transactions.insertMany([{ tenantId: t.id, applicationId: a.id, date: "2026-01-01", description: "d", amountCents: 1, category: "revenue", rule: "r", fingerprint: "f1" }]);
        }
        await repos.purgeTenant(old.id);

        expect(await repos.tenants.findById(old.id)).toBeNull();
        expect(await repos.leads.listByTenant(old.id)).toEqual([]);
        expect(await repos.estimates.listByTenant(old.id)).toEqual([]);
        expect(await repos.invoices.listByTenant(old.id)).toEqual([]);
        expect(await repos.applications.listByTenant(old.id)).toEqual([]);
        expect(await repos.customers.listByTenant(old.id)).toEqual([]);
        expect(await repos.messages.listByTenant(old.id)).toEqual([]);
        expect(await repos.tenants.listExpiredDemos(new Date("2026-06-01"))).toEqual([]);
        for (const t of [real, fresh]) expect(await repos.tenants.findById(t.id)).not.toBeNull();
        expect(await repos.leads.listByTenant(real.id)).toHaveLength(1);
        expect(await repos.invoices.listByTenant(real.id)).toHaveLength(1);
      });
    });

    describe("underwriting queries", () => {
      const base = {
        industry: "x", monthsInBusiness: 12, statedMonthlyRevenueCents: 1, amountRequestedCents: 1, useOfFunds: "x", status: "assessed" as const,
      };
      const pending = { outcome: "pending_review" as const, decidedBy: { kind: "scorecard" as const, version: "v" }, at: new Date() };
      it("lists pending reviews across businesses, oldest first; finds any by id", async () => {
        const a = await repos.applications.create({ ...base, tenantId: "t1", decision: pending });
        const b = await repos.applications.create({ ...base, tenantId: "t2", decision: pending });
        await repos.applications.create({ ...base, tenantId: "t1", decision: { ...pending, outcome: "approved" } });
        expect((await repos.applications.listByOutcome("pending_review")).map((x) => x.id)).toEqual([a.id, b.id]);
        expect(await repos.applications.listByOutcome("approved")).toHaveLength(1);
        expect((await repos.applications.findByIdAnyTenant(b.id))?.tenantId).toBe("t2");
      });
      it("invoices list newest first per business", async () => {
        const inv = (tenantId: string, n: string) => ({
          tenantId, estimateId: n, number: n, lineItems: [], taxRateBps: 0, totals: { subtotalCents: 0, taxCents: 0, totalCents: 0 }, status: "open" as const,
        });
        await repos.invoices.create(inv("t1", "INV-1"));
        await repos.invoices.create(inv("t1", "INV-2"));
        await repos.invoices.create(inv("t2", "INV-9"));
        expect((await repos.invoices.listByTenant("t1")).map((i) => i.number)).toEqual(["INV-2", "INV-1"]);
      });
    });
  });
}

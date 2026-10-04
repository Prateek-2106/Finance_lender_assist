// Reference implementation of the Repos contract, used by most tests.
import { randomUUID } from "node:crypto";
import type { BankTransaction, Customer, Estimate, FundingApplication, Id, Invoice, Lead, Message, Tenant } from "../domain";
import { ConflictError, NotFoundError } from "../errors";
import type { Repos } from "./types";

const clone = <T>(v: T): T => structuredClone(v);

export function createMemoryRepos(): Repos {
  const tenants = new Map<Id, Tenant>();
  const leads: Lead[] = [];
  const estimates = new Map<Id, Estimate>();
  const invoices = new Map<Id, Invoice>();
  const counters = new Map<Id, number>();
  const applications = new Map<Id, FundingApplication>();
  const txns: BankTransaction[] = [];
  const customers: Customer[] = [];
  const messages: Message[] = [];
  const usage = new Map<string, number>();

  const hostTaken = (hostname: string | undefined, exceptId?: Id) =>
    !!hostname && [...tenants.values()].some((t) => t.id !== exceptId && t.customDomain?.hostname === hostname);

  return {
    tenants: {
      async create(input) {
        if ([...tenants.values()].some((t) => t.subdomain === input.subdomain))
          throw new ConflictError(`Subdomain "${input.subdomain}" is taken`);
        if (hostTaken(input.customDomain?.hostname)) throw new ConflictError("Hostname is taken");
        const t: Tenant = { ...clone(input), id: randomUUID(), createdAt: new Date() };
        tenants.set(t.id, t);
        return clone(t);
      },
      async findById(id) {
        const t = tenants.get(id);
        return t ? clone(t) : null;
      },
      async findBySubdomain(s) {
        const t = [...tenants.values()].find((t) => t.subdomain === s);
        return t ? clone(t) : null;
      },
      async findByCustomDomain(h) {
        const t = [...tenants.values()].find((t) => t.customDomain?.hostname === h);
        return t ? clone(t) : null;
      },
      async update(id, patch) {
        const t = tenants.get(id);
        if (!t) throw new NotFoundError("Tenant not found");
        if (patch.subdomain && [...tenants.values()].some((o) => o.id !== id && o.subdomain === patch.subdomain))
          throw new ConflictError("Subdomain is taken");
        if (hostTaken(patch.customDomain?.hostname, id)) throw new ConflictError("Hostname is taken");
        const next: Tenant = { ...t, ...clone(patch) };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
        tenants.set(id, next);
        return clone(next);
      },
    },
    leads: {
      async create(input) {
        const l: Lead = { ...clone(input), id: randomUUID(), createdAt: input.createdAt ?? new Date() };
        leads.push(l);
        return clone(l);
      },
      async findById(tenantId, id) {
        const l = leads.find((l) => l.id === id && l.tenantId === tenantId);
        return l ? clone(l) : null;
      },
      async listByTenant(tenantId, opts = {}) {
        return leads
          .filter((l) => l.tenantId === tenantId)
          .reverse()
          .slice(0, opts.limit ?? 50)
          .map(clone);
      },
    },
    estimates: {
      async create(input) {
        const e: Estimate = { ...clone(input), id: randomUUID(), createdAt: input.createdAt ?? new Date() };
        estimates.set(e.id, e);
        return clone(e);
      },
      async findById(tenantId, id) {
        const e = estimates.get(id);
        return e && e.tenantId === tenantId ? clone(e) : null;
      },
      async listByTenant(tenantId, opts = {}) {
        return [...estimates.values()].filter((e) => e.tenantId === tenantId).reverse().slice(0, opts.limit ?? 50).map(clone);
      },
      async findOpenByLead(tenantId, leadId) {
        const e = [...estimates.values()].reverse().find((e) => e.tenantId === tenantId && e.leadId === leadId && (e.status === "needs_review" || e.status === "draft"));
        return e ? clone(e) : null;
      },
      async update(tenantId, id, patch) {
        const e = estimates.get(id);
        if (!e || e.tenantId !== tenantId) throw new NotFoundError("Estimate not found");
        const next = { ...e, ...clone(patch) };
        estimates.set(id, next);
        return clone(next);
      },
    },
    invoices: {
      async create(input) {
        const i: Invoice = { ...clone(input), id: randomUUID(), createdAt: input.createdAt ?? new Date() };
        invoices.set(i.id, i);
        return clone(i);
      },
      async findById(tenantId, id) {
        const i = invoices.get(id);
        return i && i.tenantId === tenantId ? clone(i) : null;
      },
      async findByEstimate(tenantId, estimateId) {
        const i = [...invoices.values()].find((i) => i.tenantId === tenantId && i.estimateId === estimateId);
        return i ? clone(i) : null;
      },
      async update(tenantId, id, patch) {
        const i = invoices.get(id);
        if (!i || i.tenantId !== tenantId) throw new NotFoundError("Invoice not found");
        const next = { ...i, ...clone(patch) };
        invoices.set(id, next);
        return clone(next);
      },
      async listByTenant(tenantId, opts = {}) {
        return [...invoices.values()].filter((i) => i.tenantId === tenantId).reverse().slice(0, opts.limit ?? 50).map(clone);
      },
      async nextNumber(tenantId) {
        const n = (counters.get(tenantId) ?? 0) + 1;
        counters.set(tenantId, n);
        return `INV-${String(n).padStart(4, "0")}`;
      },
    },
    applications: {
      async create(input) {
        const a: FundingApplication = { ...clone(input), id: randomUUID(), createdAt: new Date() };
        applications.set(a.id, a);
        return clone(a);
      },
      async findById(tenantId, id) {
        const a = applications.get(id);
        return a && a.tenantId === tenantId ? clone(a) : null;
      },
      async listByTenant(tenantId, opts = {}) {
        return [...applications.values()].filter((a) => a.tenantId === tenantId).reverse().slice(0, opts.limit ?? 50).map(clone);
      },
      async listByOutcome(outcome, opts = {}) {
        const list = [...applications.values()].filter((a) => a.decision?.outcome === outcome);
        if (outcome !== "pending_review") list.reverse(); // decided: newest first
        return list.slice(0, opts.limit ?? 50).map(clone);
      },
      async findByIdAnyTenant(id) {
        const a = applications.get(id);
        return a ? clone(a) : null;
      },
      async update(tenantId, id, patch) {
        const a = applications.get(id);
        if (!a || a.tenantId !== tenantId) throw new NotFoundError("Application not found");
        const next = { ...a, ...clone(patch) };
        applications.set(id, next);
        return clone(next);
      },
    },
    transactions: {
      async insertMany(lines) {
        let inserted = 0;
        let duplicates = 0;
        for (const l of lines) {
          if (txns.some((t) => t.applicationId === l.applicationId && t.fingerprint === l.fingerprint)) {
            duplicates++;
            continue;
          }
          txns.push({ ...clone(l), id: randomUUID(), createdAt: new Date() });
          inserted++;
        }
        return { inserted, duplicates };
      },
      async listByApplication(tenantId, applicationId, opts = {}) {
        return txns
          .filter((t) => t.tenantId === tenantId && t.applicationId === applicationId)
          .filter((t) => !opts.category || t.category === opts.category)
          .sort((x, y) => x.date.localeCompare(y.date)) // stable: same-day lines keep statement order
          .map(clone);
      },
    },
    customers: {
      async upsertByContact(tenantId, c) {
        const existing = customers.find(
          (x) => x.tenantId === tenantId && ((c.email && x.email === c.email) || (c.phone && x.phone === c.phone)),
        );
        if (existing) {
          Object.assign(existing, {
            name: c.name ?? existing.name,
            ...(c.email ? { email: c.email } : {}),
            ...(c.phone ? { phone: c.phone } : {}),
            leadCount: existing.leadCount + 1,
            lastSeenAt: new Date(),
          });
          return clone(existing);
        }
        const now = new Date();
        const created: Customer = { id: randomUUID(), tenantId, ...clone(c), name: c.name ?? c.phone ?? c.email ?? "Customer", leadCount: 1, createdAt: now, lastSeenAt: now };
        customers.push(created);
        return clone(created);
      },
      async findById(tenantId, id) {
        const c = customers.find((x) => x.id === id && x.tenantId === tenantId);
        return c ? clone(c) : null;
      },
      async listByTenant(tenantId, opts = {}) {
        return customers
          .filter((c) => c.tenantId === tenantId)
          .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
          .slice(0, opts.limit ?? 50)
          .map(clone);
      },
    },
    messages: {
      async create(input) {
        const msg: Message = { ...clone(input), id: randomUUID(), createdAt: new Date() };
        messages.push(msg);
        return clone(msg);
      },
      async setStatus(id, status, extra = {}) {
        const msg = messages.find((x) => x.id === id);
        if (msg) Object.assign(msg, { status, ...clone(extra) });
      },
      async findById(tenantId, id) {
        const msg = messages.find((x) => x.id === id && x.tenantId === tenantId);
        return msg ? clone(msg) : null;
      },
      async listByTenant(tenantId, opts = {}) {
        return messages.filter((x) => x.tenantId === tenantId).reverse().slice(0, opts.limit ?? 50).map(clone);
      },
    },
    usage: {
      async increment(key) {
        const n = (usage.get(key) ?? 0) + 1;
        usage.set(key, n);
        return n;
      },
    },
  };
}

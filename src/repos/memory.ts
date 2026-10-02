// Reference implementation of the Repos contract, used by most tests.
import { randomUUID } from "node:crypto";
import type { BankTransaction, Estimate, FundingApplication, Id, Invoice, Lead, Tenant } from "../domain";
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
        const next = { ...t, ...clone(patch) };
        tenants.set(id, next);
        return clone(next);
      },
    },
    leads: {
      async create(input) {
        const l: Lead = { ...clone(input), id: randomUUID(), createdAt: new Date() };
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
        const e: Estimate = { ...clone(input), id: randomUUID(), createdAt: new Date() };
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
        const i: Invoice = { ...clone(input), id: randomUUID(), createdAt: new Date() };
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
  };
}

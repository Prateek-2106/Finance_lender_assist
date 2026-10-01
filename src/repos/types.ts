// The contract every storage backend must satisfy.
// Implemented by repos/memory.ts (tests, local dev) and repos/mongo.ts.
import type { Estimate, Id, Invoice, Lead, Tenant } from "../domain";

export type NewTenant = Omit<Tenant, "id" | "createdAt">;
export type NewLead = Omit<Lead, "id" | "createdAt">;
export type NewEstimate = Omit<Estimate, "id" | "createdAt">;
export type NewInvoice = Omit<Invoice, "id" | "createdAt">;

export interface TenantRepo {
  /** Throws ConflictError if the subdomain (or custom hostname) is taken. */
  create(input: NewTenant): Promise<Tenant>;
  findById(id: Id): Promise<Tenant | null>;
  findBySubdomain(subdomain: string): Promise<Tenant | null>;
  /** Matches customDomain.hostname regardless of verification status. */
  findByCustomDomain(hostname: string): Promise<Tenant | null>;
  /** Throws NotFoundError if missing, ConflictError on a hostname clash. */
  update(id: Id, patch: Partial<NewTenant>): Promise<Tenant>;
}

export interface LeadRepo {
  create(input: NewLead): Promise<Lead>;
  /** Every read is scoped by tenantId. A lead from another tenant is simply "not found". */
  findById(tenantId: Id, id: Id): Promise<Lead | null>;
  /** Newest first. */
  listByTenant(tenantId: Id, opts?: { limit?: number }): Promise<Lead[]>;
}

export interface EstimateRepo {
  create(input: NewEstimate): Promise<Estimate>;
  findById(tenantId: Id, id: Id): Promise<Estimate | null>;
  update(tenantId: Id, id: Id, patch: Partial<NewEstimate>): Promise<Estimate>;
}

export interface InvoiceRepo {
  create(input: NewInvoice): Promise<Invoice>;
  findById(tenantId: Id, id: Id): Promise<Invoice | null>;
  findByEstimate(tenantId: Id, estimateId: Id): Promise<Invoice | null>;
  update(tenantId: Id, id: Id, patch: Partial<NewInvoice>): Promise<Invoice>;
  /** Atomically returns the next per-tenant number: "INV-0001", "INV-0002", ... */
  nextNumber(tenantId: Id): Promise<string>;
}

export interface Repos {
  tenants: TenantRepo;
  leads: LeadRepo;
  estimates: EstimateRepo;
  invoices: InvoiceRepo;
}

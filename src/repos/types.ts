// The contract every storage backend must satisfy.
// Implemented by repos/memory.ts (tests, local dev) and repos/mongo.ts.
import type { BankTransaction, CodePurpose, Contact, Customer, Membership, Session, User, Estimate, FundingApplication, FundingDecision, Id, Invoice, Lead, Message, MessageStatus, Tenant, TxnCategory } from "../domain";

export type NewTenant = Omit<Tenant, "id" | "createdAt">;
/** `createdAt` may be set explicitly only to seed history (demo businesses); normal code lets the repo stamp it. */
export type NewLead = Omit<Lead, "id" | "createdAt"> & { createdAt?: Date };
export type NewEstimate = Omit<Estimate, "id" | "createdAt"> & { createdAt?: Date };
export type NewInvoice = Omit<Invoice, "id" | "createdAt"> & { createdAt?: Date };
export type NewApplication = Omit<FundingApplication, "id" | "createdAt">;
export type NewTransaction = Omit<BankTransaction, "id" | "createdAt">;
export type NewMessage = Omit<Message, "id" | "createdAt">;

export interface TenantRepo {
  /** Throws ConflictError if the subdomain (or custom hostname) is taken. */
  create(input: NewTenant): Promise<Tenant>;
  findById(id: Id): Promise<Tenant | null>;
  findBySubdomain(subdomain: string): Promise<Tenant | null>;
  /** Matches customDomain.hostname regardless of verification status. */
  findByCustomDomain(hostname: string): Promise<Tenant | null>;
  /** Throws NotFoundError if missing, ConflictError on a hostname clash. */
  update(id: Id, patch: Partial<NewTenant>): Promise<Tenant>;
  /** Demo businesses whose time ran out before `now`, oldest first. */
  listExpiredDemos(now: Date, opts?: { limit?: number }): Promise<Tenant[]>;
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
  /** Newest first. */
  listByTenant(tenantId: Id, opts?: { limit?: number }): Promise<Estimate[]>;
  /** The newest estimate for a lead that is still being worked on (needs_review or draft). */
  findOpenByLead(tenantId: Id, leadId: Id): Promise<Estimate | null>;
  update(tenantId: Id, id: Id, patch: Partial<NewEstimate>): Promise<Estimate>;
}

export interface InvoiceRepo {
  create(input: NewInvoice): Promise<Invoice>;
  findById(tenantId: Id, id: Id): Promise<Invoice | null>;
  findByEstimate(tenantId: Id, estimateId: Id): Promise<Invoice | null>;
  update(tenantId: Id, id: Id, patch: Partial<NewInvoice>): Promise<Invoice>;
  /** Newest first. */
  listByTenant(tenantId: Id, opts?: { limit?: number }): Promise<Invoice[]>;
  /** Atomically returns the next per-tenant number: "INV-0001", "INV-0002", ... */
  nextNumber(tenantId: Id): Promise<string>;
}

export interface ApplicationRepo {
  create(input: NewApplication): Promise<FundingApplication>;
  findById(tenantId: Id, id: Id): Promise<FundingApplication | null>;
  /** Newest first. */
  listByTenant(tenantId: Id, opts?: { limit?: number }): Promise<FundingApplication[]>;
  /** Underwriter views span every business. Pending reviews come oldest first (first in, first decided). */
  listByOutcome(outcome: FundingDecision["outcome"], opts?: { limit?: number }): Promise<FundingApplication[]>;
  /** Underwriters only: no tenant scope. Never expose this to a tenant route. */
  findByIdAnyTenant(id: Id): Promise<FundingApplication | null>;
  update(tenantId: Id, id: Id, patch: Partial<NewApplication>): Promise<FundingApplication>;
}

export interface TransactionRepo {
  /** Inserts lines whose fingerprint is new for this application; skips the rest. */
  insertMany(lines: NewTransaction[]): Promise<{ inserted: number; duplicates: number }>;
  /** Oldest first (statement order). */
  listByApplication(tenantId: Id, applicationId: Id, opts?: { category?: TxnCategory }): Promise<BankTransaction[]>;
}

export interface CustomerRepo {
  /** Finds the customer with this email or phone (in this business) and refreshes their details, or creates one. */
  upsertByContact(tenantId: Id, contact: Partial<Contact>): Promise<Customer>; // no name: keep the known one
  findById(tenantId: Id, id: Id): Promise<Customer | null>;
  /** Most recently seen first. */
  listByTenant(tenantId: Id, opts?: { limit?: number }): Promise<Customer[]>;
}

export interface MessageRepo {
  create(input: NewMessage): Promise<Message>;
  setStatus(id: Id, status: MessageStatus, extra?: { error?: string; sentAt?: Date }): Promise<void>;
  findById(tenantId: Id, id: Id): Promise<Message | null>;
  /** Newest first. */
  listByTenant(tenantId: Id, opts?: { limit?: number }): Promise<Message[]>;
}

export interface UsageRepo {
  /** Atomically adds `by` (default 1) to a named counter and returns the new value (e.g. "ai:2026-10-04"). */
  increment(key: string, by?: number): Promise<number>;
  /** The current value without changing it (0 if never counted). */
  peek(key: string): Promise<number>;
}

export interface UserRepo {
  /** Finds the user with this email (case-insensitive) or creates one. */
  upsertByEmail(email: string): Promise<{ user: User; created: boolean }>;
  findById(id: Id): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  update(id: Id, patch: Partial<Pick<User, "name" | "lastLoginAt" | "passwordHash" | "emailVerifiedAt">>): Promise<User>;
}

export interface MembershipRepo {
  /** Adds the user to the business; adding twice keeps the first role. */
  add(input: Omit<Membership, "createdAt">): Promise<Membership>;
  find(userId: Id, tenantId: Id): Promise<Membership | null>;
  listByUser(userId: Id): Promise<Membership[]>;
}

export type CodeCheck = "ok" | "wrong" | "expired" | "locked";
export interface EmailCodeRepo {
  /** Stores a new code for this address and purpose, replacing any earlier one. */
  issue(input: { email: string; purpose: CodePurpose; codeHash: string; expiresAt: Date }): Promise<void>;
  /**
   * One guess. Counts the attempt first (atomically), so guesses can't race past the limit;
   * "ok" also marks the code used, so it works exactly once.
   */
  attempt(email: string, purpose: CodePurpose, codeHash: string, now: Date, maxAttempts: number): Promise<CodeCheck>;
}

export interface SessionRepo {
  create(input: Omit<Session, "createdAt">): Promise<Session>;
  /** The session if it exists and hasn't expired. */
  find(idHash: string, now: Date): Promise<Session | null>;
  delete(idHash: string): Promise<void>;
  /** Signs a user out everywhere (after a password reset), optionally keeping one session. */
  deleteByUser(userId: Id, exceptIdHash?: string): Promise<void>;
}

/** Counts per UTC day ("2026-10-06" → n); days with nothing are left out. */
export type DayCounts = Record<string, number>;
export interface PlatformStats {
  users: { total: number; confirmed: number };
  businesses: { real: number; demosLive: number };
  /** From `since` on. Leads count real businesses only; demo businesses are seeded with fake ones. */
  daily: { signups: DayCounts; businesses: DayCounts; leads: DayCounts; emailsSent: DayCounts; emailsFailed: DayCounts };
}

export interface StatsRepo {
  /** Platform-wide numbers for the owner's admin page. Never expose to a tenant route. */
  overview(since: Date): Promise<PlatformStats>;
}

export interface Repos {
  tenants: TenantRepo;
  leads: LeadRepo;
  estimates: EstimateRepo;
  invoices: InvoiceRepo;
  applications: ApplicationRepo;
  transactions: TransactionRepo;
  customers: CustomerRepo;
  messages: MessageRepo;
  usage: UsageRepo;
  users: UserRepo;
  memberships: MembershipRepo;
  emailCodes: EmailCodeRepo;
  sessions: SessionRepo;
  stats: StatsRepo;
  /** Is the database answering? Throws if not (used by /ready and the health page). */
  ping(): Promise<void>;
  /** Deletes a business and everything it owns (demo cleanup). */
  purgeTenant(tenantId: Id): Promise<void>;
}

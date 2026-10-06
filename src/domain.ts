// ─────────────────────────────────────────────────────────────
// Shared domain types.
// Money is ALWAYS integer cents. Tax rates are basis points (bps):
// 825 bps = 8.25%.
// ─────────────────────────────────────────────────────────────

export type Id = string;

export interface PriceItem {
  sku: string; // e.g. "WH-FLUSH"
  name: string; // e.g. "Water heater flush"
  unitPriceCents: number;
  unit?: string; // e.g. "hour", "each"
  fractional?: boolean; // can be sold in parts (1.5 hours, 12.5 feet); otherwise whole units only
}

/** Who a job is for. Snapshotted onto estimates and invoices so later edits never change an issued document. */
export interface Contact {
  name: string;
  phone?: string; // E.164
  email?: string;
}

export interface CustomDomain {
  hostname: string; // e.g. "joesplumbing.com"
  status: "pending" | "verified";
  verificationToken: string;
}

export interface Tenant {
  id: Id;
  name: string;
  subdomain: string; // "joes-plumbing" → joes-plumbing.<BASE_DOMAIN>
  customDomain?: CustomDomain;
  priceList: PriceItem[];
  taxRateBps: number;
  ownerEmail?: string; // where new-lead and funding emails go
  demo?: { expiresAt: Date }; // a throwaway business created from the homepage: emails are shown, never sent
  apiKeyHash: string; // sha256 of the owner API key — never return this from the API
  createdAt: Date;
}

/** What the API is allowed to return for a tenant. */
export type PublicTenant = Omit<Tenant, "apiKeyHash">;

export type LeadSource = "web" | "sms";

export interface Lead {
  id: Id;
  tenantId: Id;
  name: string;
  phone?: string; // E.164, e.g. "+17165550123"
  email?: string;
  message: string;
  source: LeadSource;
  customerId?: Id; // the same person across jobs (matched by email or phone)
  createdAt: Date;
}

/** A person who has asked this business for work, possibly many times. */
export interface Customer {
  id: Id;
  tenantId: Id;
  name: string;
  phone?: string;
  email?: string;
  leadCount: number;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface LineItem {
  sku?: string;
  description: string;
  quantity: number; // whole units unless the price-list item is fractional (1.5 hours)
  unitPriceCents: number;
  fractional?: boolean; // copied from the price list; the server re-derives it, never trusts the client
}

export interface Totals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export type EstimateStatus =
  | "needs_review" // AI drafted it, a human must look
  | "draft"
  | "sent"
  | "accepted"
  | "declined"
  | "invoiced";

export interface Estimate {
  id: Id;
  tenantId: Id;
  leadId?: Id;
  lineItems: LineItem[];
  taxRateBps: number;
  status: EstimateStatus;
  customer?: Contact; // from the lead, or entered by the owner
  notes?: string;
  aiDraft?: { model: string; questions: string[]; rejected: { sku: string; quantity: unknown; why: string }[] };
  createdAt: Date;
}

export type InvoiceStatus = "open" | "paid" | "void";

export interface Invoice {
  id: Id;
  tenantId: Id;
  estimateId: Id;
  number: string; // per-tenant sequence: "INV-0001"
  billTo?: Contact; // snapshot of the customer at conversion
  lineItems: LineItem[]; // snapshot of the estimate at conversion
  taxRateBps: number; // snapshot too: later tax changes never alter an issued invoice
  totals: Totals;
  status: InvoiceStatus;
  paidAt?: Date;
  createdAt: Date;
}

export interface Receipt {
  invoiceNumber: string;
  tenantName: string;
  billTo?: Contact;
  amountPaidCents: number;
  paidAt: Date;
}

// ── Funding (steps 6–7) ─────────────────────────────────────

export type ApplicationStatus = "draft" | "assessed";

export interface FundingApplication {
  id: Id;
  tenantId: Id; // the business applying is the tenant itself
  industry: string;
  monthsInBusiness: number;
  statedMonthlyRevenueCents: number;
  amountRequestedCents: number;
  useOfFunds: string;
  status: ApplicationStatus;
  assessment?: import("./risk/assess").Assessment; // latest run of the risk engine
  memo?: import("./ai/memo").Memo; // AI underwriting memo, verified against the assessment
  decision?: FundingDecision; // the current answer to the applicant
  decisionLog?: FundingDecision[]; // every decision ever made, oldest first (audit trail)
  createdAt: Date;
}

/** Who decided, what, when and why. The scorecard decides clear cases; a named underwriter decides the rest. */
export interface FundingDecision {
  outcome: "approved" | "declined" | "pending_review";
  decidedBy: { kind: "scorecard"; version: string } | { kind: "underwriter"; name: string };
  at: Date;
  note?: string; // required from underwriters
  offer?: import("./risk/assess").Offer | null;
}

export type MessageStatus = "queued" | "sent" | "failed" | "skipped";

/** Every email the platform tried to send: the "what did we tell the customer, and when" log. */
export interface Message {
  id: Id;
  tenantId: Id;
  template: string;
  to?: string;
  subject: string;
  status: MessageStatus;
  error?: string; // why it failed or was skipped
  relatedId?: Id; // the lead, estimate, invoice or application it's about
  preview?: { html: string }; // demo businesses only: the email as it would have looked
  createdAt: Date;
  sentAt?: Date;
}

export type TxnCategory =
  | "revenue"
  | "transfer_in"
  | "loan_funding"
  | "reversal"
  | "nsf_fee"
  | "lender_payment"
  | "transfer_out"
  | "expense";

export interface BankTransaction {
  id: Id;
  tenantId: Id;
  applicationId: Id;
  date: string; // YYYY-MM-DD (a bank date has no time zone)
  description: string;
  amountCents: number; // credits positive, debits negative
  balanceCents?: number; // end-of-line running balance, when the bank provides it
  category: TxnCategory;
  rule: string; // which classification rule fired: the "why" an underwriter sees
  fingerprint: string; // dedupe key: re-uploading a statement adds nothing
  createdAt: Date;
}

// ── Accounts ────────────────────────────────────────────────

/** A person who signs in with their email. Owns or works at one or more businesses. */
export interface User {
  id: Id;
  email: string; // lower-case, verified by the sign-in link itself
  name?: string;
  createdAt: Date;
  lastLoginAt?: Date;
}

export type MemberRole = "owner" | "staff";
export interface Membership {
  userId: Id;
  tenantId: Id;
  role: MemberRole;
  createdAt: Date;
}

/** A one-time sign-in link. Only a hash of the token is stored. */
export interface LoginToken {
  tokenHash: string;
  email: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
}

/** A signed-in browser. The cookie holds a random id; only its hash is stored. */
export interface Session {
  idHash: string;
  userId: Id;
  createdAt: Date;
  expiresAt: Date;
}

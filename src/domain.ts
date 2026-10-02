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
  createdAt: Date;
}

export interface LineItem {
  sku?: string;
  description: string;
  quantity: number; // may be fractional (1.5 hours)
  unitPriceCents: number;
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
  createdAt: Date;
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

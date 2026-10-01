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
  createdAt: Date;
}

export type InvoiceStatus = "open" | "paid" | "void";

export interface Invoice {
  id: Id;
  tenantId: Id;
  estimateId: Id;
  number: string; // per-tenant sequence: "INV-0001"
  lineItems: LineItem[];
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

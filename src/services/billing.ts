import type { Estimate, EstimateStatus, Id, Invoice, LineItem, Receipt, Tenant } from "../domain";
import { InvalidTransitionError, NotFoundError, ValidationError } from "../errors";
import { computeTotals } from "../lib/money";
import type { Repos } from "../repos/types";
import { assertTransition } from "../workflow/estimate";

const EDITABLE: EstimateStatus[] = ["needs_review", "draft"];

export async function createEstimate(
  repos: Repos,
  tenant: Tenant,
  input: { leadId?: Id; lineItems: LineItem[]; notes?: string; status?: "draft" | "needs_review" },
): Promise<Estimate> {
  if (input.leadId && !(await repos.leads.findById(tenant.id, input.leadId))) throw new NotFoundError("Lead not found");
  return repos.estimates.create({
    tenantId: tenant.id,
    leadId: input.leadId,
    lineItems: input.lineItems,
    notes: input.notes,
    taxRateBps: tenant.taxRateBps,
    status: input.status ?? "draft",
  });
}

async function getEstimate(repos: Repos, tenantId: Id, id: Id): Promise<Estimate> {
  const e = await repos.estimates.findById(tenantId, id);
  if (!e) throw new NotFoundError("Estimate not found");
  return e;
}

export async function updateLineItems(repos: Repos, tenantId: Id, id: Id, lineItems: LineItem[]): Promise<Estimate> {
  const e = await getEstimate(repos, tenantId, id);
  if (!EDITABLE.includes(e.status)) throw new InvalidTransitionError(`Cannot edit an estimate that is ${e.status}`);
  return repos.estimates.update(tenantId, id, { lineItems });
}

export async function transitionEstimate(repos: Repos, tenantId: Id, id: Id, to: EstimateStatus): Promise<Estimate> {
  if (to === "invoiced") throw new InvalidTransitionError("Use convertToInvoice to invoice an estimate");
  const e = await getEstimate(repos, tenantId, id);
  assertTransition(e.status, to);
  if (to === "sent" && e.lineItems.length === 0) throw new ValidationError("Cannot send an empty estimate");
  return repos.estimates.update(tenantId, id, { status: to });
}

export async function convertToInvoice(repos: Repos, tenantId: Id, estimateId: Id): Promise<Invoice> {
  const existing = await repos.invoices.findByEstimate(tenantId, estimateId);
  if (existing) return existing;
  const e = await getEstimate(repos, tenantId, estimateId);
  assertTransition(e.status, "invoiced");
  const invoice = await repos.invoices.create({
    tenantId,
    estimateId,
    number: await repos.invoices.nextNumber(tenantId),
    lineItems: structuredClone(e.lineItems),
    totals: computeTotals(e.lineItems, e.taxRateBps),
    status: "open",
  });
  await repos.estimates.update(tenantId, estimateId, { status: "invoiced" });
  return invoice;
}

export async function payInvoice(
  repos: Repos,
  tenant: Tenant,
  invoiceId: Id,
  paidAt: Date = new Date(),
): Promise<{ invoice: Invoice; receipt: Receipt }> {
  const inv = await repos.invoices.findById(tenant.id, invoiceId);
  if (!inv) throw new NotFoundError("Invoice not found");
  if (inv.status !== "open") throw new InvalidTransitionError(`Invoice is already ${inv.status}`);
  const invoice = await repos.invoices.update(tenant.id, invoiceId, { status: "paid", paidAt });
  return {
    invoice,
    receipt: {
      invoiceNumber: invoice.number,
      tenantName: tenant.name,
      amountPaidCents: invoice.totals.totalCents,
      paidAt,
    },
  };
}

export async function voidInvoice(repos: Repos, tenantId: Id, invoiceId: Id): Promise<Invoice> {
  const inv = await repos.invoices.findById(tenantId, invoiceId);
  if (!inv) throw new NotFoundError("Invoice not found");
  if (inv.status !== "open") throw new InvalidTransitionError(`Cannot void an invoice that is ${inv.status}`);
  return repos.invoices.update(tenantId, invoiceId, { status: "void" });
}

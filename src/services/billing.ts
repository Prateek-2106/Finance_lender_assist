import type { Contact, Estimate, EstimateStatus, Id, Invoice, Lead, LineItem, PriceItem, Receipt, Tenant } from "../domain";
import { InvalidTransitionError, NotFoundError, ValidationError } from "../errors";
import { computeTotals } from "../lib/money";
import type { Repos } from "../repos/types";
import { assertTransition } from "../workflow/estimate";

const EDITABLE: EstimateStatus[] = ["needs_review", "draft"];

/**
 * Lines that name a price-list SKU take their "can be sold in parts" rule from the
 * price list (never from the client), and must be whole numbers unless it allows parts.
 * Free-form lines without a SKU are up to the owner.
 */
export function checkQuantities(priceList: PriceItem[], lineItems: LineItem[]): LineItem[] {
  const bySku = new Map(priceList.map((p) => [p.sku.toUpperCase(), p]));
  const problems: { path: string; message: string }[] = [];
  const out = lineItems.map((li, i) => {
    const item = li.sku ? bySku.get(li.sku.toUpperCase()) : undefined;
    const { fractional: _ignored, ...rest } = li;
    if (!item) return rest;
    if (!item.fractional && !Number.isInteger(li.quantity))
      problems.push({ path: `lineItems.${i}.quantity`, message: `${item.name} is sold in whole units; ${li.quantity} isn't a whole number` });
    return item.fractional ? { ...rest, fractional: true } : rest;
  });
  if (problems.length) throw new ValidationError("Some quantities aren't allowed", problems);
  return out;
}

export async function createEstimate(
  repos: Repos,
  tenant: Tenant,
  input: { leadId?: Id; customer?: Contact; lineItems: LineItem[]; notes?: string; status?: "draft" | "needs_review"; aiDraft?: Estimate["aiDraft"] },
): Promise<Estimate> {
  let lead: Lead | null = null;
  if (input.leadId) {
    lead = await repos.leads.findById(tenant.id, input.leadId);
    if (!lead) throw new NotFoundError("Lead not found");
  }
  const customer = input.customer ?? (lead ? contactOf(lead) : undefined);
  return repos.estimates.create({
    tenantId: tenant.id,
    leadId: input.leadId,
    ...(customer ? { customer } : {}),
    lineItems: checkQuantities(tenant.priceList, input.lineItems),
    notes: input.notes,
    taxRateBps: tenant.taxRateBps,
    status: input.status ?? "draft",
    ...(input.aiDraft ? { aiDraft: input.aiDraft } : {}),
  });
}

/** A lead from a text message has no real name; its phone number stands in. */
export function contactOf(lead: Pick<Lead, "name" | "phone" | "email">): Contact {
  return { name: lead.name, ...(lead.phone ? { phone: lead.phone } : {}), ...(lead.email ? { email: lead.email } : {}) };
}

async function getEstimate(repos: Repos, tenantId: Id, id: Id): Promise<Estimate> {
  const e = await repos.estimates.findById(tenantId, id);
  if (!e) throw new NotFoundError("Estimate not found");
  return e;
}

export async function updateLineItems(repos: Repos, tenantId: Id, id: Id, lineItems: LineItem[]): Promise<Estimate> {
  const e = await getEstimate(repos, tenantId, id);
  if (!EDITABLE.includes(e.status)) throw new InvalidTransitionError(`Cannot edit an estimate that is ${e.status}`);
  const tenant = await repos.tenants.findById(tenantId);
  return repos.estimates.update(tenantId, id, { lineItems: checkQuantities(tenant?.priceList ?? [], lineItems) });
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
    ...(e.customer ? { billTo: structuredClone(e.customer) } : {}),
    lineItems: structuredClone(e.lineItems),
    taxRateBps: e.taxRateBps,
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
      ...(invoice.billTo ? { billTo: invoice.billTo } : {}),
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

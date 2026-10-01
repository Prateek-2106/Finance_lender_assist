import { createMemoryRepos } from "../../src/repos/memory";
import {
  createEstimate,
  updateLineItems,
  transitionEstimate,
  convertToInvoice,
  payInvoice,
  voidInvoice,
} from "../../src/services/billing";
import { InvalidTransitionError, NotFoundError, ValidationError } from "../../src/errors";
import type { Tenant } from "../../src/domain";

const items = [
  { sku: "WH-FLUSH", description: "Water heater flush", quantity: 1, unitPriceCents: 12900 },
  { description: "Labor", quantity: 2, unitPriceCents: 9500 },
];

async function setup() {
  const repos = createMemoryRepos();
  const tenant: Tenant = await repos.tenants.create({
    name: "Joe's Plumbing",
    subdomain: "joes",
    priceList: [],
    taxRateBps: 875,
    apiKeyHash: "0".repeat(64),
  });
  const other = await repos.tenants.create({ ...tenant, subdomain: "other" });
  return { repos, tenant, other };
}

async function acceptedEstimate() {
  const ctx = await setup();
  const e = await createEstimate(ctx.repos, ctx.tenant, { lineItems: items });
  await transitionEstimate(ctx.repos, ctx.tenant.id, e.id, "sent");
  await transitionEstimate(ctx.repos, ctx.tenant.id, e.id, "accepted");
  return { ...ctx, e };
}

describe("createEstimate", () => {
  it("starts as draft with the tenant's tax rate", async () => {
    const { repos, tenant } = await setup();
    const e = await createEstimate(repos, tenant, { lineItems: items });
    expect(e).toMatchObject({ status: "draft", taxRateBps: 875, tenantId: tenant.id });
  });
  it("rejects a lead from another tenant", async () => {
    const { repos, tenant, other } = await setup();
    const lead = await repos.leads.create({ tenantId: other.id, name: "A", email: "a@b.co", message: "x", source: "web" });
    await expect(createEstimate(repos, tenant, { lineItems: items, leadId: lead.id })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("editing and transitions", () => {
  it("allows edits only while draft or needs_review", async () => {
    const { repos, tenant } = await setup();
    const e = await createEstimate(repos, tenant, { lineItems: items });
    await updateLineItems(repos, tenant.id, e.id, [items[0]!]);
    await transitionEstimate(repos, tenant.id, e.id, "sent");
    await expect(updateLineItems(repos, tenant.id, e.id, items)).rejects.toBeInstanceOf(InvalidTransitionError);
  });
  it("cannot send an empty estimate", async () => {
    const { repos, tenant } = await setup();
    const e = await createEstimate(repos, tenant, { lineItems: [] });
    await expect(transitionEstimate(repos, tenant.id, e.id, "sent")).rejects.toBeInstanceOf(ValidationError);
  });
  it("cannot jump to invoiced through a plain transition", async () => {
    const { repos, tenant, e } = await acceptedEstimate();
    await expect(transitionEstimate(repos, tenant.id, e.id, "invoiced")).rejects.toBeInstanceOf(InvalidTransitionError);
  });
  it("another tenant's estimate is not found", async () => {
    const { repos, other, e } = await acceptedEstimate();
    await expect(transitionEstimate(repos, other.id, e.id, "declined")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("convertToInvoice", () => {
  it("snapshots items, tax and totals, numbers it, and marks the estimate invoiced", async () => {
    const { repos, tenant, e } = await acceptedEstimate();
    const inv = await convertToInvoice(repos, tenant.id, e.id);
    // 12900 + 19000 = 31900; 8.75% = 2791.25 → 2791
    expect(inv).toMatchObject({
      number: "INV-0001",
      status: "open",
      taxRateBps: 875,
      totals: { subtotalCents: 31900, taxCents: 2791, totalCents: 34691 },
    });
    expect((await repos.estimates.findById(tenant.id, e.id))?.status).toBe("invoiced");
  });
  it("is idempotent: converting twice returns the same invoice and burns no number", async () => {
    const { repos, tenant, e } = await acceptedEstimate();
    const a = await convertToInvoice(repos, tenant.id, e.id);
    const b = await convertToInvoice(repos, tenant.id, e.id);
    expect(b.id).toBe(a.id);
    expect(await repos.invoices.nextNumber(tenant.id)).toBe("INV-0002");
  });
  it("requires an accepted estimate", async () => {
    const { repos, tenant } = await setup();
    const e = await createEstimate(repos, tenant, { lineItems: items });
    await expect(convertToInvoice(repos, tenant.id, e.id)).rejects.toBeInstanceOf(InvalidTransitionError);
  });
  it("is unaffected by later changes to the tenant's tax rate", async () => {
    const { repos, tenant, e } = await acceptedEstimate();
    const inv = await convertToInvoice(repos, tenant.id, e.id);
    await repos.tenants.update(tenant.id, { taxRateBps: 1000 });
    expect((await repos.invoices.findById(tenant.id, inv.id))?.totals.taxCents).toBe(2791);
  });
});

describe("payment and void", () => {
  it("paying produces a receipt; paying twice is rejected", async () => {
    const { repos, tenant, e } = await acceptedEstimate();
    const inv = await convertToInvoice(repos, tenant.id, e.id);
    const paidAt = new Date("2026-10-01T12:00:00Z");
    const { invoice, receipt } = await payInvoice(repos, tenant, inv.id, paidAt);
    expect(invoice.status).toBe("paid");
    expect(receipt).toEqual({ invoiceNumber: "INV-0001", tenantName: "Joe's Plumbing", amountPaidCents: 34691, paidAt });
    await expect(payInvoice(repos, tenant, inv.id)).rejects.toBeInstanceOf(InvalidTransitionError);
  });
  it("only open invoices can be voided, and a void invoice can't be paid", async () => {
    const { repos, tenant, e } = await acceptedEstimate();
    const inv = await convertToInvoice(repos, tenant.id, e.id);
    await voidInvoice(repos, tenant.id, inv.id);
    await expect(voidInvoice(repos, tenant.id, inv.id)).rejects.toBeInstanceOf(InvalidTransitionError);
    await expect(payInvoice(repos, tenant, inv.id)).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

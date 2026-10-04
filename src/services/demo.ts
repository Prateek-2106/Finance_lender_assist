// "Try it" on the homepage: every visitor gets their own throwaway plumbing business,
// already lived-in, so each screen has something to show on the first click.
import { randomBytes } from "node:crypto";
import type { Deps } from "../deps";
import type { LineItem, PriceItem, Tenant } from "../domain";
import { generateApiKey, hashApiKey } from "../lib/apiKey";
import { computeTotals } from "../lib/money";
import { PROFILES } from "../../fixtures/profiles";
import { generateStatement, toCsv } from "../../fixtures/generate";
import { assessApplication, createApplication, ingestStatement } from "./applications";
import { contactOf } from "./billing";

export const DEMO_PRICE_LIST: PriceItem[] = [
  { sku: "SVC-CALL", name: "Service call", unitPriceCents: 8900 },
  { sku: "LABOR", name: "Labor", unitPriceCents: 9500, unit: "hour", fractional: true },
  { sku: "WH-FLUSH", name: "Water heater flush", unitPriceCents: 12900 },
  { sku: "WH-INSTALL", name: "Water heater install (40 gal)", unitPriceCents: 145000 },
  { sku: "TPR-VALVE", name: "Pressure relief valve", unitPriceCents: 4500 },
  { sku: "DRAIN-CLR", name: "Drain clearing", unitPriceCents: 17500 },
  { sku: "FAUCET", name: "Faucet replacement", unitPriceCents: 22000 },
  { sku: "TOILET-RB", name: "Toilet rebuild kit + install", unitPriceCents: 16500 },
  { sku: "PIPE-FT", name: "Copper pipe", unitPriceCents: 1800, unit: "foot", fractional: true },
];

type Outcome = "paid" | "open" | "sent" | "declined" | "draft" | "none";
interface SeedJob {
  daysAgo: number;
  name: string;
  phone?: string;
  email?: string;
  message: string;
  source: "web" | "sms";
  lines: [sku: string, qty: number][];
  outcome: Outcome;
  paidAfterDays?: number;
}

// Six months of work: repeat customers, an open invoice, a declined quote, and two fresh
// leads at the top — one of them is the one to try "Draft with AI" on.
const JOBS: SeedJob[] = [
  { daysAgo: 168, name: "Dana Whitfield", email: "dana.whitfield@example.com", phone: "+17165550101", message: "Water heater is making popping noises.", source: "web", lines: [["SVC-CALL", 1], ["WH-FLUSH", 1]], outcome: "paid", paidAfterDays: 3 },
  { daysAgo: 151, name: "Marcus Lee", email: "marcus.lee@example.com", message: "Kitchen sink drains really slowly.", source: "web", lines: [["SVC-CALL", 1], ["DRAIN-CLR", 1]], outcome: "paid", paidAfterDays: 1 },
  { daysAgo: 133, name: "Priya Raman", phone: "+17165550103", message: "Toilet keeps running all night", source: "sms", lines: [["TOILET-RB", 1], ["LABOR", 0.5]], outcome: "paid", paidAfterDays: 6 },
  { daysAgo: 118, name: "Tom Okafor", email: "tom.okafor@example.com", message: "Need a quote to replace our 15-year-old water heater.", source: "web", lines: [["WH-INSTALL", 1], ["LABOR", 3], ["PIPE-FT", 6]], outcome: "paid", paidAfterDays: 9 },
  { daysAgo: 101, name: "Elena Garcia", email: "elena.garcia@example.com", message: "Bathroom faucet drips constantly.", source: "web", lines: [["FAUCET", 1]], outcome: "declined" },
  { daysAgo: 88, name: "Dana Whitfield", email: "dana.whitfield@example.com", phone: "+17165550101", message: "Same house, now the upstairs toilet is running.", source: "web", lines: [["TOILET-RB", 1]], outcome: "paid", paidAfterDays: 2 },
  { daysAgo: 70, name: "Chris Novak", email: "chris.novak@example.com", message: "Pipe under the sink is leaking.", source: "web", lines: [["SVC-CALL", 1], ["PIPE-FT", 4.5], ["LABOR", 1.5]], outcome: "paid", paidAfterDays: 4 },
  { daysAgo: 52, name: "Aisha Bello", phone: "+17165550108", message: "Shower drain backed up", source: "sms", lines: [["DRAIN-CLR", 1]], outcome: "paid", paidAfterDays: 1 },
  { daysAgo: 37, name: "Marcus Lee", email: "marcus.lee@example.com", message: "Water heater flush please, it's been a year.", source: "web", lines: [["WH-FLUSH", 1], ["TPR-VALVE", 1]], outcome: "paid", paidAfterDays: 5 },
  { daysAgo: 21, name: "Grace Kim", email: "grace.kim@example.com", message: "Garbage disposal and faucet both acting up.", source: "web", lines: [["SVC-CALL", 1], ["FAUCET", 1], ["LABOR", 1]], outcome: "open" },
  { daysAgo: 9, name: "Sam Patel", email: "sam.patel@example.com", message: "Basement floor drain smells, may be clogged.", source: "web", lines: [["DRAIN-CLR", 1]], outcome: "sent" },
  { daysAgo: 4, name: "Olivia Brooks", email: "olivia.brooks@example.com", message: "Replace two leaky faucets in the kitchen and bathroom.", source: "web", lines: [["FAUCET", 2], ["LABOR", 1]], outcome: "draft" },
  { daysAgo: 1, name: "Priya Raman", phone: "+17165550103", message: "Water heater only gives 5 min of hot water now. Can you flush it and check the relief valve?", source: "sms", lines: [], outcome: "none" },
  { daysAgo: 0, name: "Jordan Ellis", email: "jordan.ellis@example.com", message: "Our water heater is leaking from the bottom and it's about 12 years old. Probably needs replacing — what would that cost?", source: "web", lines: [], outcome: "none" },
];

/** Funding history: an earlier approval, an earlier decline, and a case waiting for an underwriter. */
const FUNDING = [
  { profile: "steady-bakery", amountRequestedCents: 3_000_000, useOfFunds: "Second service van" },
  { profile: "struggling-salon", amountRequestedCents: 2_500_000, useOfFunds: "Payroll during a slow month" },
  { profile: "stacked-auto", amountRequestedCents: 6_000_000, useOfFunds: "Hire a second crew and buy a drain-camera rig" },
] as const;

const DAY = 86_400_000;
const at = (now: Date, daysAgo: number, hour = 10) => {
  const d = new Date(+now - daysAgo * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

export async function createDemoBusiness({ repos, config }: Pick<Deps, "repos" | "config">, now = new Date()) {
  const suffix = randomBytes(4).toString("hex").slice(0, 6);
  const apiKey = generateApiKey();
  const tenant: Tenant = await repos.tenants.create({
    name: "Maple Street Plumbing",
    subdomain: `demo-${suffix}`,
    taxRateBps: 875,
    priceList: DEMO_PRICE_LIST,
    ownerEmail: "owner@maplestreet.example",
    apiKeyHash: hashApiKey(apiKey),
    demo: { expiresAt: new Date(+now + (config.demo?.ttlDays ?? 3) * DAY) },
  });

  const price = new Map(DEMO_PRICE_LIST.map((p) => [p.sku, p]));
  for (const job of JOBS) {
    const created = at(now, job.daysAgo, 9 + (job.daysAgo % 8));
    const customer = await repos.customers.upsertByContact(tenant.id, { name: job.name, phone: job.phone, email: job.email });
    const lead = await repos.leads.create({
      tenantId: tenant.id,
      name: job.name,
      ...(job.phone ? { phone: job.phone } : {}),
      ...(job.email ? { email: job.email } : {}),
      message: job.message,
      source: job.source,
      customerId: customer.id,
      createdAt: created,
    });
    if (job.outcome === "none") continue;

    const lineItems: LineItem[] = job.lines.map(([sku, quantity]) => {
      const p = price.get(sku)!;
      return { sku, description: p.name, quantity, unitPriceCents: p.unitPriceCents, ...(p.fractional ? { fractional: true } : {}) };
    });
    const estimateStatus = ({ paid: "invoiced", open: "invoiced", sent: "sent", declined: "declined", draft: "draft" } as const)[job.outcome];
    const estimate = await repos.estimates.create({
      tenantId: tenant.id,
      leadId: lead.id,
      customer: contactOf(lead),
      lineItems,
      taxRateBps: tenant.taxRateBps,
      status: estimateStatus,
      createdAt: new Date(+created + 3 * 3_600_000),
    });
    if (job.outcome !== "paid" && job.outcome !== "open") continue;

    const issued = new Date(+created + DAY);
    await repos.invoices.create({
      tenantId: tenant.id,
      estimateId: estimate.id,
      number: await repos.invoices.nextNumber(tenant.id),
      billTo: estimate.customer!,
      lineItems,
      taxRateBps: tenant.taxRateBps,
      totals: computeTotals(lineItems, tenant.taxRateBps),
      status: job.outcome === "paid" ? "paid" : "open",
      ...(job.outcome === "paid" ? { paidAt: new Date(+issued + (job.paidAfterDays ?? 3) * DAY) } : {}),
      createdAt: issued,
    });
  }

  // Funding: real statements from the synthetic fixtures, run through the same engine as uploads.
  for (const f of FUNDING) {
    const p = PROFILES.find((x) => x.key === f.profile)!;
    const app = await createApplication(repos, tenant, {
      industry: "plumbing",
      monthsInBusiness: p.monthsInBusiness,
      statedMonthlyRevenueCents: p.statedMonthlyRevenueCents,
      amountRequestedCents: f.amountRequestedCents,
      useOfFunds: f.useOfFunds,
    });
    await ingestStatement(repos, tenant.id, app.id, toCsv(p, generateStatement(p)));
    await assessApplication(repos, tenant.id, app.id); // no emails for seeded history
  }

  return { tenant, apiKey };
}

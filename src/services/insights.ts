import type { Id } from "../domain";
import type { Repos } from "../repos/types";

const SENT = new Set(["sent", "accepted", "declined", "invoiced"]);
const WON = new Set(["accepted", "invoiced"]);
const DAY = 86_400_000;

/**
 * What happens after "payment recorded": the pipeline's history, read back as numbers
 * an owner can act on. Computed on read (fine at small-business scale; a large tenant
 * would get these from a Mongo aggregation or a nightly rollup).
 */
export async function insights(repos: Repos, tenantId: Id, now = new Date()) {
  const [leads, estimates, invoices, customers] = await Promise.all([
    repos.leads.listByTenant(tenantId, { limit: 5000 }),
    repos.estimates.listByTenant(tenantId, { limit: 5000 }),
    repos.invoices.listByTenant(tenantId, { limit: 5000 }),
    repos.customers.listByTenant(tenantId, { limit: 5000 }),
  ]);
  const paid = invoices.filter((i) => i.status === "paid" && i.paidAt);
  const funnel = {
    leads: leads.length,
    estimatesSent: estimates.filter((e) => SENT.has(e.status)).length,
    accepted: estimates.filter((e) => WON.has(e.status)).length,
    paid: paid.length,
  };
  const rate = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

  const months: { month: string; revenueCents: number; invoices: number }[] = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    months.push({ month: d.toISOString().slice(0, 7), revenueCents: 0, invoices: 0 });
  }
  for (const i of paid) {
    const m = months.find((x) => x.month === new Date(i.paidAt!).toISOString().slice(0, 7));
    if (m) {
      m.revenueCents += i.totals.totalCents;
      m.invoices++;
    }
  }
  const revenue = paid.reduce((s, i) => s + i.totals.totalCents, 0);
  const daysToPay = paid.map((i) => (new Date(i.paidAt!).getTime() - new Date(i.createdAt).getTime()) / DAY);
  const open = invoices.filter((i) => i.status === "open");

  return {
    funnel,
    conversion: {
      leadToEstimatePercent: rate(funnel.estimatesSent, funnel.leads),
      estimateToAcceptedPercent: rate(funnel.accepted, funnel.estimatesSent),
      acceptedToPaidPercent: rate(funnel.paid, funnel.accepted),
    },
    revenue: {
      paidCents: revenue,
      averageJobCents: paid.length ? Math.round(revenue / paid.length) : null,
      averageDaysToPay: daysToPay.length ? Math.round((daysToPay.reduce((a, b) => a + b, 0) / daysToPay.length) * 10) / 10 : null,
      outstandingCents: open.reduce((s, i) => s + i.totals.totalCents, 0),
      outstandingInvoices: open.length,
      byMonth: months,
    },
    customers: { total: customers.length, returning: customers.filter((c) => c.leadCount > 1).length },
    leadsBySource: { web: leads.filter((l) => l.source === "web").length, sms: leads.filter((l) => l.source === "sms").length },
  };
}

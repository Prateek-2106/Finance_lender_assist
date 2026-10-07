// The records behind each number on the Statistics page: click "Gross income in September" and
// see the invoices (and the services on them) that add up to it. Same filters as insights.ts.
import type { Customer, Estimate, Id, Invoice, Lead } from "../domain";
import type { Repos } from "../repos/types";
import { ValidationError } from "../errors";
import { lineTotalCents } from "../lib/money";
import { daysToPay, monthOf, SENT, WON } from "./insights";

export const SOURCE_KINDS = ["paid", "unpaid", "requests", "quoted", "accepted", "customers"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface SourceQuery {
  kind: SourceKind;
  month?: string; // "2026-09": paid invoices only
  source?: "web" | "sms"; // requests only
  returning?: boolean; // customers only
}

const invoiceRow = (i: Invoice) => ({
  id: i.id,
  number: i.number,
  estimateId: i.estimateId,
  customer: i.billTo?.name ?? null,
  items: i.lineItems.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, amountCents: lineTotalCents(l) })),
  subtotalCents: i.totals.subtotalCents,
  taxCents: i.totals.taxCents,
  totalCents: i.totals.totalCents,
  issuedAt: i.createdAt,
  paidAt: i.paidAt ?? null,
  daysToPay: i.paidAt ? daysToPay(i) : null,
});
const estimateRow = (e: Estimate, total: number) => ({ id: e.id, customer: e.customer?.name ?? null, status: e.status, totalCents: total, createdAt: e.createdAt, leadId: e.leadId ?? null });
const requestRow = (l: Lead, estimateId: Id | null) => ({ id: l.id, name: l.name, contact: l.phone ?? l.email ?? null, message: l.message, source: l.source, createdAt: l.createdAt, estimateId });
const customerRow = (c: Customer) => ({ id: c.id, name: c.name, contact: c.phone ?? c.email ?? null, requests: c.leadCount, lastSeenAt: c.lastSeenAt });

export type SourceRows =
  | { kind: "paid" | "unpaid"; invoices: ReturnType<typeof invoiceRow>[]; services: { description: string; quantity: number; amountCents: number }[] }
  | { kind: "quoted" | "accepted"; estimates: ReturnType<typeof estimateRow>[] }
  | { kind: "requests"; requests: ReturnType<typeof requestRow>[] }
  | { kind: "customers"; customers: ReturnType<typeof customerRow>[] };

export async function insightSources(repos: Repos, tenantId: Id, q: SourceQuery): Promise<SourceRows> {
  if (q.month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month)) throw new ValidationError("month must look like 2026-09");
  const all = { limit: 5000 };
  switch (q.kind) {
    case "paid":
    case "unpaid": {
      const invoices = (await repos.invoices.listByTenant(tenantId, all))
        .filter((i) => (q.kind === "paid" ? i.status === "paid" && i.paidAt : i.status === "open"))
        .filter((i) => !q.month || monthOf(i.paidAt!) === q.month)
        .sort((a, b) => +new Date(b.paidAt ?? b.createdAt) - +new Date(a.paidAt ?? a.createdAt));
      // What the money was for: every service and item on those invoices, added up, biggest first
      const services = new Map<string, { description: string; quantity: number; amountCents: number }>();
      for (const i of invoices)
        for (const l of i.lineItems) {
          const s = services.get(l.description) ?? { description: l.description, quantity: 0, amountCents: 0 };
          s.quantity = Math.round((s.quantity + l.quantity) * 100) / 100;
          s.amountCents += lineTotalCents(l);
          services.set(l.description, s);
        }
      return { kind: q.kind, invoices: invoices.map(invoiceRow), services: [...services.values()].sort((a, b) => b.amountCents - a.amountCents) };
    }
    case "quoted":
    case "accepted": {
      const estimates = await repos.estimates.listByTenant(tenantId, all);
      const want = q.kind === "quoted" ? SENT : WON;
      const beforeTax = (e: Estimate) => e.lineItems.reduce((s, l) => s + lineTotalCents(l), 0);
      return { kind: q.kind, estimates: estimates.filter((e) => want.has(e.status)).map((e) => estimateRow(e, beforeTax(e))) };
    }
    case "requests": {
      const [leads, estimates] = await Promise.all([repos.leads.listByTenant(tenantId, all), repos.estimates.listByTenant(tenantId, all)]);
      const latest = new Map<Id, Id>();
      for (const e of estimates) if (e.leadId && !latest.has(e.leadId)) latest.set(e.leadId, e.id); // newest first
      return { kind: "requests", requests: leads.filter((l) => !q.source || l.source === q.source).map((l) => requestRow(l, latest.get(l.id) ?? null)) };
    }
    case "customers": {
      const customers = await repos.customers.listByTenant(tenantId, all);
      return { kind: "customers", customers: customers.filter((c) => !q.returning || c.leadCount > 1).map(customerRow) };
    }
  }
}

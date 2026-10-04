import { Router, type RequestHandler } from "express";
import { rateLimit } from "../lib/rateLimit";
import { spendAiBudget } from "../services/aiBudget";
import { z } from "zod";
import type { Deps } from "../deps";
import { InvalidTransitionError, NotFoundError, ServiceUnavailableError } from "../errors";
import { draftEstimate } from "../ai/estimateDrafter";
import { contactOf, createEstimate } from "../services/billing";
import type { Estimate } from "../domain";
import type { Notifier } from "../notify/notifier";
import { computeTotals } from "../lib/money";
import { getTenant, requireApiKey } from "../middleware/tenant";
import { LeadCreateSchema, parseOrThrow, PriceListSchema } from "../schemas";

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

export function leadsRouter(deps: Deps, notifier: Notifier) {
  const { repos, llm, config } = deps;
  const r = Router();
  // The contact form is public: limit it per visitor so nobody floods a business's inbox.
  const leadLimit: RequestHandler = config.rateLimits
    ? rateLimit({ name: "lead", max: config.rateLimits.leadsPerHour, windowMs: 3_600_000, message: "Too many requests from your network. Please call the business instead." })
    : (_req, _res, next) => next();
  // Two clicks at once on one lead share one model call (per server process; the
  // open-estimate check below covers clicks that arrive after the first finished).
  const inFlight = new Map<string, Promise<Estimate>>();

  // Public: what a tenant's website needs to render itself.
  r.get("/site", (_req, res) => {
    const t = getTenant(res);
    res.json({ site: { name: t.name, subdomain: t.subdomain } });
  });

  r.post("/leads", leadLimit, async (req, res) => {
    const input = parseOrThrow(LeadCreateSchema, req.body);
    const tenantId = getTenant(res).id;
    const customer = await repos.customers.upsertByContact(tenantId, contactOf(input));
    const lead = await repos.leads.create({ ...input, tenantId, source: "web", customerId: customer.id });
    void notifier.leadReceived(getTenant(res), lead);
    res.status(201).json({ lead });
  });

  r.get("/leads", requireApiKey, async (req, res) => {
    const { limit } = parseOrThrow(ListQuery, req.query);
    res.json({ leads: await repos.leads.listByTenant(getTenant(res).id, { limit }) });
  });

  r.get("/leads/:id", requireApiKey, async (req, res) => {
    const lead = await repos.leads.findById(getTenant(res).id, String(req.params.id));
    if (!lead) throw new NotFoundError("Lead not found");
    res.json({ lead });
  });

  r.put("/price-list", requireApiKey, async (req, res) => {
    const priceList = parseOrThrow(PriceListSchema, req.body);
    const t = await repos.tenants.update(getTenant(res).id, { priceList });
    res.json({ priceList: t.priceList });
  });

  r.post("/leads/:id/draft-estimate", requireApiKey, async (req, res) => {
    if (!llm) throw new ServiceUnavailableError("No language model configured (set LLM_PROVIDER)");
    const tenant = getTenant(res);
    if (tenant.priceList.length === 0) throw new InvalidTransitionError("Add a price list first (PUT /api/price-list)");
    const lead = await repos.leads.findById(tenant.id, String(req.params.id));
    if (!lead) throw new NotFoundError("Lead not found");

    // Idempotent: a lead with an estimate still being worked on gets that one back.
    const existing = await repos.estimates.findOpenByLead(tenant.id, lead.id);
    if (existing) {
      res.status(200).json({ estimate: { ...existing, totals: computeTotals(existing.lineItems, existing.taxRateBps) } });
      return;
    }
    const key = `${tenant.id}:${lead.id}`;
    let job = inFlight.get(key);
    const first = !job;
    if (!job) {
      job = (async () => {
        await spendAiBudget(deps, tenant.id);
        const draft = await draftEstimate(llm, tenant.priceList, lead);
        return createEstimate(repos, tenant, {
          leadId: lead.id,
          lineItems: draft.lineItems,
          status: "needs_review", // a person approves before anything reaches the customer
          ...(draft.questions.length ? { notes: `Questions for the customer:\n- ${draft.questions.join("\n- ")}` } : {}),
          aiDraft: { model: draft.model, questions: draft.questions, rejected: draft.rejected },
        });
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, job);
    }
    const estimate = await job;
    res.status(first ? 201 : 200).json({ estimate: { ...estimate, totals: computeTotals(estimate.lineItems, estimate.taxRateBps) } });
  });

  return r;
}

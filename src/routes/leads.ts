import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { InvalidTransitionError, NotFoundError, ServiceUnavailableError } from "../errors";
import { draftEstimate } from "../ai/estimateDrafter";
import { createEstimate } from "../services/billing";
import { computeTotals } from "../lib/money";
import { getTenant, requireApiKey } from "../middleware/tenant";
import { LeadCreateSchema, parseOrThrow, PriceListSchema } from "../schemas";

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

export function leadsRouter({ repos, llm }: Deps) {
  const r = Router();

  // Public: what a tenant's website needs to render itself.
  r.get("/site", (_req, res) => {
    const t = getTenant(res);
    res.json({ site: { name: t.name, subdomain: t.subdomain } });
  });

  r.post("/leads", async (req, res) => {
    const input = parseOrThrow(LeadCreateSchema, req.body);
    const lead = await repos.leads.create({ ...input, tenantId: getTenant(res).id, source: "web" });
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

    const draft = await draftEstimate(llm, tenant.priceList, lead);
    const estimate = await createEstimate(repos, tenant, {
      leadId: lead.id,
      lineItems: draft.lineItems,
      status: "needs_review", // a person approves before anything reaches the customer
      ...(draft.questions.length ? { notes: `Questions for the customer:\n- ${draft.questions.join("\n- ")}` } : {}),
      aiDraft: { model: draft.model, questions: draft.questions, rejected: draft.rejected },
    });
    res.status(201).json({ estimate: { ...estimate, totals: computeTotals(estimate.lineItems, estimate.taxRateBps) } });
  });

  return r;
}

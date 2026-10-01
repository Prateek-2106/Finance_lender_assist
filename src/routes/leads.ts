import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { NotFoundError } from "../errors";
import { getTenant, requireApiKey } from "../middleware/tenant";
import { LeadCreateSchema, parseOrThrow } from "../schemas";

const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

export function leadsRouter({ repos }: Deps) {
  const r = Router();

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

  return r;
}

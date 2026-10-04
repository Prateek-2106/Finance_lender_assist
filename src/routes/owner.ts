import { Router } from "express";
import type { Deps } from "../deps";
import { getTenant, requireApiKey } from "../middleware/tenant";
import { parseOrThrow, SettingsSchema } from "../schemas";
import { insights } from "../services/insights";

/** The owner's view of their own business: settings, who they've emailed, customers, and how the pipeline is doing. */
export function ownerRouter({ repos }: Deps) {
  const r = Router();
  r.use(["/settings", "/messages", "/customers", "/insights"], requireApiKey);

  r.get("/settings", (_req, res) => {
    const t = getTenant(res);
    res.json({ settings: { name: t.name, ownerEmail: t.ownerEmail ?? null } });
  });
  r.patch("/settings", async (req, res) => {
    const { ownerEmail } = parseOrThrow(SettingsSchema, req.body);
    const t = await repos.tenants.update(getTenant(res).id, { ownerEmail });
    res.json({ settings: { name: t.name, ownerEmail: t.ownerEmail ?? null } });
  });
  r.get("/messages", async (_req, res) => {
    res.json({ messages: await repos.messages.listByTenant(getTenant(res).id, { limit: 100 }) });
  });
  r.get("/customers", async (_req, res) => {
    res.json({ customers: await repos.customers.listByTenant(getTenant(res).id, { limit: 200 }) });
  });
  r.get("/insights", async (_req, res) => {
    res.json({ insights: await insights(repos, getTenant(res).id) });
  });
  return r;
}

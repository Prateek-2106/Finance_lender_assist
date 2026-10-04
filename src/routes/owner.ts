import { Router } from "express";
import type { Deps } from "../deps";
import { NotFoundError } from "../errors";
import { getTenant, requireApiKey } from "../middleware/tenant";
import { parseOrThrow, SettingsSchema } from "../schemas";
import { insights } from "../services/insights";

/** The owner's view of their own business: settings, who they've emailed, customers, and how the pipeline is doing. */
export function ownerRouter({ repos }: Deps) {
  const r = Router();
  r.use(["/settings", "/messages", "/messages/:id", "/customers", "/insights"], requireApiKey);

  r.get("/settings", (_req, res) => {
    const t = getTenant(res);
    res.json({ settings: { name: t.name, ownerEmail: t.ownerEmail ?? null, demo: t.demo ?? null } });
  });
  r.patch("/settings", async (req, res) => {
    const { ownerEmail } = parseOrThrow(SettingsSchema, req.body);
    const t = await repos.tenants.update(getTenant(res).id, { ownerEmail });
    res.json({ settings: { name: t.name, ownerEmail: t.ownerEmail ?? null } });
  });
  r.get("/messages", async (_req, res) => {
    const list = await repos.messages.listByTenant(getTenant(res).id, { limit: 100 });
    res.json({ messages: list.map(({ preview, ...m }) => ({ ...m, hasPreview: !!preview })) });
  });
  // Demo businesses: the email as it would have looked. The page shows it in a sandboxed iframe.
  r.get("/messages/:id", async (req, res) => {
    const m = await repos.messages.findById(getTenant(res).id, String(req.params.id));
    if (!m) throw new NotFoundError("Message not found");
    res.json({ message: m });
  });
  r.get("/customers", async (_req, res) => {
    res.json({ customers: await repos.customers.listByTenant(getTenant(res).id, { limit: 200 }) });
  });
  r.get("/insights", async (_req, res) => {
    res.json({ insights: await insights(repos, getTenant(res).id) });
  });
  return r;
}

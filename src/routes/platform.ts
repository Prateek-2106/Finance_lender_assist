import { Router, type RequestHandler } from "express";
import type { Deps } from "../deps";
import { NotFoundError } from "../errors";
import { rateLimit } from "../lib/rateLimit";
import { tenantUrl } from "../notify/notifier";
import { createDemoBusiness } from "../services/demo";
import { demoCounterKey } from "./admin";

/** What the homepage needs, and the "Try it" button. No tenant: these live on the apex domain. */
export function platformRouter(deps: Deps) {
  const { config } = deps;
  const r = Router();

  r.get("/platform", (_req, res) => {
    res.json({
      platform: {
        baseDomain: config.baseDomain,
        signupOpen: config.openSignup !== false,
        demo: config.demo?.enabled ? { ttlDays: config.demo.ttlDays, underwriterKey: config.demo.underwriterKey ?? null } : null,
        aiEnabled: !!deps.llm,
        author: config.site?.author ?? null,
        repoUrl: config.site?.repoUrl ?? null,
      },
    });
  });

  const demoLimit: RequestHandler = config.rateLimits
    ? rateLimit({ name: "demo", max: config.rateLimits.demosPerHour, windowMs: 3_600_000, message: "You've started a few demos already. Use one of those, or try again in an hour." })
    : (_req, _res, next) => next();

  r.post("/demo", demoLimit, async (_req, res) => {
    if (!config.demo?.enabled) throw new NotFoundError("Demos are turned off on this server");
    const { tenant, apiKey } = await createDemoBusiness(deps);
    await deps.repos.usage.increment(demoCounterKey(new Date().toISOString().slice(0, 10))); // for /admin
    // The key travels in the URL fragment, which browsers never send to servers or put in logs;
    // the dashboard stores it for this tab and removes it from the address bar.
    res.status(201).json({
      subdomain: tenant.subdomain,
      expiresAt: tenant.demo!.expiresAt,
      apiKey,
      siteUrl: tenantUrl(config, tenant, "/"),
      dashboardUrl: tenantUrl(config, tenant, `/app#key=${apiKey}`),
    });
  });

  return r;
}

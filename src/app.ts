// Wires every module's router together. Read it to see the request flow.
import express from "express";
import type { Deps } from "./deps";
import { tenantsRouter } from "./routes/tenants"; // step 2
import { errorHandler, notFoundHandler } from "./http/errorHandler"; // step 2
import { resolveTenant } from "./middleware/tenant"; // step 2
import { leadsRouter } from "./routes/leads"; // step 2
import { webhooksRouter } from "./routes/webhooks"; // step 4
import { estimatesRouter } from "./routes/estimates"; // steps 5 and 8
import { domainsRouter } from "./routes/domains"; // step 10
import { applicationsRouter } from "./routes/applications"; // steps 6–7

export function createApp(deps: Deps) {
  const app = express();
  app.set("trust proxy", true); // behind ALB/CloudFront in prod (step 10)
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Platform-level routes (no tenant from the Host header)
  app.use("/api/tenants", tenantsRouter(deps));
  app.use("/webhooks", webhooksRouter(deps));

  // Everything below is tenant-scoped: the tenant comes from the Host header
  app.use("/api", resolveTenant(deps), leadsRouter(deps), estimatesRouter(deps), applicationsRouter(deps), domainsRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

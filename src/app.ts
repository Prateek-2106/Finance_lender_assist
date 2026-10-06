// Wires every module's router together. Read it to see the request flow.
import express from "express";
import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import type { Deps } from "./deps";
import { tenantsRouter } from "./routes/tenants"; // step 2
import { errorHandler, notFoundHandler } from "./http/errorHandler"; // step 2
import { resolveTenant } from "./middleware/tenant"; // step 2
import { leadsRouter } from "./routes/leads"; // step 2
import { webhooksRouter } from "./routes/webhooks"; // step 4
import { estimatesRouter } from "./routes/estimates"; // steps 5 and 8
import { domainsRouter } from "./routes/domains"; // step 10
import { applicationsRouter } from "./routes/applications"; // steps 6–7
import { underwritingRouter } from "./routes/underwriting"; // step 11
import { ownerRouter } from "./routes/owner"; // step 11
import { Notifier } from "./notify/notifier"; // step 11
import { platformRouter } from "./routes/platform"; // step 12

export function createApp(deps: Deps) {
  const app = express();
  const notifier = new Notifier(deps.repos, deps.config, deps.mailer);
  app.locals.notifier = notifier; // tests await notifier.idle() before checking emails
  // How many proxies sit in front of us (CloudFront = 1, CloudFront + ALB = 2). A count, never `true`:
  // with `true`, req.ip is whatever the visitor writes in X-Forwarded-For, and rate limits mean nothing.
  app.set("trust proxy", deps.config.trustProxyHops ?? 0);
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Behind CloudFront: only requests carrying CloudFront's secret header get in, so nobody can skip the CDN
  // (and its TLS) by calling the server's address directly. /health above stays open for the container check.
  const originSecret = deps.config.originSecret;
  if (originSecret)
    app.use((req, res, next) => {
      const got = req.get("x-origin-verify") ?? "";
      if (got.length === originSecret.length && timingSafeEqual(Buffer.from(got), Buffer.from(originSecret))) return next();
      res.status(403).json({ error: "Direct access is not allowed" });
    });

  // Platform-level routes (no tenant from the Host header)
  app.use("/api/tenants", tenantsRouter(deps));
  app.use("/api", platformRouter(deps)); // /api/platform, /api/demo (step 12)
  app.use("/webhooks", webhooksRouter(deps, notifier));
  app.use("/api/underwriting", underwritingRouter(deps, notifier)); // OPF-side staff, across all businesses

  // Everything below is tenant-scoped: the tenant comes from the Host header
  app.use(
    "/api",
    resolveTenant(deps),
    leadsRouter(deps, notifier),
    estimatesRouter(deps, notifier),
    applicationsRouter(deps, notifier),
    domainsRouter(deps),
    ownerRouter(deps),
  );

  // The built React app (npm run web:build): "/" is the tenant's website, "/app" the owner dashboard.
  const webDir = resolve(process.cwd(), "dist/web");
  if (existsSync(webDir)) {
    // Vite puts a content hash in every file name under /assets, so those can be cached for a year.
    app.use("/assets", express.static(resolve(webDir, "assets"), { immutable: true, maxAge: "365d", fallthrough: false }));
    app.use(express.static(webDir, { index: false }));
    app.get(/^\/((app|underwriting|scoring)(\/.*)?)?$/, (_req, res) => res.sendFile(resolve(webDir, "index.html")));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

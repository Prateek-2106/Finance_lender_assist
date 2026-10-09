// Local entry point: `npm run dev`
import { MongoClient } from "mongodb";
import { createApp } from "./app";
import { createMemoryRepos } from "./repos/memory";
import { createMongoRepos } from "./repos/mongo";
import { llmFromEnv } from "./ai/providers";
import { Resolver } from "node:dns/promises";
import { mailerFromEnv } from "./notify/mailer";
import { parseUnderwriters } from "./middleware/underwriter";
import { hashApiKey } from "./lib/apiKey";
import { scheduleDemoCleanup } from "./services/demoCleanup";
import { emfMetrics, flushPeriodically } from "./telemetry/metrics";
import { Health } from "./telemetry/health";
import { Prometheus } from "./telemetry/prometheus";

const PORT = Number(process.env.PORT ?? 3000);
const MONGO_URL = process.env.MONGO_URL;

async function main() {
  const repos = MONGO_URL
    ? await createMongoRepos((await MongoClient.connect(MONGO_URL)).db())
    : createMemoryRepos();

  const llm = llmFromEnv(process.env);
  const mailer = await mailerFromEnv(process.env);
  // Underwriters: "Full Name=key;Other Name=key2". Outside production a demo underwriter exists by default.
  const DEV_UNDERWRITER = "Priya Shah=uw_dev_priya_0001";
  const underwriterSpec = process.env.UNDERWRITERS ?? (process.env.NODE_ENV === "production" ? "" : DEV_UNDERWRITER);
  const underwriters = parseUnderwriters(underwriterSpec);
  const env = process.env;
  const prod = env.NODE_ENV === "production";
  const flag = (v: string | undefined, dflt: boolean) => (v === undefined ? dflt : v === "true" || v === "1");
  const int = (v: string | undefined, dflt: number) => (v && Number.isFinite(Number(v)) ? Number(v) : dflt);

  // Demos ("Try it" on the homepage): on by default; the public underwriter key only sees demo businesses.
  const demoEnabled = flag(env.DEMO_ENABLED, true);
  const demoUnderwriterKey = env.DEMO_UNDERWRITER_KEY ?? (prod ? undefined : "uw_demo_public_0001");
  if (demoEnabled && demoUnderwriterKey) underwriters.push({ ...parseUnderwriters(`Demo underwriter=${demoUnderwriterKey}`)[0]!, demoOnly: true });
  const openSignup = flag(env.OPEN_SIGNUP, !prod); // production: only the admin creates real businesses
  if (!openSignup && !env.ADMIN_TOKEN) console.warn("OPEN_SIGNUP is off and ADMIN_TOKEN is unset: nobody can create a real business");
  // Metrics: EMF lines on stdout, which CloudWatch turns into metrics (production default). METRICS=off to disable.
  const metricsOn = (env.METRICS ?? (prod ? "emf" : "off")) === "emf";
  const metrics = metricsOn ? emfMetrics() : undefined;
  if (metrics) flushPeriodically(metrics);
  const region = env.AWS_REGION ?? "us-east-1";
  // The System health page: live timings, plus CPU, memory and event-loop delay sampled each minute
  const health = new Health(Date.now, env.METRICS_TOKEN ? new Prometheus() : undefined);
  health.startVitals();
  const app = createApp({
    repos,
    llm,
    mailer,
    metrics,
    health,
    dns: new Resolver({ timeout: 5000, tries: 2 }),
    config: {
      baseDomain: process.env.BASE_DOMAIN ?? "lvh.me",
      publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${PORT}`,
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
      underwriters,
      openSignup,
      ...(env.ADMIN_TOKEN ? { adminTokenHash: hashApiKey(env.ADMIN_TOKEN) } : {}),
      demo: { enabled: demoEnabled, ttlDays: int(env.DEMO_TTL_DAYS, 3), ...(demoUnderwriterKey ? { underwriterKey: demoUnderwriterKey } : {}) },
      aiDailyLimit: { global: int(env.AI_DAILY_LIMIT, 300), perBusiness: int(env.AI_DAILY_LIMIT_PER_BUSINESS, 25) },
      ...(prod || env.RATE_LIMITS === "on" ? { rateLimits: { leadsPerHour: int(env.LEADS_PER_HOUR, 30), demosPerHour: int(env.DEMOS_PER_HOUR, 5), signInsPerHour: int(env.SIGN_INS_PER_HOUR, 30) } } : {}),
      ...(env.ORIGIN_SECRET ? { originSecret: env.ORIGIN_SECRET } : {}),
      production: prod,
      trustProxyHops: int(env.TRUST_PROXY_HOPS, prod ? 1 : 0),
      ...(env.METRICS_TOKEN ? { metricsToken: env.METRICS_TOKEN } : {}),
      adminEmails: (env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
      ...(env.DASHBOARD_URL || prod
        ? { dashboardUrl: env.DASHBOARD_URL ?? `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#dashboards/dashboard/VendorStreet` }
        : {}),
      site: { author: env.SITE_AUTHOR ?? "Prateek Ghosh", ...(env.SITE_REPO_URL ? { repoUrl: env.SITE_REPO_URL } : {}) },
    },
  });

  if (demoEnabled) scheduleDemoCleanup(repos);

  app.listen(PORT, () => {
    console.log(`vendorstreet on http://localhost:${PORT} (${MONGO_URL ? "MongoDB" : "in-memory store"})`);
    console.log(`tenant sites: http://<subdomain>.lvh.me:${PORT}`);
    console.log(`language model: ${llm?.model ?? "none"}`);
    console.log(`email: ${mailer?.name ?? "off"}${mailer?.name.startsWith("smtp localhost") ? "  (inbox: http://localhost:8025)" : ""}`);
    console.log(`metrics: ${metricsOn ? "CloudWatch (EMF on stdout)" : "off"}`);
    console.log(`homepage: http://localhost:${PORT}  (sign-up ${openSignup ? "open" : "closed"}, demos ${demoEnabled ? "on" : "off"})`);
    if (underwriterSpec === DEV_UNDERWRITER) console.log(`underwriter console: http://localhost:${PORT}/underwriting  (demo key: uw_dev_priya_0001)`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

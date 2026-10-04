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
  const app = createApp({
    repos,
    llm,
    mailer,
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
      ...(prod || env.RATE_LIMITS === "on" ? { rateLimits: { leadsPerHour: int(env.LEADS_PER_HOUR, 30), demosPerHour: int(env.DEMOS_PER_HOUR, 5) } } : {}),
      trustProxyHops: int(env.TRUST_PROXY_HOPS, prod ? 1 : 0),
      site: { author: env.SITE_AUTHOR ?? "Prateek Ghosh", ...(env.SITE_REPO_URL ? { repoUrl: env.SITE_REPO_URL } : {}) },
    },
  });

  app.listen(PORT, () => {
    console.log(`mainstreet on http://localhost:${PORT} (${MONGO_URL ? "MongoDB" : "in-memory store"})`);
    console.log(`tenant sites: http://<subdomain>.lvh.me:${PORT}`);
    console.log(`language model: ${llm?.model ?? "none"}`);
    console.log(`email: ${mailer?.name ?? "off"}${mailer?.name.startsWith("smtp localhost") ? "  (inbox: http://localhost:8025)" : ""}`);
    console.log(`homepage: http://localhost:${PORT}  (sign-up ${openSignup ? "open" : "closed"}, demos ${demoEnabled ? "on" : "off"})`);
    if (underwriterSpec === DEV_UNDERWRITER) console.log(`underwriter console: http://localhost:${PORT}/underwriting  (demo key: uw_dev_priya_0001)`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

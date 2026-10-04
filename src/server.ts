// Local entry point: `npm run dev`
import { MongoClient } from "mongodb";
import { createApp } from "./app";
import { createMemoryRepos } from "./repos/memory";
import { createMongoRepos } from "./repos/mongo";
import { llmFromEnv } from "./ai/providers";
import { Resolver } from "node:dns/promises";
import { mailerFromEnv } from "./notify/mailer";
import { parseUnderwriters } from "./middleware/underwriter";

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
    },
  });

  app.listen(PORT, () => {
    console.log(`mainstreet on http://localhost:${PORT} (${MONGO_URL ? "MongoDB" : "in-memory store"})`);
    console.log(`tenant sites: http://<subdomain>.lvh.me:${PORT}`);
    console.log(`language model: ${llm?.model ?? "none"}`);
    console.log(`email: ${mailer?.name ?? "off"}${mailer?.name.startsWith("smtp localhost") ? "  (inbox: http://localhost:8025)" : ""}`);
    if (underwriterSpec === DEV_UNDERWRITER) console.log(`underwriter console: http://localhost:${PORT}/underwriting  (demo key: uw_dev_priya_0001)`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

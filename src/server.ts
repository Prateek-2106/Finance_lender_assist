// Local entry point: `npm run dev`
import { MongoClient } from "mongodb";
import { createApp } from "./app";
import { createMemoryRepos } from "./repos/memory";
import { createMongoRepos } from "./repos/mongo";
import { llmFromEnv } from "./ai/providers";
import { Resolver } from "node:dns/promises";

const PORT = Number(process.env.PORT ?? 3000);
const MONGO_URL = process.env.MONGO_URL;

async function main() {
  const repos = MONGO_URL
    ? await createMongoRepos((await MongoClient.connect(MONGO_URL)).db())
    : createMemoryRepos();

  const llm = llmFromEnv(process.env);
  const app = createApp({
    repos,
    llm,
    dns: new Resolver({ timeout: 5000, tries: 2 }),
    config: {
      baseDomain: process.env.BASE_DOMAIN ?? "lvh.me",
      publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${PORT}`,
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    },
  });

  app.listen(PORT, () => {
    console.log(`mainstreet on http://localhost:${PORT} (${MONGO_URL ? "MongoDB" : "in-memory store"})`);
    console.log(`tenant sites: http://<subdomain>.lvh.me:${PORT}`);
    console.log(`language model: ${llm?.model ?? "none"}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

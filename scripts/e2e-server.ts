// A seeded server for Playwright: in-memory store, a known API key, a scripted model.
// Deterministic, offline, and safe to run anywhere (CI included).
import { createApp } from "../src/app";
import { createMemoryRepos } from "../src/repos/memory";
import { hashApiKey } from "../src/lib/apiKey";
import type { LlmClient } from "../src/deps";

export const E2E_KEY = "sk_e2e_dashboard_key_0000000000000000";
const PORT = Number(process.env.E2E_PORT ?? 3100);

// Answers by task: the memo prompt mentions underwriting, the drafter prompt has a price list.
const llm: LlmClient = {
  model: "scripted/e2e",
  async complete({ system }) {
    if (system.includes("underwriting"))
      return JSON.stringify({
        summary: { text: "Review: existing lender payments already exceed 15% of daily revenue.", cites: ["K1"] },
        strengths: [{ text: "Revenue is steady, with volatility of 0.06.", cites: ["M3"] }],
        risks: [
          { text: "Existing lender payments take 22.2% of revenue.", cites: ["M7"] },
          { text: "The owner has filed for bankruptcy before.", cites: ["M9"] },
        ],
        recommendation: "review",
      });
    return JSON.stringify({
      lineItems: [{ sku: "WH-FLUSH", quantity: 1 }, { sku: "TPR-VALVE", quantity: 1 }, { sku: "GOLD-PLATING", quantity: 3 }],
      questions: ["How old is the water heater?"],
    });
  },
};

const repos = createMemoryRepos();
await repos.tenants.create({
  name: "Joe's Plumbing",
  subdomain: "joes-plumbing",
  taxRateBps: 875,
  apiKeyHash: hashApiKey(E2E_KEY),
  priceList: [
    { sku: "WH-FLUSH", name: "Water heater flush", unitPriceCents: 12900 },
    { sku: "TPR-VALVE", name: "Pressure relief valve", unitPriceCents: 4500 },
    { sku: "LABOR", name: "Labor", unitPriceCents: 9500, unit: "hour" },
  ],
});

createApp({ repos, llm, config: { baseDomain: "lvh.me", publicUrl: `http://localhost:${PORT}`, twilioAuthToken: "e2e" } }).listen(PORT, () =>
  console.log(`e2e server on ${PORT}`),
);

// Wraps the language model so every call is timed, counted and priced, whoever makes it.
import type { LlmClient, LlmUsage } from "../deps";
import type { Repos } from "../repos/types";
import type { Metrics } from "./metrics";

/** Dollars per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing (Oct 2026). */
export const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /haiku-4-5/, input: 1, output: 5 },
  { match: /sonnet-5-5|sonnet-5\b/, input: 2, output: 10 },
  { match: /sonnet-4/, input: 3, output: 15 },
  { match: /opus-5-5/, input: 4, output: 20 },
  { match: /opus/, input: 5, output: 25 },
  { match: /^ollama\//, input: 0, output: 0 }, // runs on your own machine
];

export type Price = { input: number; output: number };

/** The price for a model id like "anthropic/claude-haiku-4-5-20251001". Unknown models use `fallback`. */
export function priceFor(model: string, fallback: Price = { input: 5, output: 25 }): Price {
  const p = PRICES.find((x) => x.match.test(model));
  return p ? { input: p.input, output: p.output } : fallback;
}

export const costUsd = (u: LlmUsage, p: Price) => (u.inputTokens * p.input + u.outputTokens * p.output) / 1e6;

/** Daily counters kept in the database (they survive restarts), read back by the admin page. */
export const usageKeys = (day: string) => ({
  calls: `ai:${day}`, // also the global daily budget counter (services/aiBudget.ts)
  failures: `aifail:${day}`,
  inputTokens: `aitok:in:${day}`,
  outputTokens: `aitok:out:${day}`,
  costMicroUsd: `aicost:${day}`,
});

export function instrumentLlm(llm: LlmClient, deps: { metrics: Metrics; repos: Repos; price?: Price; now?: () => Date }): LlmClient {
  const price = deps.price ?? priceFor(llm.model);
  const { metrics, repos } = deps;
  const day = () => (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const note = (p: Promise<unknown>) => p.catch((e: Error) => console.warn(`[telemetry] usage not saved: ${e.message}`));

  return {
    model: llm.model,
    async complete(req) {
      const started = performance.now();
      metrics.count("AiCalls");
      try {
        const { text, usage } = llm.completeWithUsage ? await llm.completeWithUsage(req) : { text: await llm.complete(req), usage: undefined };
        if (usage) {
          const cost = costUsd(usage, price);
          metrics.count("AiCostUsd", cost);
          const k = usageKeys(day());
          await note(
            Promise.all([
              repos.usage.increment(k.inputTokens, usage.inputTokens),
              repos.usage.increment(k.outputTokens, usage.outputTokens),
              repos.usage.increment(k.costMicroUsd, Math.round(cost * 1e6)),
            ]),
          );
        }
        return text;
      } catch (e) {
        metrics.count("AiFailures");
        await note(repos.usage.increment(usageKeys(day()).failures));
        throw e;
      } finally {
        metrics.time("AiLatency", performance.now() - started);
      }
    },
  };
}

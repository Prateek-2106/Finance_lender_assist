import type { Deps } from "../deps";
import { TooManyRequestsError } from "../errors";

export const DEFAULT_AI_LIMIT = { global: 300, perBusiness: 25 };

/**
 * Every model call on a public deployment costs real money, so each one is counted
 * before it runs: a daily cap across everyone and a smaller one per business.
 * Counters live in the database, so they survive restarts and work across servers.
 */
export async function spendAiBudget({ repos, config }: Pick<Deps, "repos" | "config">, tenantId: string, today = new Date()) {
  const limit = config.aiDailyLimit ?? DEFAULT_AI_LIMIT;
  const day = today.toISOString().slice(0, 10);
  const secondsLeft = Math.ceil((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1) - +today) / 1000);
  const mine = await repos.usage.increment(`ai:${day}:${tenantId}`);
  if (mine > limit.perBusiness)
    throw new TooManyRequestsError(`This business has used its ${limit.perBusiness} AI drafts for today. They reset at midnight UTC.`, secondsLeft);
  const all = await repos.usage.increment(`ai:${day}`);
  if (all > limit.global) throw new TooManyRequestsError("The AI assistant has reached its daily limit for this site. Try again tomorrow.", secondsLeft);
}

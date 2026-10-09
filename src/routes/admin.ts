// The platform owner's numbers: who signed up, what they did, what the AI cost. Not for businesses.
import { Router, type Request, type Response } from "express";
import type { Config, Deps } from "../deps";
import type { User } from "../domain";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { currentUser } from "../auth/session";
import { DEFAULT_AI_LIMIT } from "../services/aiBudget";
import { usageKeys } from "../telemetry/aiUsage";

export const ADMIN_DAYS = 14;

/** A confirmed account whose email is listed in ADMIN_EMAILS. */
export const isAdmin = (config: Config, user: User) => !!user.emailVerifiedAt && (config.adminEmails ?? []).includes(user.email.toLowerCase());

export const demoCounterKey = (day: string) => `demos:${day}`;

/** The last `n` UTC days, oldest first, ending today. */
export function lastDays(n: number, today = new Date()) {
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (n - 1 - i))).toISOString().slice(0, 10));
}

export function adminRouter(deps: Deps) {
  const { repos, config } = deps;
  const r = Router();

  const adminOnly = async (req: Request, res: Response) => {
    const auth = await currentUser(repos, req, res);
    if (!auth) throw new UnauthorizedError("Sign in first");
    if (!isAdmin(config, auth.user)) throw new ForbiddenError("This page is for the people who run Vendor Street");
  };

  // Live timings of this server: every route, database operation and outside call, plus vitals.
  r.get("/health", async (req, res) => {
    await adminOnly(req, res);
    const minutes = Math.min(60, Math.max(1, Number(req.query.minutes) || 15));
    const health = deps.health!;
    // Ask the database right now, so a dead database shows up even when nobody is using the site
    let database: { ok: boolean; ms: number; error?: string };
    const started = performance.now();
    try {
      await health.time("external", "Database ping", () => repos.ping());
      database = { ok: true, ms: Math.round((performance.now() - started) * 10) / 10 };
    } catch (e) {
      database = { ok: false, ms: Math.round(performance.now() - started), error: (e as Error).message.slice(0, 200) };
    }
    res.set("Cache-Control", "no-store").json({ generatedAt: new Date(), database, process: health.current(), ...health.snapshot(minutes) });
  });

  r.get("/overview", async (req, res) => {
    await adminOnly(req, res);

    const days = lastDays(ADMIN_DAYS);
    const stats = await repos.stats.overview(new Date(`${days[0]}T00:00:00Z`));
    const usage = await Promise.all(
      days.map(async (day) => {
        const k = usageKeys(day);
        const [calls, failures, inputTokens, outputTokens, costMicro, demos] = await Promise.all(
          [k.calls, k.failures, k.inputTokens, k.outputTokens, k.costMicroUsd, demoCounterKey(day)].map((key) => repos.usage.peek(key)),
        );
        return { calls: calls!, failures: failures!, inputTokens: inputTokens!, outputTokens: outputTokens!, costUsd: costMicro! / 1e6, demos: demos! };
      }),
    );
    const sum = <K extends keyof (typeof usage)[number]>(k: K) => usage.reduce((a, u) => a + u[k], 0);
    const d = stats.daily;

    res.set("Cache-Control", "no-store").json({
      generatedAt: new Date(),
      totals: { ...stats.users, ...stats.businesses },
      days: days.map((day, i) => ({
        day,
        signups: d.signups[day] ?? 0,
        businesses: d.businesses[day] ?? 0,
        demos: usage[i]!.demos,
        leads: d.leads[day] ?? 0,
        aiCalls: usage[i]!.calls,
        aiFailures: usage[i]!.failures,
        aiCostUsd: usage[i]!.costUsd,
        emailsSent: d.emailsSent[day] ?? 0,
        emailsFailed: d.emailsFailed[day] ?? 0,
      })),
      ai: {
        model: deps.llm?.model ?? null,
        dailyLimit: (config.aiDailyLimit ?? DEFAULT_AI_LIMIT).global,
        period: { calls: sum("calls"), failures: sum("failures"), inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), costUsd: sum("costUsd") },
      },
      dashboardUrl: config.dashboardUrl ?? null,
    });
  });

  return r;
}

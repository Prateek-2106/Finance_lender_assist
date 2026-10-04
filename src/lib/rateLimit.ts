import type { RequestHandler } from "express";
import { TooManyRequestsError } from "../errors";

/**
 * Fixed-window limiter kept in memory: right for one server (the economy deploy).
 * With several replicas, move the counters to the database (repos.usage) or Redis.
 * Keys on req.ip, which is only the real visitor's address when "trust proxy" is set
 * to the number of proxies in front of us (CloudFront = 1), never `true`.
 */
export function rateLimit(opts: { name: string; max: number; windowMs: number; message?: string; now?: () => number }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? Date.now;
  return (req, _res, next) => {
    const t = now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k); // keep memory bounded
    const key = req.ip ?? "unknown";
    let h = hits.get(key);
    if (!h || h.resetAt <= t) hits.set(key, (h = { count: 0, resetAt: t + opts.windowMs }));
    if (++h.count > opts.max)
      throw new TooManyRequestsError(opts.message ?? `Too many ${opts.name} requests, try again later`, Math.ceil((h.resetAt - t) / 1000));
    next();
  };
}

import type { Request, RequestHandler } from "express";
import type { Metrics } from "./metrics";
import { currentScope, inRequestScope, type Health } from "./health";

/** Requests that wait on the language model: timed separately (AiLatency) so they don't hide slow pages. */
export const AI_PATHS = /\/(draft-estimate|memo)$/;

/**
 * "GET /api/leads/:id/draft-estimate": the route's pattern, never the actual ids, so one route is one
 * row however many records it serves. Pages and files the React app needs are grouped.
 */
export function routeLabel(req: Request): string {
  const path = req.route?.path;
  if (typeof path === "string") {
    // req.baseUrl is gone by the time an error has been handled, so rebuild the mount point from the
    // URL: drop as many trailing segments as the route pattern has ("/leads/:id" has two).
    const segs = (req.originalUrl.split("?")[0] ?? "").split("/").filter(Boolean);
    const routeSegs = path.split("/").filter(Boolean).length;
    const base = segs.slice(0, Math.max(0, segs.length - routeSegs)).join("/");
    return `${req.method} ${base ? `/${base}` : ""}${path === "/" && base ? "" : path}`;
  }
  if (req.route) return `${req.method} (page)`; // the React app's pages, matched by a pattern
  if (req.originalUrl.startsWith("/assets/")) return "GET /assets/*";
  if (req.originalUrl.startsWith("/api/") || req.originalUrl.startsWith("/webhooks/")) return `${req.method} (no such route)`;
  return `${req.method} (static file)`;
}

/** Counts every request and its outcome, times it, and notes how much of it was database time. */
export function requestMetrics(metrics: Metrics, health?: Health): RequestHandler {
  return (req, res, next) => {
    if (req.path === "/health" || req.path === "/ready" || req.path === "/metrics") return next();
    const started = performance.now();
    inRequestScope(() => {
      const db = currentScope()!;
      res.on("finish", () => {
        const ms = performance.now() - started;
        metrics.count("Requests");
        if (res.statusCode >= 500) metrics.count("ServerErrors");
        else if (res.statusCode >= 400) metrics.count("ClientErrors");
        if (!AI_PATHS.test(req.path)) metrics.time("Latency", ms);
        if (db.dbCalls) metrics.time("DbTime", db.dbMs); // time this request spent waiting on the database
        health?.record("route", routeLabel(req), ms, res.statusCode < 500, { ms: db.dbMs, calls: db.dbCalls });
      });
      next();
    });
  };
}

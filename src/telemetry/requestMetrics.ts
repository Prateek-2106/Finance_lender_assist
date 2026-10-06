import type { RequestHandler } from "express";
import type { Metrics } from "./metrics";

/** Requests that wait on the language model: timed separately (AiLatency) so they don't hide slow pages. */
export const AI_PATHS = /\/(draft-estimate|memo)$/;

/** Counts every request and its outcome, and times everything except health checks and AI calls. */
export function requestMetrics(metrics: Metrics): RequestHandler {
  return (req, res, next) => {
    if (req.path === "/health") return next();
    const started = performance.now();
    res.on("finish", () => {
      metrics.count("Requests");
      if (res.statusCode >= 500) metrics.count("ServerErrors");
      else if (res.statusCode >= 400) metrics.count("ClientErrors");
      if (!AI_PATHS.test(req.path)) metrics.time("Latency", performance.now() - started);
    });
    next();
  };
}

import type { ErrorRequestHandler, RequestHandler } from "express";
import { ValidationError } from "../errors";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found" });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, issues: err.issues });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }
  const known = typeof err?.status === "number" && ((err.status >= 400 && err.status < 500) || err.status === 502 || err.status === 503);
  const status = known ? err.status : 500;
  if (status === 500) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  res.status(status).json({ error: err.message });
};

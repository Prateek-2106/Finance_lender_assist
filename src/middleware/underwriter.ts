import type { RequestHandler, Response } from "express";
import type { Deps } from "../deps";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { hashApiKey, verifyApiKey } from "../lib/apiKey";

/** "Priya Shah=uw_key_1;Alex Kim=uw_key_2" → [{ name, keyHash }] */
export function parseUnderwriters(spec: string | undefined): { name: string; keyHash: string; demoOnly?: boolean }[] {
  return (spec ?? "")
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const at = pair.lastIndexOf("=");
      const name = pair.slice(0, at).trim();
      const key = pair.slice(at + 1).trim();
      if (at < 1 || !name || key.length < 12) throw new Error(`UNDERWRITERS entry "${pair}" must look like "Full Name=key-of-12+-chars"`);
      return { name, keyHash: hashApiKey(key) };
    });
}

export function underwriterName(res: Response): string {
  return res.locals.underwriter as string;
}

/** The public demo key only sees demo businesses; real underwriters see everything. */
export function demoOnly(res: Response): boolean {
  return res.locals.underwriterDemoOnly === true;
}

/** Underwriters sign in with their own key; every decision is recorded under their name. */
export function requireUnderwriter({ config }: Deps): RequestHandler {
  return (req, res, next) => {
    const m = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "");
    if (!m) throw new UnauthorizedError("Missing underwriter key");
    const who = (config.underwriters ?? []).find((u) => verifyApiKey(m[1]!, u.keyHash));
    if (!who) throw new ForbiddenError("Not an underwriter key");
    res.locals.underwriter = who.name;
    res.locals.underwriterDemoOnly = who.demoOnly === true;
    next();
  };
}

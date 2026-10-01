import type { RequestHandler, Response } from "express";
import type { Deps } from "../deps";
import type { Tenant } from "../domain";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../errors";
import { verifyApiKey } from "../lib/apiKey";

export function getTenant(res: Response): Tenant {
  const t = res.locals.tenant as Tenant | undefined;
  if (!t) throw new Error("resolveTenant middleware did not run");
  return t;
}

export async function tenantForHost(deps: Deps, rawHost: string): Promise<Tenant | null> {
  const host = rawHost.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const base = deps.config.baseDomain.toLowerCase();
  if (host === base || host === "localhost") return null;
  if (host.endsWith(`.${base}`)) {
    const label = host.slice(0, -(base.length + 1));
    if (label.includes(".")) return null;
    return deps.repos.tenants.findBySubdomain(label);
  }
  const t = await deps.repos.tenants.findByCustomDomain(host);
  return t?.customDomain?.status === "verified" ? t : null;
}

export function resolveTenant(deps: Deps): RequestHandler {
  return async (req, res, next) => {
    const tenant = await tenantForHost(deps, req.hostname ?? "");
    if (!tenant) throw new NotFoundError("Unknown site");
    res.locals.tenant = tenant;
    next();
  };
}

export const requireApiKey: RequestHandler = (req, res, next) => {
  const m = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "");
  if (!m) throw new UnauthorizedError("Missing API key");
  if (!verifyApiKey(m[1]!, getTenant(res).apiKeyHash)) throw new ForbiddenError("API key does not match this site");
  next();
};

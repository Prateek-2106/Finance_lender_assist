import type { RequestHandler, Response } from "express";
import type { Deps } from "../deps";
import type { Membership, Tenant } from "../domain";
import { currentUser, sameOrigin } from "../auth/session";
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
    // The Host header itself, never X-Forwarded-Host: with "trust proxy" on, req.hostname
    // would believe a client-supplied header and let anyone pick another business's tenant.
    const tenant = await tenantForHost(deps, req.get("host") ?? "");
    if (!tenant) throw new NotFoundError("Unknown site");
    if (tenant.demo && new Date(tenant.demo.expiresAt) < new Date())
      throw new NotFoundError("This demo business has expired. Start a new one from the homepage.");
    res.locals.tenant = tenant;
    // Signed in with an account? Note whether that person belongs to this business.
    const auth = await currentUser(deps.repos, req, res);
    res.locals.membership = auth ? await deps.repos.memberships.find(auth.user.id, tenant.id) : null;
    next();
  };
}

/**
 * The owner's side of a business: either its API key (integrations, scripts, demos), or a signed-in
 * account that belongs to this business. A key that's present but wrong is refused outright.
 */
export const requireApiKey: RequestHandler = (req, res, next) => {
  const m = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "");
  if (m) {
    if (!verifyApiKey(m[1]!, getTenant(res).apiKeyHash)) throw new ForbiddenError("API key does not match this site");
    return next();
  }
  const membership = res.locals.membership as Membership | null | undefined;
  if (membership) {
    if (!sameOrigin(req)) throw new ForbiddenError("Request didn't come from this site");
    return next();
  }
  if (res.locals.auth) throw new ForbiddenError("Your account doesn't have access to this business");
  throw new UnauthorizedError("Sign in, or send this business's API key");
};
export const requireOwner = requireApiKey;

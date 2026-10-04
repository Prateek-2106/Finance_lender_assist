import { Router } from "express";
import type { Deps } from "../deps";
import type { PublicTenant, Tenant } from "../domain";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../errors";
import { generateApiKey, hashApiKey, verifyApiKey } from "../lib/apiKey";
import { parseOrThrow, TenantCreateSchema } from "../schemas";

export function toPublicTenant(t: Tenant): PublicTenant {
  const { apiKeyHash: _omit, ...rest } = t;
  return rest;
}

export function tenantsRouter({ repos, config }: Deps) {
  const r = Router();

  r.post("/", async (req, res) => {
    // A public deployment keeps sign-up closed: anyone could otherwise claim "chase-bank.<domain>".
    // Visitors get throwaway demos (POST /api/demo); real businesses are created by the admin.
    if (config.openSignup === false) {
      const m = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "");
      if (!m) throw new UnauthorizedError("Sign-up is closed. Try a demo business from the homepage.");
      if (!config.adminTokenHash || !verifyApiKey(m[1]!, config.adminTokenHash)) throw new ForbiddenError("Not the admin token");
    }
    const input = parseOrThrow(TenantCreateSchema, req.body);
    const apiKey = generateApiKey();
    const tenant = await repos.tenants.create({ ...input, apiKeyHash: hashApiKey(apiKey) });
    res.status(201).location(`/api/tenants/${tenant.id}`).json({ tenant: toPublicTenant(tenant), apiKey });
  });

  r.get("/:id", async (req, res) => {
    const tenant = await repos.tenants.findById(req.params.id);
    if (!tenant) throw new NotFoundError("Tenant not found");
    res.json({ tenant: toPublicTenant(tenant) });
  });

  return r;
}

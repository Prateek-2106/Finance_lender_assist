import { Router } from "express";
import type { Deps } from "../deps";
import type { PublicTenant, Tenant } from "../domain";
import { NotFoundError } from "../errors";
import { generateApiKey, hashApiKey } from "../lib/apiKey";
import { parseOrThrow, TenantCreateSchema } from "../schemas";

export function toPublicTenant(t: Tenant): PublicTenant {
  const { apiKeyHash: _omit, ...rest } = t;
  return rest;
}

export function tenantsRouter({ repos }: Deps) {
  const r = Router();

  r.post("/", async (req, res) => {
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

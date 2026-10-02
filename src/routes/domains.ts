import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import type { CustomDomain, Tenant } from "../domain";
import { InvalidTransitionError, NotFoundError, ServiceUnavailableError } from "../errors";
import { getTenant, requireApiKey } from "../middleware/tenant";
import { parseOrThrow } from "../schemas";

export const TXT_PREFIX = "_mainstreet-verify";
const tokenValue = (token: string) => `mainstreet-verify=${token}`;

/** A real public hostname: 2+ labels, letters/digits/hyphens, no IPs, no ports. */
export const HostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((h) => h.replace(/\.$/, ""))
  .refine((h) => h.length <= 253, "Hostname is too long")
  .refine((h) => /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(h), "Not a valid hostname")
  .refine((h) => !/^\d+(\.\d+){3}$/.test(h), "Use a hostname, not an IP address")
  .refine((h) => /[a-z]/.test(h.split(".").at(-1)!), "Not a valid top-level domain");

/** What the customer must add at their DNS provider. */
export function dnsInstructions(tenant: Tenant, cd: CustomDomain, baseDomain: string) {
  return {
    hostname: cd.hostname,
    status: cd.status,
    records: [
      { type: "TXT", name: `${TXT_PREFIX}.${cd.hostname}`, value: tokenValue(cd.verificationToken), purpose: "proves you control the domain" },
      {
        type: "CNAME",
        name: cd.hostname,
        value: `${tenant.subdomain}.${baseDomain}`,
        purpose: "sends visitors to your site (for a bare domain like example.com, use your DNS provider's ALIAS/ANAME record instead)",
      },
    ],
  };
}

export function domainsRouter({ repos, dns, config }: Deps) {
  const r = Router();
  r.use("/domains", requireApiKey);

  r.get("/domains", (_req, res) => {
    const t = getTenant(res);
    res.json({ domain: t.customDomain ? dnsInstructions(t, t.customDomain, config.baseDomain) : null });
  });

  r.post("/domains", async (req, res) => {
    const { hostname } = parseOrThrow(z.object({ hostname: HostnameSchema }), req.body);
    const base = config.baseDomain.toLowerCase();
    if (hostname === base || hostname.endsWith(`.${base}`))
      throw new InvalidTransitionError(`${hostname} is part of ${base}; your site is already at ${getTenant(res).subdomain}.${base}`);
    const customDomain: CustomDomain = { hostname, status: "pending", verificationToken: randomBytes(16).toString("hex") };
    const t = await repos.tenants.update(getTenant(res).id, { customDomain }); // 409 if another business has it
    res.status(201).json({ domain: dnsInstructions(t, customDomain, config.baseDomain) });
  });

  r.post("/domains/verify", async (_req, res) => {
    if (!dns) throw new ServiceUnavailableError("DNS lookups are not configured");
    const t = getTenant(res);
    const cd = t.customDomain;
    if (!cd) throw new NotFoundError("Add a domain first");
    if (cd.status === "verified") {
      res.json({ domain: dnsInstructions(t, cd, config.baseDomain) });
      return;
    }
    const name = `${TXT_PREFIX}.${cd.hostname}`;
    let found: string[] = [];
    try {
      found = (await dns.resolveTxt(name)).map((chunks) => chunks.join("")); // long TXT values arrive split
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOTFOUND" && code !== "ENODATA") throw new ServiceUnavailableError(`DNS lookup failed (${code ?? "error"}); try again`);
    }
    if (!found.includes(tokenValue(cd.verificationToken))) {
      res.status(422).json({
        error: found.length
          ? `The TXT record at ${name} doesn't match yet. DNS changes can take a few minutes to appear.`
          : `No TXT record found at ${name} yet. DNS changes can take a few minutes to appear.`,
        found,
      });
      return;
    }
    const verified: CustomDomain = { ...cd, status: "verified" };
    const updated = await repos.tenants.update(t.id, { customDomain: verified });
    res.json({ domain: dnsInstructions(updated, verified, config.baseDomain) });
  });

  r.delete("/domains", async (_req, res) => {
    await repos.tenants.update(getTenant(res).id, { customDomain: undefined });
    res.status(204).end();
  });

  return r;
}

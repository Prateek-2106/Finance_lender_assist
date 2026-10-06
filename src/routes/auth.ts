// Accounts: sign in with a link sent by email, see your businesses, create one.
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { ConflictError, ForbiddenError, TooManyRequestsError, UnauthorizedError, ValidationError } from "../errors";
import { generateApiKey, hashApiKey } from "../lib/apiKey";
import { rateLimit } from "../lib/rateLimit";
import { tenantUrl, type Notifier } from "../notify/notifier";
import { parseOrThrow, TenantCreateSchema } from "../schemas";
import {
  apexUrl,
  clearSessionCookie,
  currentUser,
  LOGIN_TOKEN_MINUTES,
  randomToken,
  readCookie,
  SESSION_COOKIE,
  sameOrigin,
  setSessionCookie,
  sha256,
  startSession,
} from "../auth/session";

export const MAX_BUSINESSES_PER_USER = 3;
const SIGN_INS_PER_EMAIL_PER_HOUR = 5;

const StartSchema = z.object({ email: z.email().trim().toLowerCase().max(254), next: z.string().max(500).optional() });
const VerifySchema = z.object({ token: z.string().min(20).max(100) });

export function authRouter(deps: Deps, notifier: Notifier) {
  const { repos, config } = deps;
  const r = Router();

  /** Only send people back to the platform or one of its business subdomains, never elsewhere. */
  const safeNext = (next: string | undefined) => {
    if (!next) return undefined;
    try {
      const u = new URL(next, apexUrl(config));
      const base = config.baseDomain === "localhost" ? "lvh.me" : config.baseDomain;
      const host = u.hostname.toLowerCase();
      return host === base || host.endsWith(`.${base}`) ? u.toString() : undefined;
    } catch {
      return undefined;
    }
  };

  const ipLimit: RequestHandler = config.rateLimits
    ? rateLimit({ name: "sign-in", max: config.rateLimits.signInsPerHour ?? 10, windowMs: 3_600_000, message: "Too many sign-in emails from your network. Try again in an hour." })
    : (_req, _res, next) => next();

  const businessesOf = async (userId: string) => {
    const ms = await repos.memberships.listByUser(userId);
    const out = [];
    for (const m of ms) {
      const t = await repos.tenants.findById(m.tenantId);
      if (t && !t.demo) out.push({ id: t.id, name: t.name, subdomain: t.subdomain, role: m.role, dashboardUrl: tenantUrl(config, t, "/app"), siteUrl: tenantUrl(config, t, "/") });
    }
    return out;
  };

  // 1. "Email me a link". Always answers the same way, so it can't be used to find out who has an account.
  r.post("/start", ipLimit, async (req, res) => {
    const { email, next } = parseOrThrow(StartSchema, req.body);
    const hour = new Date().toISOString().slice(0, 13);
    if ((await repos.usage.increment(`signin:${sha256(email)}:${hour}`)) > SIGN_INS_PER_EMAIL_PER_HOUR)
      throw new TooManyRequestsError("We've sent several links to this address already. Check your inbox, or try again in an hour.", 3600);
    const token = randomToken();
    await repos.loginTokens.create({ tokenHash: sha256(token), email, expiresAt: new Date(Date.now() + LOGIN_TOKEN_MINUTES * 60_000) });
    // The token sits after "#", which browsers never send to a server, so it can't end up in access logs.
    const params = new URLSearchParams({ token, ...(safeNext(next) ? { next: safeNext(next)! } : {}) });
    const link = `${apexUrl(config)}/auth/verify#${params}`;
    void notifier.signInLink(email, link, LOGIN_TOKEN_MINUTES);
    res.status(202).json({ sent: true, expiresInMinutes: LOGIN_TOKEN_MINUTES });
  });

  // 2. The link's page posts the token here. One use, 15 minutes; then a 30-day session cookie.
  r.post("/verify", async (req, res) => {
    const { token } = parseOrThrow(VerifySchema, req.body);
    const t = await repos.loginTokens.consume(sha256(token), new Date());
    if (!t) throw new UnauthorizedError("This sign-in link has expired or was already used. Ask for a new one.");
    const { user, created } = await repos.users.upsertByEmail(t.email);
    await repos.users.update(user.id, { lastLoginAt: new Date() });
    const old = readCookie(req, SESSION_COOKIE);
    if (old) await repos.sessions.delete(sha256(old)); // never reuse a session id from before sign-in
    setSessionCookie(res, config, await startSession(repos, user.id));
    res.json({ user: { id: user.id, email: user.email, name: user.name ?? null }, newUser: created, businesses: await businessesOf(user.id) });
  });

  r.get("/me", async (req, res) => {
    const auth = await currentUser(repos, req, res);
    if (!auth) throw new UnauthorizedError("Not signed in");
    const u = auth.user;
    res.json({ user: { id: u.id, email: u.email, name: u.name ?? null }, businesses: await businessesOf(u.id), limits: { businesses: MAX_BUSINESSES_PER_USER } });
  });

  r.post("/logout", async (req, res) => {
    const id = readCookie(req, SESSION_COOKIE);
    if (id) await repos.sessions.delete(sha256(id));
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  // 3. A signed-in, verified email can start a real business.
  r.post("/businesses", async (req, res) => {
    const auth = await currentUser(repos, req, res);
    if (!auth) throw new UnauthorizedError("Sign in to create a business");
    if (!sameOrigin(req)) throw new ForbiddenError("Request didn't come from this site");
    const input = parseOrThrow(TenantCreateSchema, req.body);
    const owned = (await repos.memberships.listByUser(auth.user.id)).filter((m) => m.role === "owner");
    if (owned.length >= MAX_BUSINESSES_PER_USER) throw new ValidationError(`An account can own up to ${MAX_BUSINESSES_PER_USER} businesses`);
    const apiKey = generateApiKey();
    let tenant;
    try {
      tenant = await repos.tenants.create({ ...input, ownerEmail: input.ownerEmail ?? auth.user.email, apiKeyHash: hashApiKey(apiKey) });
    } catch (e) {
      if (e instanceof ConflictError) throw new ConflictError(`${input.subdomain}.${config.baseDomain} is taken. Try another address.`);
      throw e;
    }
    await repos.memberships.add({ userId: auth.user.id, tenantId: tenant.id, role: "owner" });
    res.status(201).json({
      business: { id: tenant.id, name: tenant.name, subdomain: tenant.subdomain, role: "owner", dashboardUrl: tenantUrl(config, tenant, "/app"), siteUrl: tenantUrl(config, tenant, "/") },
      apiKey, // shown once, for integrations; signing in doesn't need it
    });
  });

  return r;
}

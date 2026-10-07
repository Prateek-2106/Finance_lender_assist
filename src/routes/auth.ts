// Accounts: email + password, with 6-digit codes by email to confirm the address and to reset a password.
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import type { CodePurpose, User } from "../domain";
import { ConflictError, ForbiddenError, TooManyRequestsError, UnauthorizedError, ValidationError } from "../errors";
import { generateApiKey, hashApiKey } from "../lib/apiKey";
import { rateLimit } from "../lib/rateLimit";
import { tenantUrl, type Notifier } from "../notify/notifier";
import { templates } from "../notify/templates";
import { parseOrThrow, TenantCreateSchema } from "../schemas";
import { burnPasswordCheck, hashPassword, newCode, passwordProblem, verifyPassword } from "../auth/password";
import {
  apexUrl,
  clearSessionCookie,
  CODE_MINUTES,
  currentUser,
  MAX_CODE_ATTEMPTS,
  readCookie,
  SESSION_COOKIE,
  sameOrigin,
  setSessionCookie,
  sha256,
  startSession,
} from "../auth/session";
import type { Request, Response } from "express";
import { isAdmin } from "./admin";

export const MAX_BUSINESSES_PER_USER = 3;
const EMAILS_PER_ADDRESS_PER_HOUR = 5; // codes and notices sent to one address
const FAILED_LOGINS_PER_ACCOUNT_PER_HOUR = 10;

const Email = z.email().trim().toLowerCase().max(254);
const Password = z.string().min(1).max(200);
const Code = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the email");

export function authRouter(deps: Deps, notifier: Notifier) {
  const { repos, config } = deps;
  const r = Router();
  const hour = () => new Date().toISOString().slice(0, 13);
  const codeHash = (purpose: CodePurpose, email: string, code: string) => sha256(`${purpose}:${email}:${code}`);

  // Per-visitor limits, one bucket per kind of request: a person who signs up, confirms, signs out and
  // back in a few times must never trip them. Guessing is stopped per account (failed-login lockout,
  // 5 tries per code), and email per address (throttleEmails), so these only stop floods.
  const perHour = config.rateLimits?.signInsPerHour ?? 30;
  const limit = (name: string, max: number): RequestHandler =>
    config.rateLimits
      ? rateLimit({ name, max, windowMs: 3_600_000, message: "Too many attempts from your network. Try again in an hour." })
      : (_req, _res, next) => next();
  const loginLimit = limit("login", perHour);
  const codeLimit = limit("code", perHour); // entering a code: verify-email, reset
  const mailLimit = limit("mail", Math.max(5, Math.round(perHour / 3))); // anything that sends an email

  /** Caps how much email one address can be sent, whoever is asking. */
  async function throttleEmails(email: string) {
    if ((await repos.usage.increment(`emails:${sha256(email)}:${hour()}`)) > EMAILS_PER_ADDRESS_PER_HOUR)
      throw new TooManyRequestsError("We've emailed this address several times already. Check your inbox (and spam), or try again in an hour.", 3600);
  }
  async function sendCode(email: string, purpose: CodePurpose) {
    const code = newCode();
    await repos.emailCodes.issue({ email, purpose, codeHash: codeHash(purpose, email, code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000) });
    const tpl = purpose === "verify" ? templates.verifyCode(code, CODE_MINUTES) : templates.resetCode(code, CODE_MINUTES);
    void notifier.platformEmail(email, purpose === "verify" ? "verify_code" : "reset_code", tpl);
  }
  async function checkCode(email: string, purpose: CodePurpose, code: string) {
    const result = await repos.emailCodes.attempt(email, purpose, codeHash(purpose, email, code), new Date(), MAX_CODE_ATTEMPTS);
    if (result === "wrong") throw new ValidationError("That code isn't right. Check the latest email we sent.");
    if (result === "locked") throw new TooManyRequestsError("Too many wrong codes. Ask for a new one.");
    if (result === "expired") throw new ValidationError("That code has expired or was already used. Ask for a new one.");
  }
  /** Signs this browser in: a fresh session id every time (never reuse one from before sign-in). */
  async function signIn(req: Request, res: Response, user: User) {
    const old = readCookie(req, SESSION_COOKIE);
    if (old) await repos.sessions.delete(sha256(old));
    await repos.users.update(user.id, { lastLoginAt: new Date() });
    const id = await startSession(repos, user.id);
    setSessionCookie(res, config, id);
    return id;
  }
  const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name ?? null });
  const businessesOf = async (userId: string) => {
    const out = [];
    for (const m of await repos.memberships.listByUser(userId)) {
      const t = await repos.tenants.findById(m.tenantId);
      if (t && !t.demo) out.push({ id: t.id, name: t.name, subdomain: t.subdomain, role: m.role, dashboardUrl: tenantUrl(config, t, "/app"), siteUrl: tenantUrl(config, t, "/") });
    }
    return out;
  };

  // ── Create an account. The answer is the same whether or not the email is already registered.
  r.post("/signup", mailLimit, async (req, res) => {
    const { email, password } = parseOrThrow(z.object({ email: Email, password: Password }), req.body);
    const problem = passwordProblem(password, email);
    if (problem) throw new ValidationError(problem, [{ path: "password", message: problem }]);
    await throttleEmails(email);
    const existing = await repos.users.findByEmail(email);
    if (existing?.emailVerifiedAt) {
      // Never let a sign-up change a confirmed account's password: tell the real owner instead.
      void notifier.platformEmail(email, "account_exists", templates.accountExists(`${apexUrl(config)}/signin`, `${apexUrl(config)}/forgot`));
    } else {
      const { user } = await repos.users.upsertByEmail(email);
      await repos.users.update(user.id, { passwordHash: await hashPassword(password) });
      await sendCode(email, "verify");
    }
    res.status(202).json({ next: "verify", email, expiresInMinutes: CODE_MINUTES });
  });

  r.post("/verify-email", codeLimit, async (req, res) => {
    const { email, code } = parseOrThrow(z.object({ email: Email, code: Code }), req.body);
    await checkCode(email, "verify", code);
    const user = await repos.users.findByEmail(email);
    if (!user) throw new ValidationError("That code has expired or was already used. Ask for a new one.");
    const verified = await repos.users.update(user.id, { emailVerifiedAt: user.emailVerifiedAt ?? new Date() });
    await signIn(req, res, verified);
    res.json({ user: publicUser(verified), businesses: await businessesOf(verified.id) });
  });

  r.post("/resend-code", mailLimit, async (req, res) => {
    const { email } = parseOrThrow(z.object({ email: Email }), req.body);
    await throttleEmails(email);
    const user = await repos.users.findByEmail(email);
    if (user && !user.emailVerifiedAt) await sendCode(email, "verify");
    res.status(202).json({ sent: true });
  });

  // ── Sign in. Every failure reads the same and takes the same time, so it can't reveal who has an account.
  r.post("/login", loginLimit, async (req, res) => {
    const { email, password } = parseOrThrow(z.object({ email: Email, password: Password }), req.body);
    const user = await repos.users.findByEmail(email);
    const wrong = () => new UnauthorizedError("Email or password is incorrect");
    if (!user?.passwordHash) {
      await burnPasswordCheck(password);
      throw wrong();
    }
    const failKey = `loginfail:${user.id}:${hour()}`;
    if ((await repos.usage.peek(failKey)) >= FAILED_LOGINS_PER_ACCOUNT_PER_HOUR)
      throw new TooManyRequestsError("Too many failed sign-ins for this account. Try again in an hour, or reset your password.", 3600);
    if (!(await verifyPassword(password, user.passwordHash))) {
      await repos.usage.increment(failKey);
      throw wrong();
    }
    if (!user.emailVerifiedAt) {
      // The password was right; the email just isn't confirmed. Send a fresh code unless we've
      // already sent several this hour (then the latest one still works).
      let sent = true;
      try {
        await throttleEmails(email);
        await sendCode(email, "verify");
      } catch (e) {
        if (!(e instanceof TooManyRequestsError)) throw e;
        sent = false;
      }
      res.status(403).json({
        error: sent ? "Your password is right. Confirm your email to finish: we just sent you a new code." : "Your password is right. Confirm your email to finish: use the latest code we sent you.",
        needsVerification: true,
        codeSent: sent,
      });
      return;
    }
    await signIn(req, res, user);
    res.json({ user: publicUser(user), businesses: await businessesOf(user.id) });
  });

  // ── Forgot password: a code by email, then a new password (which also confirms the email).
  r.post("/forgot", mailLimit, async (req, res) => {
    const { email } = parseOrThrow(z.object({ email: Email }), req.body);
    await throttleEmails(email);
    if (await repos.users.findByEmail(email)) await sendCode(email, "reset");
    res.status(202).json({ sent: true, expiresInMinutes: CODE_MINUTES });
  });

  r.post("/reset", codeLimit, async (req, res) => {
    const { email, code, password } = parseOrThrow(z.object({ email: Email, code: Code, password: Password }), req.body);
    const problem = passwordProblem(password, email);
    if (problem) throw new ValidationError(problem, [{ path: "password", message: problem }]);
    await checkCode(email, "reset", code);
    const user = await repos.users.findByEmail(email);
    if (!user) throw new ValidationError("That code has expired or was already used. Ask for a new one.");
    const updated = await repos.users.update(user.id, { passwordHash: await hashPassword(password), emailVerifiedAt: user.emailVerifiedAt ?? new Date() });
    await repos.sessions.deleteByUser(user.id); // a reset signs out every other device
    await signIn(req, res, updated);
    res.json({ user: publicUser(updated), businesses: await businessesOf(updated.id) });
  });

  r.get("/me", async (req, res) => {
    const auth = await currentUser(repos, req, res);
    if (!auth) throw new UnauthorizedError("Not signed in");
    res.json({ user: publicUser(auth.user), businesses: await businessesOf(auth.user.id), limits: { businesses: MAX_BUSINESSES_PER_USER }, admin: isAdmin(config, auth.user) });
  });

  r.post("/logout", async (req, res) => {
    const id = readCookie(req, SESSION_COOKIE);
    if (id) await repos.sessions.delete(sha256(id));
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  // ── A signed-in, confirmed account can start a real business.
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

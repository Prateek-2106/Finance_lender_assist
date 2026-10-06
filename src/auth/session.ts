// Signed-in browsers. The cookie carries a random id; the database keeps only its SHA-256,
// so a leaked database can't be turned into working sessions.
import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { Config } from "../deps";
import type { Repos } from "../repos/types";
import type { Session, User } from "../domain";

export const SESSION_COOKIE = "vs_session";
export const SESSION_DAYS = 30;
export const CODE_MINUTES = 15;
export const MAX_CODE_ATTEMPTS = 5;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");

/** "https://vendorstreet.dev", or "http://lvh.me:3000" locally: the platform's own address. */
export function apexUrl(config: Config) {
  const u = new URL(config.publicUrl);
  const base = config.baseDomain === "localhost" ? "lvh.me" : config.baseDomain;
  return `${u.protocol}//${base}${u.port ? `:${u.port}` : ""}`;
}

/**
 * One cookie for the platform and every business subdomain (Domain=.vendorstreet.dev), so a
 * sign-in on the main site works on each of your businesses. HttpOnly: page scripts can't read it.
 * SameSite=Lax: other sites can't make the browser send it on a form post (subdomains are covered
 * separately by the Origin check in requireOwner).
 */
function cookieAttrs(config: Config, maxAgeSeconds: number) {
  const secure = new URL(config.publicUrl).protocol === "https:";
  const base = config.baseDomain === "localhost" ? "lvh.me" : config.baseDomain;
  return [`Path=/`, `Domain=.${base}`, `Max-Age=${maxAgeSeconds}`, `HttpOnly`, `SameSite=Lax`, ...(secure ? ["Secure"] : [])].join("; ");
}

export function setSessionCookie(res: Response, config: Config, id: string) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=${id}; ${cookieAttrs(config, SESSION_DAYS * 86_400)}`);
}
export function clearSessionCookie(res: Response, config: Config) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; ${cookieAttrs(config, 0)}`);
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || undefined;
  }
  return undefined;
}

export async function startSession(repos: Repos, userId: string, now = new Date()) {
  const id = randomToken();
  await repos.sessions.create({ idHash: sha256(id), userId, expiresAt: new Date(+now + SESSION_DAYS * 86_400_000) });
  return id;
}

/** The signed-in user for this request, if any. Cached on res.locals for the rest of the request. */
export async function currentUser(repos: Repos, req: Request, res: Response): Promise<{ user: User; session: Session } | null> {
  if (res.locals.auth !== undefined) return res.locals.auth;
  const id = readCookie(req, SESSION_COOKIE);
  let found: { user: User; session: Session } | null = null;
  if (id && id.length <= 100) {
    const session = await repos.sessions.find(sha256(id), new Date());
    const user = session && (await repos.users.findById(session.userId));
    if (session && user) found = { user, session };
  }
  res.locals.auth = found;
  return found;
}

/**
 * Cookie-authenticated requests that change something must come from a page on this same address.
 * Browsers always send Origin on such requests; a page on another business's subdomain (same site,
 * so SameSite doesn't help) or anywhere else fails this check.
 */
export function sameOrigin(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}

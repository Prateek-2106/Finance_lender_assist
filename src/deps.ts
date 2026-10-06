// Everything the app needs is injected, so tests can swap in fakes.
import type { Repos } from "./repos/types";

export interface Config {
  baseDomain: string; // "lvh.me" locally, "yourapp.com" in prod
  publicUrl: string; // what Twilio sees, e.g. "https://abc.ngrok.app"
  twilioAuthToken: string;
  /** People who can decide "review" cases, each with their own key (only hashes kept). */
  underwriters?: { name: string; keyHash: string; demoOnly?: boolean }[];
  /** Public deployments: false, so only an admin can create a real business (visitors get demos). */
  openSignup?: boolean;
  adminTokenHash?: string;
  /** Homepage demos ("Try it"). */
  demo?: { enabled: boolean; underwriterKey?: string; ttlDays: number };
  /** AI calls allowed per day, across everyone and per business. */
  aiDailyLimit?: { global: number; perBusiness: number };
  /** Per-visitor limits on public endpoints; unset = no limits (tests, local dev). */
  rateLimits?: { leadsPerHour: number; demosPerHour: number; signInsPerHour?: number };
  /** True on the live site: never print sign-in links or other secrets to the console. */
  production?: boolean;
  /** Proxies in front of the app (CloudFront = 1). Decides which X-Forwarded-For entry is the visitor. */
  trustProxyHops?: number;
  /** CloudFront adds this as X-Origin-Verify; requests without it are refused. */
  originSecret?: string;
  /** Signed-in accounts with these emails can open /admin (platform numbers). */
  adminEmails?: string[];
  /** Linked from /admin. */
  dashboardUrl?: string;
  /** Shown on the homepage. */
  site?: { author?: string; repoUrl?: string };
}

/** Minimal LLM interface (step 8). Implement it with any provider. */
export interface LlmRequest {
  system: string;
  prompt: string;
  json?: boolean;
}
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}
export interface LlmClient {
  readonly model: string; // recorded on everything the model produces
  complete(req: LlmRequest): Promise<string>;
  /** Providers that report token counts implement this too; telemetry uses it to track cost. */
  completeWithUsage?(req: LlmRequest): Promise<{ text: string; usage?: LlmUsage }>;
}

/** Minimal DNS interface (step 10). Real impl wraps node:dns/promises. */
export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveCname(hostname: string): Promise<string[]>;
}

export interface Deps {
  repos: Repos;
  config: Config;
  llm?: LlmClient;
  dns?: DnsResolver;
  mailer?: import("./notify/mailer").Mailer; // step 11: Mailpit locally, SES in production
  /** CloudWatch metrics in production; nothing by default. */
  metrics?: import("./telemetry/metrics").Metrics;
}

// Everything the app needs is injected, so tests can swap in fakes.
import type { Repos } from "./repos/types";

export interface Config {
  baseDomain: string; // "lvh.me" locally, "yourapp.com" in prod
  publicUrl: string; // what Twilio sees, e.g. "https://abc.ngrok.app"
  twilioAuthToken: string;
}

/** Minimal LLM interface (step 8). Implement it with any provider. */
export interface LlmClient {
  readonly model: string; // recorded on everything the model produces
  complete(req: { system: string; prompt: string; json?: boolean }): Promise<string>;
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
}

// Times calls to other services: the language model, email, DNS.
import type { DnsResolver, LlmClient } from "../deps";
import type { Mailer } from "../notify/mailer";
import type { Health } from "./health";

export function instrument(health: Health, d: { llm?: LlmClient; mailer?: Mailer; dns?: DnsResolver }) {
  return {
    ...(d.llm ? { llm: { model: d.llm.model, complete: (req) => health.time("external", `AI: ${d.llm!.model}`, () => d.llm!.complete(req)) } satisfies LlmClient } : {}),
    ...(d.mailer ? { mailer: { name: d.mailer.name, send: (e) => health.time("external", "Email: send", () => d.mailer!.send(e)) } satisfies Mailer } : {}),
    ...(d.dns
      ? {
          dns: {
            resolveTxt: (h) => health.time("external", "DNS: TXT lookup", () => d.dns!.resolveTxt(h)),
            resolveCname: (h) => health.time("external", "DNS: CNAME lookup", () => d.dns!.resolveCname(h)),
          } satisfies DnsResolver,
        }
      : {}),
  };
}

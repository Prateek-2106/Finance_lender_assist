// Test helpers shared by the HTTP tests.
import request from "supertest";
import { createApp } from "../../src/app";
import { createMemoryRepos } from "../../src/repos/memory";
import type { Deps } from "../../src/deps";
import type { Mailer, OutgoingEmail } from "../../src/notify/mailer";
import type { Notifier } from "../../src/notify/notifier";
import { hashApiKey } from "../../src/lib/apiKey";

export const UW_KEY = "uw_test_priya_000000";
export const UW_KEY_2 = "uw_test_alex_0000000";
export const asUnderwriter = (key = UW_KEY) => ({ Authorization: `Bearer ${key}` });

/** Records every email instead of sending it; can be told to fail. */
export function fakeMailer() {
  const sent: OutgoingEmail[] = [];
  const m = { fail: false, sent };
  const mailer: Mailer = {
    name: "fake",
    async send(e) {
      if (m.fail) throw new Error("SMTP connection refused");
      sent.push(e);
    },
  };
  return Object.assign(m, { mailer });
}

export const BASE = "lvh.me";

export function makeApp(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    repos: createMemoryRepos(),
    config: {
      baseDomain: BASE,
      publicUrl: "https://hooks.example.com",
      twilioAuthToken: "test-token",
      underwriters: [
        { name: "Priya Shah", keyHash: hashApiKey(UW_KEY) },
        { name: "Alex Kim", keyHash: hashApiKey(UW_KEY_2) },
      ],
    },
    ...overrides,
  };
  const app = createApp(deps);
  /** Waits for emails triggered by earlier requests to finish sending. */
  const emailsSettled = () => (app.locals.notifier as Notifier).idle();
  return { app, deps, emailsSettled };
}

/** Create a tenant through the API and return { tenant, apiKey, host }. */
export async function signUp(app: Parameters<typeof request>[0], body: Record<string, unknown>) {
  const res = await request(app).post("/api/tenants").send(body);
  if (res.status !== 201) throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, host: `${res.body.tenant.subdomain}.${BASE}` } as {
    tenant: { id: string; subdomain: string; name: string };
    apiKey: string;
    host: string;
  };
}

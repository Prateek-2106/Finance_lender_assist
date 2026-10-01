// Test helpers shared by the HTTP tests.
import request from "supertest";
import { createApp } from "../../src/app";
import { createMemoryRepos } from "../../src/repos/memory";
import type { Deps } from "../../src/deps";

export const BASE = "lvh.me";

export function makeApp(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    repos: createMemoryRepos(),
    config: { baseDomain: BASE, publicUrl: "https://hooks.example.com", twilioAuthToken: "test-token" },
    ...overrides,
  };
  return { app: createApp(deps), deps };
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

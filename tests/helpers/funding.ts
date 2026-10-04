import request from "supertest";
import { PROFILES } from "../../fixtures/profiles";
import { generateStatement, toCsv } from "../../fixtures/generate";

/** Creates an application from a fixture business, uploads its statement and assesses it. */
export async function assessedApplication(app: Parameters<typeof request>[0], headers: Record<string, string>, key: string, overrides: Record<string, unknown> = {}) {
  const p = PROFILES.find((x) => x.key === key)!;
  const created = await request(app).post("/api/applications").set(headers).send({
    industry: p.industry,
    monthsInBusiness: p.monthsInBusiness,
    statedMonthlyRevenueCents: p.statedMonthlyRevenueCents,
    amountRequestedCents: p.amountRequestedCents,
    useOfFunds: p.useOfFunds,
    ...overrides,
  });
  const id = created.body.application.id as string;
  await request(app).post(`/api/applications/${id}/statements`).set(headers).set("content-type", "text/csv").send(toCsv(p, generateStatement(p)));
  const assessed = await request(app).post(`/api/applications/${id}/assess`).set(headers);
  return { id, assessed };
}

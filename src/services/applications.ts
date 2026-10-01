import type { FundingApplication, Id, Tenant, TxnCategory } from "../domain";
import { InvalidTransitionError, NotFoundError, ValidationError } from "../errors";
import type { Repos } from "../repos/types";
import { classify } from "../risk/classify";
import { fingerprints } from "../risk/fingerprint";
import { parseStatementCsv } from "../risk/statementCsv";

export const MAX_STATEMENT_LINES = 5000;

export async function createApplication(
  repos: Repos,
  tenant: Tenant,
  input: Omit<FundingApplication, "id" | "tenantId" | "status" | "createdAt">,
): Promise<FundingApplication> {
  return repos.applications.create({ ...input, tenantId: tenant.id, status: "draft" });
}

export async function getApplication(repos: Repos, tenantId: Id, id: Id): Promise<FundingApplication> {
  const a = await repos.applications.findById(tenantId, id);
  if (!a) throw new NotFoundError("Application not found");
  return a;
}

/** Parse → classify → fingerprint → store. All-or-nothing: one bad row rejects the file. */
export async function ingestStatement(repos: Repos, tenantId: Id, applicationId: Id, csv: string) {
  const app = await getApplication(repos, tenantId, applicationId);
  if (app.status !== "draft") throw new InvalidTransitionError(`Cannot add statements to a ${app.status} application`);

  const { rows, errors } = parseStatementCsv(csv);
  if (errors.length) throw new ValidationError("Statement has invalid rows", errors.slice(0, 50));
  if (rows.length === 0) throw new ValidationError("Statement has no transactions");
  if (rows.length > MAX_STATEMENT_LINES) throw new ValidationError(`Statement exceeds ${MAX_STATEMENT_LINES} lines`);

  const keys = fingerprints(rows);
  const lines = rows.map((r, i) => ({
    tenantId,
    applicationId,
    date: r.date,
    description: r.description,
    amountCents: r.amountCents,
    ...(r.balanceCents !== undefined ? { balanceCents: r.balanceCents } : {}),
    ...classify(r.description, r.amountCents),
    fingerprint: keys[i]!,
  }));
  const { inserted, duplicates } = await repos.transactions.insertMany(lines);
  return { received: rows.length, inserted, duplicates };
}

export async function transactionSummary(repos: Repos, tenantId: Id, applicationId: Id, category?: TxnCategory) {
  await getApplication(repos, tenantId, applicationId);
  const transactions = await repos.transactions.listByApplication(tenantId, applicationId, category ? { category } : {});
  const totals: Partial<Record<TxnCategory, { count: number; amountCents: number }>> = {};
  for (const t of transactions) {
    const s = (totals[t.category] ??= { count: 0, amountCents: 0 });
    s.count++;
    s.amountCents += t.amountCents;
  }
  const dates = transactions.map((t) => t.date);
  return {
    period: dates.length ? { from: dates[0], to: dates.at(-1) } : null,
    totals,
    transactions,
  };
}

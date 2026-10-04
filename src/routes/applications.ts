import express, { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { getTenant, requireApiKey } from "../middleware/tenant";
import type { Notifier } from "../notify/notifier";
import { applicantView } from "../risk/applicantView";
import type { FundingApplication } from "../domain";
import { ApplicationCreateSchema, parseOrThrow } from "../schemas";
import { assessApplication, createApplication, getApplication, ingestStatement, transactionSummary } from "../services/applications";

const CategoryQuery = z.object({
  category: z
    .enum(["revenue", "transfer_in", "loan_funding", "reversal", "nsf_fee", "lender_payment", "transfer_out", "expense"])
    .optional(),
});

export function applicationsRouter({ repos }: Deps, notifier: Notifier) {
  const r = Router();
  r.use("/applications", requireApiKey);
  const id = (v: unknown) => String(v);

  r.post("/applications", async (req, res) => {
    const input = parseOrThrow(ApplicationCreateSchema, req.body);
    res.status(201).json({ application: await createApplication(repos, getTenant(res), input) });
  });

  r.get("/applications", async (_req, res) => {
    // The list omits the heavy parts; GET /applications/:id has everything.
    const list = await repos.applications.listByTenant(getTenant(res).id);
    res.json({
      applications: list.map(({ assessment: _a, memo: _m, decisionLog: _l, ...a }) => a),
    });
  });

  r.get("/applications/:id", async (req, res) => {
    const app = await getApplication(repos, getTenant(res).id, id(req.params.id));
    res.json(forOwner(app));
  });

  r.post(
    "/applications/:id/statements",
    express.text({ type: ["text/csv", "text/plain", "application/csv"], limit: "2mb" }),
    async (req, res) => {
      const csv = typeof req.body === "string" ? req.body : "";
      res.status(201).json(await ingestStatement(repos, getTenant(res).id, id(req.params.id), csv));
    },
  );

  r.post("/applications/:id/assess", async (req, res) => {
    const app = await assessApplication(repos, getTenant(res).id, id(req.params.id));
    void notifier.fundingDecision(app);
    res.json(forOwner(app));
  });

  r.get("/applications/:id/transactions", async (req, res) => {
    const { category } = parseOrThrow(CategoryQuery, req.query);
    res.json(await transactionSummary(repos, getTenant(res).id, id(req.params.id), category));
  });

  return r;
}

/** The business sees its decision in plain words and how it was scored, but not the internal underwriting memo. */
function forOwner(app: FundingApplication) {
  const { memo: _memo, ...rest } = app;
  return { application: rest, applicantView: applicantView(app) };
}

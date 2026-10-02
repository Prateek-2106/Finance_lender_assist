import express, { Router } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import { getTenant, requireApiKey } from "../middleware/tenant";
import { InvalidTransitionError, ServiceUnavailableError } from "../errors";
import { writeMemo } from "../ai/memo";
import { ApplicationCreateSchema, parseOrThrow } from "../schemas";
import { assessApplication, createApplication, getApplication, ingestStatement, transactionSummary } from "../services/applications";

const CategoryQuery = z.object({
  category: z
    .enum(["revenue", "transfer_in", "loan_funding", "reversal", "nsf_fee", "lender_payment", "transfer_out", "expense"])
    .optional(),
});

export function applicationsRouter({ repos, llm }: Deps) {
  const r = Router();
  r.use("/applications", requireApiKey);
  const id = (v: unknown) => String(v);

  r.post("/applications", async (req, res) => {
    const input = parseOrThrow(ApplicationCreateSchema, req.body);
    res.status(201).json({ application: await createApplication(repos, getTenant(res), input) });
  });

  r.get("/applications/:id", async (req, res) => {
    res.json({ application: await getApplication(repos, getTenant(res).id, id(req.params.id)) });
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
    res.json({ application: await assessApplication(repos, getTenant(res).id, id(req.params.id)) });
  });

  r.post("/applications/:id/memo", async (req, res) => {
    if (!llm) throw new ServiceUnavailableError("No language model configured (set LLM_PROVIDER)");
    const tenantId = getTenant(res).id;
    const app = await getApplication(repos, tenantId, id(req.params.id));
    if (!app.assessment) throw new InvalidTransitionError("Assess the application before writing a memo");
    const memo = await writeMemo(llm, app, app.assessment);
    const saved = await repos.applications.update(tenantId, app.id, { memo });
    res.json({ memo: saved.memo });
  });

  r.get("/applications/:id/transactions", async (req, res) => {
    const { category } = parseOrThrow(CategoryQuery, req.query);
    res.json(await transactionSummary(repos, getTenant(res).id, id(req.params.id), category));
  });

  return r;
}

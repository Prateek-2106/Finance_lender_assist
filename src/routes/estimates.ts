import { Router } from "express";
import type { Deps } from "../deps";
import { NotFoundError } from "../errors";
import { computeTotals } from "../lib/money";
import { renderInvoicePdf } from "../lib/invoicePdf";
import { getTenant, requireApiKey } from "../middleware/tenant";
import { EstimateCreateSchema, EstimatePatchSchema, EstimateTransitionSchema, parseOrThrow } from "../schemas";
import {
  convertToInvoice,
  createEstimate,
  payInvoice,
  transitionEstimate,
  updateLineItems,
  voidInvoice,
} from "../services/billing";
import type { Estimate } from "../domain";

const withTotals = (e: Estimate) => ({ ...e, totals: computeTotals(e.lineItems, e.taxRateBps) });

export function estimatesRouter({ repos }: Deps) {
  const r = Router();
  r.use(["/estimates", "/invoices"], requireApiKey);
  const id = (v: unknown) => String(v);

  r.post("/estimates", async (req, res) => {
    const input = parseOrThrow(EstimateCreateSchema, req.body);
    const e = await createEstimate(repos, getTenant(res), input);
    res.status(201).json({ estimate: withTotals(e) });
  });

  r.get("/estimates/:id", async (req, res) => {
    const e = await repos.estimates.findById(getTenant(res).id, id(req.params.id));
    if (!e) throw new NotFoundError("Estimate not found");
    res.json({ estimate: withTotals(e) });
  });

  r.patch("/estimates/:id", async (req, res) => {
    const { lineItems } = parseOrThrow(EstimatePatchSchema, req.body);
    const e = await updateLineItems(repos, getTenant(res).id, id(req.params.id), lineItems);
    res.json({ estimate: withTotals(e) });
  });

  r.post("/estimates/:id/transition", async (req, res) => {
    const { to } = parseOrThrow(EstimateTransitionSchema, req.body);
    const e = await transitionEstimate(repos, getTenant(res).id, id(req.params.id), to);
    res.json({ estimate: withTotals(e) });
  });

  r.post("/estimates/:id/invoice", async (req, res) => {
    const tenantId = getTenant(res).id;
    const existed = await repos.invoices.findByEstimate(tenantId, id(req.params.id));
    const invoice = await convertToInvoice(repos, tenantId, id(req.params.id));
    res.status(existed ? 200 : 201).json({ invoice });
  });

  r.get("/invoices/:id", async (req, res) => {
    const inv = await repos.invoices.findById(getTenant(res).id, id(req.params.id));
    if (!inv) throw new NotFoundError("Invoice not found");
    res.json({ invoice: inv });
  });

  r.post("/invoices/:id/pay", async (req, res) => {
    res.json(await payInvoice(repos, getTenant(res), id(req.params.id)));
  });

  r.post("/invoices/:id/void", async (req, res) => {
    res.json({ invoice: await voidInvoice(repos, getTenant(res).id, id(req.params.id)) });
  });

  r.get("/invoices/:id/pdf", async (req, res) => {
    const tenant = getTenant(res);
    const inv = await repos.invoices.findById(tenant.id, id(req.params.id));
    if (!inv) throw new NotFoundError("Invoice not found");
    const pdf = await renderInvoicePdf(inv, tenant);
    res.type("application/pdf").set("Content-Disposition", `inline; filename="${inv.number}.pdf"`).send(pdf);
  });

  return r;
}

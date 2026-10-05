import { Router, type Response } from "express";
import { z } from "zod";
import type { Deps } from "../deps";
import type { FundingApplication, FundingDecision } from "../domain";
import { ConflictStateError, InvalidTransitionError, NotFoundError, ServiceUnavailableError, ValidationError } from "../errors";
import { writeMemo } from "../ai/memo";
import { spendAiBudget } from "../services/aiBudget";
import { demoOnly, requireUnderwriter, underwriterName } from "../middleware/underwriter";
import { parseOrThrow } from "../schemas";
import { OFFER_TERMS, AFFORDABILITY } from "../risk/config";
import type { Offer } from "../risk/assess";
import { applicantView } from "../risk/applicantView";
import type { Notifier } from "../notify/notifier";

const DecisionSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("approve"),
    amountCents: z.number().int().positive(),
    factorRate: z.number().min(1.05).max(1.6).default(OFFER_TERMS.B.factorRate),
    termBusinessDays: z.number().int().min(40).max(260).default(OFFER_TERMS.B.termBusinessDays),
    note: z.string().trim().min(10, "Explain the decision in at least a sentence"),
  }),
  z.object({ outcome: z.literal("decline"), note: z.string().trim().min(10, "Explain the decision in at least a sentence") }),
]);

/** Platform-wide view for OPF-side staff: no tenant from the Host header, a named underwriter instead. */
export function underwritingRouter(deps: Deps, notifier: Notifier) {
  const { repos, llm } = deps;
  const r = Router();
  r.use(requireUnderwriter(deps));

  async function load(id: string, res: Response): Promise<FundingApplication> {
    const a = await repos.applications.findByIdAnyTenant(id);
    if (!a || (demoOnly(res) && !(await isDemo(a.tenantId)))) throw new NotFoundError("Application not found");
    return a;
  }
  const isDemo = async (tenantId: string) => !!(await repos.tenants.findById(tenantId))?.demo;
  /** Keeps what this underwriter may see: everything, or only demo businesses for the public demo key. */
  async function visible(list: FundingApplication[], res: Response) {
    if (!demoOnly(res)) return list;
    const flags = await Promise.all(list.map((a) => isDemo(a.tenantId)));
    return list.filter((_, i) => flags[i]);
  }
  const row = async (a: FundingApplication) => {
    const t = await repos.tenants.findById(a.tenantId);
    return {
      id: a.id,
      business: t?.name ?? "(deleted)",
      subdomain: t?.subdomain ?? null,
      industry: a.industry,
      amountRequestedCents: a.amountRequestedCents,
      engine: a.assessment ? { decision: a.assessment.decision, band: a.assessment.band, score: a.assessment.score } : null,
      decision: a.decision,
      waitingSince: a.decision?.at,
    };
  };

  r.get("/me", (_req, res) => {
    res.json({ name: underwriterName(res), demoOnly: demoOnly(res) });
  });

  r.get("/queue", async (_req, res) => {
    const n = demoOnly(res) ? 5 : 1; // demo key: read further back, since real cases are filtered out
    const [pending, approved, declined] = await Promise.all([
      repos.applications.listByOutcome("pending_review", { limit: 100 * n }).then((l) => visible(l, res)),
      repos.applications.listByOutcome("approved", { limit: 20 * n }).then((l) => visible(l, res)),
      repos.applications.listByOutcome("declined", { limit: 20 * n }).then((l) => visible(l, res)),
    ]);
    const recent = [...approved, ...declined].sort((x, y) => +new Date(y.decision!.at) - +new Date(x.decision!.at)).slice(0, 20);
    res.json({ pending: await Promise.all(pending.map(row)), recent: await Promise.all(recent.map(row)) });
  });

  r.get("/applications/:id", async (req, res) => {
    const a = await load(String(req.params.id), res);
    const tenant = await repos.tenants.findById(a.tenantId);
    // Platform revenue: what this business was actually paid through Vendor Street during the
    // statement period, next to what its bank shows. Context for the underwriter, not a score input.
    let platformRevenue = null;
    if (a.assessment) {
      const { from, to } = a.assessment.facts.period;
      const invoices = await repos.invoices.listByTenant(a.tenantId, { limit: 5000 });
      const paid = invoices.filter((i) => i.status === "paid" && i.paidAt && day(i.paidAt) >= from && day(i.paidAt) <= to);
      const paidCents = paid.reduce((s, i) => s + i.totals.totalCents, 0);
      const bankRevenueCents = Number(a.assessment.metrics.find((m) => m.id === "M1")!.inputs.revenueCents);
      platformRevenue = { period: { from, to }, paidInvoices: paid.length, paidCents, bankRevenueCents, shareOfBankRevenue: bankRevenueCents ? paidCents / bankRevenueCents : null };
    }
    res.json({ application: a, business: tenant ? { name: tenant.name, subdomain: tenant.subdomain } : null, platformRevenue, applicantView: applicantView(a) });
  });

  r.post("/applications/:id/memo", async (req, res) => {
    if (!llm) throw new ServiceUnavailableError("No language model configured (set LLM_PROVIDER)");
    const a = await load(String(req.params.id), res);
    if (!a.assessment) throw new InvalidTransitionError("Assess the application before writing a memo");
    await spendAiBudget(deps, a.tenantId);
    const memo = await writeMemo(llm, a, a.assessment);
    await repos.applications.update(a.tenantId, a.id, { memo });
    res.json({ memo });
  });

  r.post("/applications/:id/decision", async (req, res) => {
    const input = parseOrThrow(DecisionSchema, req.body);
    const a = await load(String(req.params.id), res);
    if (a.decision?.outcome !== "pending_review")
      throw new ConflictStateError(
        a.decision ? `Already ${a.decision.outcome} (${a.decision.decidedBy.kind === "underwriter" ? a.decision.decidedBy.name : "automatically"})` : "Not assessed yet",
      );
    const assessment = a.assessment!;
    let offer: Offer | null = null;
    if (input.outcome === "approve") {
      const m1 = Number(assessment.metrics.find((m) => m.id === "M1")!.value);
      const problems = [
        input.amountCents > a.amountRequestedCents && "more than the business asked for",
        input.amountCents > m1 && "more than one month of its revenue",
        input.amountCents % AFFORDABILITY.roundToCents !== 0 && "not a multiple of $500",
      ].filter(Boolean);
      if (problems.length) throw new ValidationError(`That amount is ${problems.join(" and ")}`);
      const payback = Math.round(input.amountCents * input.factorRate);
      offer = {
        amountCents: input.amountCents,
        factorRate: input.factorRate,
        paybackCents: payback,
        termBusinessDays: input.termBusinessDays,
        dailyPaymentCents: Math.ceil(payback / input.termBusinessDays),
        limitedBy: "underwriter",
        caps: { requestedCents: a.amountRequestedCents, revenueCents: m1, affordabilityCents: assessment.offer?.caps.affordabilityCents ?? 0 },
      };
    }
    const decision: FundingDecision = {
      outcome: input.outcome === "approve" ? "approved" : "declined",
      decidedBy: { kind: "underwriter", name: underwriterName(res) },
      at: new Date(),
      note: input.note,
      offer,
    };
    const saved = await repos.applications.update(a.tenantId, a.id, { decision, decisionLog: [...(a.decisionLog ?? []), decision] });
    void notifier.fundingDecision(saved);
    const holdback = offer ? (offer.dailyPaymentCents + assessment.facts.existingDailyLenderCents) / assessment.facts.avgDailyRevenueCents : null;
    res.json({ application: saved, applicantView: applicantView(saved), totalHoldbackOfDailyRevenue: holdback });
  });

  return r;
}

const day = (d: Date) => new Date(d).toISOString().slice(0, 10);

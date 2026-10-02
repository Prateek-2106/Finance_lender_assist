import { z } from "zod";
import type { LlmClient } from "../deps";
import type { FundingApplication } from "../domain";
import type { Assessment, Decision } from "../risk/assess";
import { completeJson } from "./json";

// Small local models drift on format: "M1, M7" instead of ["M1","M7"], "[M1]", "Review".
const Cites = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/[\s,]+/) : v),
  z.array(z.string().transform((x) => x.replace(/[\[\]]/g, "").trim())).transform((xs) => xs.filter(Boolean)),
).default([]);
const Claim = z.object({ text: z.string().min(1).max(600), cites: Cites });
export const MemoReplySchema = z.object({
  summary: Claim,
  strengths: z.array(Claim).max(8).default([]),
  risks: z.array(Claim).max(8).default([]),
  recommendation: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(["approve", "review", "decline"])),
});
type ClaimT = z.infer<typeof Claim>;

export interface MemoClaim {
  section: "summary" | "strengths" | "risks";
  text: string;
  cites: string[];
}

export interface Memo {
  model: string;
  generatedAt: Date;
  scorecardVersion: string;
  summary: MemoClaim | null;
  strengths: MemoClaim[];
  risks: MemoClaim[];
  engineDecision: Decision;
  modelRecommendation: Decision;
  disagreement: boolean; // the engine's decision stands either way
  dropped: (MemoClaim & { why: string })[];
}

const SYSTEM = `You are a small-business underwriting analyst writing a short internal memo.
Rules:
- Use ONLY the facts provided. Do not invent numbers, events or context.
- Every claim must cite the source ids it relies on in "cites", e.g. ["M1","M7"]. Valid ids are the metric ids (M1–M8), the knockout ids (K1, K2, …) and "OFFER".
- The summary states the engine's decision and its main reason, from engine.reasons.
- When a claim states a number, copy it exactly as shown in the cited source.
- Keep each claim to one or two sentences. Plain English, no hedging boilerplate.
Reply with only a JSON object:
{"summary":{"text":"...","cites":["M1"]},"strengths":[{"text":"...","cites":["..."]}],"risks":[{"text":"...","cites":["..."]}],"recommendation":"approve|review|decline"}`;

/**
 * The ONLY data the model sees. Built from an explicit whitelist so business
 * names, owner details, contact info and keys can never reach a prompt.
 */
export function memoFacts(app: FundingApplication, a: Assessment) {
  return {
    application: {
      industry: app.industry,
      amountRequested: usd(app.amountRequestedCents),
      statedMonthlyRevenue: usd(app.statedMonthlyRevenueCents),
      useOfFunds: app.useOfFunds,
    },
    statementPeriod: `${a.facts.period.from} to ${a.facts.period.to} (${a.facts.period.days} days)`,
    metrics: a.metrics.map((m) => ({ id: m.id, label: m.label, value: m.display })),
    engine: {
      decision: a.decision,
      score: a.score,
      band: a.band,
      ...(a.bandNote ? { bandNote: a.bandNote } : {}),
      knockouts: a.knockouts.map((k, i) => ({ id: `K${i + 1}`, message: k.message, metrics: k.metricIds })),
      reasons: a.reasons.map((r) => ({ text: r.text, metrics: r.metricIds })),
    },
    OFFER: a.offer
      ? {
          amount: usd(a.offer.amountCents),
          factorRate: a.offer.factorRate,
          payback: usd(a.offer.paybackCents),
          termBusinessDays: a.offer.termBusinessDays,
          dailyPayment: usd(a.offer.dailyPaymentCents),
          limitedBy: a.offer.limitedBy,
        }
      : "none",
  };
}

export function buildMemoPrompt(app: FundingApplication, a: Assessment): { system: string; prompt: string } {
  return { system: SYSTEM, prompt: `Facts (JSON):\n${JSON.stringify(memoFacts(app, a), null, 2)}\n\nWrite the memo.` };
}

const usd = (c: number) => `${c < 0 ? "-" : ""}$${Math.abs(Math.round(c / 100)).toLocaleString("en-US")}`;

/** Every number that appears anywhere in a source, in the forms a writer might use. */
function numbersIn(source: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number") out.push(v);
    else if (typeof v === "string") out.push(...extractNumbers(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(source);
  return out;
}

/** "$60,322" → 60322 · "22.2%" → 22.2 · "1.13×" → 1.13 · "-$1,326" → -1326 */
export function extractNumbers(text: string): number[] {
  return [...text.matchAll(/-?\$?\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/[$,]/g, "")));
}

/** Small counts and windows read naturally in prose ("3 months", "last 90 days") and are allowed anywhere. */
const ALWAYS_OK = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 30, 60, 90, 100]);

/**
 * A claimed number matches a source number if it equals it rounded to the precision
 * the writer used: "22%" or "22.2%" for 22.2 pass, "25%" does not. Sign is ignored
 * ("payments of $823" for a debit of -$823).
 */
function numbersMatch(claimed: number, allowed: number[]): boolean {
  if (ALWAYS_OK.has(Math.abs(claimed))) return true;
  const decimals = (String(Math.abs(claimed)).split(".")[1] ?? "").length;
  const f = 10 ** decimals;
  return allowed.some((a) => Math.round(Math.abs(a) * f) / f === Math.abs(claimed));
}

/** Checks each claim against the facts. Returns what to keep and what was dropped, with why. */
export function verifyMemo(app: FundingApplication, a: Assessment, reply: z.infer<typeof MemoReplySchema>, model: string, now = new Date()): Memo {
  const facts = memoFacts(app, a);
  const sources = new Map<string, unknown>(facts.metrics.map((m) => [m.id, m]));
  for (const k of facts.engine.knockouts) sources.set(k.id, k);
  sources.set("OFFER", facts.OFFER);
  // Engine statements (knockouts, reasons) are derived from metrics; a claim citing those
  // metrics may use their numbers too ("payments exceed 15% of daily revenue" citing M7, M1).
  const derived = [...facts.engine.knockouts, ...facts.engine.reasons];
  const numbersVia = (cites: string[]) => derived.filter((d) => d.metrics.some((id) => cites.includes(id))).flatMap((d) => numbersIn(d));
  const dropped: Memo["dropped"] = [];

  const check = (section: MemoClaim["section"], c: ClaimT): MemoClaim | null => {
    const cites = [...new Set(c.cites.map((x) => x.trim().toUpperCase()))];
    const claim = { section, text: c.text.trim(), cites };
    const unknown = cites.filter((id) => !sources.has(id));
    if (unknown.length) return void dropped.push({ ...claim, why: `cites unknown source ${unknown.join(", ")}` }), null;
    if (cites.length === 0) return void dropped.push({ ...claim, why: "no citation" }), null;
    if (cites.includes("OFFER") && facts.OFFER === "none") return void dropped.push({ ...claim, why: "cites an offer, but there is none" }), null;
    // numbers may also come from the application itself, which the model was shown
    const allowed = [...cites.flatMap((id) => numbersIn(sources.get(id))), ...numbersVia(cites), ...numbersIn(facts.application)];
    const bad = extractNumbers(claim.text).filter((n) => !numbersMatch(n, allowed));
    if (bad.length) return void dropped.push({ ...claim, why: `number(s) ${bad.join(", ")} not found in ${cites.join(", ")}` }), null;
    return claim;
  };

  const summary = check("summary", reply.summary);
  const strengths = reply.strengths.map((c) => check("strengths", c)).filter((c): c is MemoClaim => !!c);
  const risks = reply.risks.map((c) => check("risks", c)).filter((c): c is MemoClaim => !!c);
  return {
    model,
    generatedAt: now,
    scorecardVersion: a.scorecardVersion,
    summary,
    strengths,
    risks,
    engineDecision: a.decision,
    modelRecommendation: reply.recommendation,
    disagreement: reply.recommendation !== a.decision,
    dropped,
  };
}

export async function writeMemo(llm: LlmClient, app: FundingApplication, a: Assessment): Promise<Memo> {
  const reply = await completeJson(llm, buildMemoPrompt(app, a), MemoReplySchema);
  return verifyMemo(app, a, reply, llm.model);
}

import { useCallback, useEffect, useState } from "react";
import type { FundingApplication, FundingDecision } from "../../src/domain";
import type { ApplicantView } from "../../src/risk/applicantView";
import type { Memo } from "../../src/ai/memo";
import { estimatedApr } from "../../src/risk/apr";
import { api, day, dollars, money, pct, uwSession } from "../api";
import { ErrorText, Status } from "../ui/bits";
import { ApplicantCard } from "../ui/ApplicantCard";
import { MemoPanel } from "../ui/MemoPanel";
import { RiskBreakdown } from "../ui/RiskBreakdown";
import { useHash } from "../app/useHash";

type Row = {
  id: string;
  business: string;
  industry: string;
  amountRequestedCents: number;
  engine: { decision: string; band: string; score: number } | null;
  decision?: FundingDecision;
  waitingSince?: string;
};
type Detail = {
  application: FundingApplication;
  business: { name: string; subdomain: string } | null;
  platformRevenue: { period: { from: string; to: string }; paidInvoices: number; paidCents: number; bankRevenueCents: number; shareOfBankRevenue: number | null } | null;
  applicantView: ApplicantView;
};
const uw = <T,>(path: string, init: Parameters<typeof api>[1] = {}) => api<T>(`/underwriting${path}`, { ...init, as: "underwriter" });
const OUTCOME: Record<string, string> = { approved: "approve", declined: "decline", pending_review: "review" };

/** OPF-side staff: one queue across every business, and a named person on every hand decision. */
export function Console() {
  const [me, setMe] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [parts, go] = useHash();
  useEffect(() => {
    document.title = "Underwriting · Mainstreet";
    if (!uwSession.get()) return setChecked(true);
    uw<{ name: string }>("/me").then((r) => setMe(r.name), () => uwSession.clear()).finally(() => setChecked(true));
  }, []);
  if (!checked) return null;
  if (!me) return <SignIn onDone={setMe} />;
  return (
    <div className="shell">
      <aside className="rail">
        <div className="tenant">Underwriting</div>
        <nav aria-label="Sections"><a href="#/" aria-current="page">Review queue</a></nav>
        <div className="small quiet">Signed in as <strong style={{ color: "var(--ink)" }}>{me}</strong></div>
        <button className="secondary small" onClick={() => { uwSession.clear(); setMe(null); }}>Sign out</button>
      </aside>
      <main><Queue selected={parts[1]} go={go} /></main>
    </div>
  );
}

function SignIn({ onDone }: { onDone: (name: string) => void }) {
  const [error, setError] = useState<unknown>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    uwSession.set(String(new FormData(e.currentTarget).get("key") ?? "").trim());
    try {
      onDone((await uw<{ name: string }>("/me")).name);
    } catch (err) {
      uwSession.clear();
      setError(err);
    }
  }
  return (
    <div className="site">
      <header><h1>Underwriting</h1><p className="quiet">For Mainstreet staff who decide funding applications that need a person.</p></header>
      <form className="stack" onSubmit={submit}>
        <label>Underwriter key<input name="key" required autoComplete="off" spellCheck={false} /></label>
        <ErrorText error={error} />
        <div><button>Sign in</button></div>
      </form>
    </div>
  );
}

function Queue({ selected, go }: { selected?: string; go: (p: string) => void }) {
  const [q, setQ] = useState<{ pending: Row[]; recent: Row[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(() => uw<{ pending: Row[]; recent: Row[] }>("/queue").then(setQ, setError), []);
  useEffect(() => void reload(), [reload]);
  if (!q) return <ErrorText error={error} />;
  const table = (rows: Row[], pending: boolean) => (
    <table>
      <thead><tr><th>Business</th><th className="num">Asked for</th><th>{pending ? "Waiting since" : "Decision"}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={`clickable${r.id === selected ? " selected" : ""}`} onClick={() => go(`app/${r.id}`)}>
            <td>{r.business}<div className="quiet small">{r.industry}{r.engine ? `, band ${r.engine.band}, ${r.engine.score}` : ""}</div></td>
            <td className="num">{dollars(r.amountRequestedCents)}</td>
            <td className="small">
              {pending ? day(r.waitingSince!) : (
                <>
                  <Status value={OUTCOME[r.decision!.outcome]!} />
                  <div className="quiet">{r.decision!.decidedBy.kind === "underwriter" ? r.decision!.decidedBy.name : "Automatic"}</div>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <h2>Review queue</h2>
      <div className="split">
        <div className="stack">
          {q.pending.length ? table(q.pending, true) : <p className="empty">Nothing waiting. Every application so far was clear enough to decide automatically.</p>}
          {q.recent.length > 0 && (<><h3>Recently decided</h3>{table(q.recent, false)}</>)}
        </div>
        {selected ? <Case key={selected} id={selected} onDecided={reload} /> : <p className="empty">Choose an application. The oldest is at the top.</p>}
      </div>
    </>
  );
}

function Case({ id, onDecided }: { id: string; onDecided: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [memo, setMemo] = useState<Memo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => uw<Detail>(`/applications/${id}`).then((r) => { setD(r); setMemo(r.application.memo ?? null); }, setError), [id]);
  useEffect(() => void load(), [load]);
  if (!d) return <ErrorText error={error} />;
  const a = d.application;
  const writeMemo = async () => {
    setBusy("memo");
    setError(null);
    try { setMemo((await uw<{ memo: Memo }>(`/applications/${id}/memo`, { method: "POST" })).memo); } catch (err) { setError(err); } finally { setBusy(null); }
  };
  const pr = d.platformRevenue;
  return (
    <section className="panel" aria-label="Case">
      <div>
        <h3>{d.business?.name}: {dollars(a.amountRequestedCents)} for {a.useOfFunds.toLowerCase()}</h3>
        <p className="quiet small">{a.industry}, {a.monthsInBusiness} months in business, states {dollars(a.statedMonthlyRevenueCents)} a month</p>
      </div>
      {a.decision && (
        <p data-testid="current-decision">
          <Status value={OUTCOME[a.decision.outcome]!} />{" "}
          {a.decision.decidedBy.kind === "underwriter" ? `by ${a.decision.decidedBy.name}` : a.decision.outcome === "pending_review" ? "sent here by the scorecard" : "by the scorecard"} on {day(a.decision.at)}
          {a.decision.note ? `: "${a.decision.note}"` : ""}
        </p>
      )}
      {a.assessment && <RiskBreakdown a={a.assessment} />}
      {pr && (
        <div className="small" style={{ borderLeft: "3px solid var(--rule-strong)", paddingLeft: "0.75rem" }} data-testid="platform-revenue">
          <strong>Paid through Mainstreet</strong> during the statement period: {money(pr.paidCents)} from {pr.paidInvoices} invoice{pr.paidInvoices === 1 ? "" : "s"},
          {" "}{pr.shareOfBankRevenue === null ? "" : `${pct(pr.shareOfBankRevenue, 1)} of the ${dollars(pr.bankRevenueCents)} in sales the bank shows`}. Context only; not part of the score.
        </div>
      )}
      <div className="stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>AI memo</h3>
          <button className="secondary" disabled={!!busy || !a.assessment} onClick={writeMemo}>{busy === "memo" ? "Writing…" : memo ? "Rewrite memo" : "Write memo"}</button>
        </div>
        {memo ? <MemoPanel m={memo} /> : <p className="quiet small">A model summarises the metrics; every claim is checked against them before you see it.</p>}
      </div>
      <details>
        <summary>What the business sees</summary>
        <div style={{ marginTop: "0.75rem" }}><ApplicantCard v={d.applicantView} /></div>
      </details>
      <ErrorText error={error} />
      {a.decision?.outcome === "pending_review" && a.assessment && <DecisionForm d={d} onDone={() => { void load(); onDecided(); }} />}
      {(a.decisionLog?.length ?? 0) > 0 && (
        <details open={a.decision?.decidedBy.kind === "underwriter"}>
          <summary>Decision log</summary>
          <ul className="log" style={{ marginTop: "0.5rem" }}>
            {a.decisionLog!.map((x, i) => (
              <li key={i}>
                {new Date(x.at).toLocaleString("en-US")}: <Status value={OUTCOME[x.outcome]!} /> by {x.decidedBy.kind === "underwriter" ? x.decidedBy.name : `scorecard ${x.decidedBy.version}`}
                {x.offer ? `, ${dollars(x.offer.amountCents)} at ${x.offer.factorRate}` : ""}{x.note ? `: "${x.note}"` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function DecisionForm({ d, onDone }: { d: Detail; onDone: () => void }) {
  const a = d.application;
  const s = a.assessment!;
  const m1 = Number(s.metrics.find((m) => m.id === "M1")!.value);
  const suggested = Math.max(500_00, Math.floor(Math.min(s.offer?.amountCents ?? a.amountRequestedCents, m1 * 0.5) / 500_00) * 500_00);
  const [outcome, setOutcome] = useState<"approve" | "decline">("approve");
  const [amount, setAmount] = useState(String(suggested / 100));
  const [factor, setFactor] = useState("1.35");
  const [term, setTerm] = useState("100");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const cents = Math.round(Number(amount.replace(/[$,]/g, "")) * 100) || 0;
  const f = Number(factor) || 0;
  const t = Number(term) || 0;
  const payback = Math.round(cents * f);
  const daily = t ? Math.ceil(payback / t) : 0;
  const holdback = (daily + s.facts.existingDailyLenderCents) / s.facts.avgDailyRevenueCents;
  const apr = cents > 0 && daily > 0 && t > 0 ? estimatedApr(cents, daily, t) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await uw(`/applications/${a.id}/decision`, {
        method: "POST",
        json: outcome === "approve" ? { outcome, amountCents: cents, factorRate: f, termBusinessDays: t, note } : { outcome, note },
      });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="uw-form" onSubmit={submit} aria-label="Decision">
      <h3>Your decision</h3>
      <div className="row" role="radiogroup" aria-label="Outcome">
        <label className="row" style={{ gap: "0.4rem", fontWeight: 500 }}><input type="radio" name="o" style={{ width: "auto" }} checked={outcome === "approve"} onChange={() => setOutcome("approve")} />Approve</label>
        <label className="row" style={{ gap: "0.4rem", fontWeight: 500 }}><input type="radio" name="o" style={{ width: "auto" }} checked={outcome === "decline"} onChange={() => setOutcome("decline")} />Decline</label>
      </div>
      {outcome === "approve" && (
        <>
          <div className="row" style={{ alignItems: "stretch" }}>
            <label style={{ flex: 2 }}>Amount ($)<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></label>
            <label style={{ flex: 1 }}>Factor rate<input value={factor} onChange={(e) => setFactor(e.target.value)} inputMode="decimal" /></label>
            <label style={{ flex: 1 }}>Business days<input value={term} onChange={(e) => setTerm(e.target.value)} inputMode="numeric" /></label>
          </div>
          <p className="preview" data-testid="preview">
            Repays <strong>{money(payback)}</strong> at <strong>{money(daily)}</strong> a day. With existing lenders, repayments would take{" "}
            <strong style={{ color: holdback > 0.15 ? "var(--decline)" : "var(--ink)" }}>{pct(holdback)}</strong> of daily sales (policy: 15%).
            {apr !== null ? <> Estimated APR <strong>{Math.round(apr * 100)}%</strong>.</> : null}
          </p>
        </>
      )}
      <label>
        Note (the business will see this)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} required minLength={10} placeholder="Why, in a sentence or two." style={{ minHeight: "4.5rem" }} />
      </label>
      <ErrorText error={error} />
      <div><button disabled={busy} className={outcome === "decline" ? "danger" : undefined}>{busy ? "Saving…" : outcome === "approve" ? `Approve ${money(cents)}` : "Decline"}</button></div>
    </form>
  );
}

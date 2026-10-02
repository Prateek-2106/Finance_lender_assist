import { useCallback, useEffect, useState } from "react";
import type { FundingApplication } from "../../src/domain";
import type { Assessment } from "../../src/risk/assess";
import type { Memo } from "../../src/ai/memo";
import { api, day, dollars as money, money as exact } from "../api";
import { Cites, ErrorText, Status } from "../ui/bits";
import { ScoreStrip } from "../ui/ScoreStrip";

type ListItem = Omit<FundingApplication, "assessment" | "memo"> & { summary?: { decision: string; band: string; score: number } };

export function Funding({ selected, go }: { selected?: string; go: (path: string) => void }) {
  const [list, setList] = useState<ListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(() => api<{ applications: ListItem[] }>("/applications").then((r) => setList(r.applications), setError), []);
  useEffect(() => void reload(), [reload]);
  const creating = selected === "new";

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Funding</h2>
        {!creating && <button onClick={() => go("funding/new")}>New application</button>}
      </div>
      <ErrorText error={error} />
      <div className="split">
        <div>
          {list && list.length === 0 && <p className="empty">No applications yet. Start one to see what you could qualify for.</p>}
          {list && list.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th className="num">Requested</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} className={`clickable${a.id === selected ? " selected" : ""}`} onClick={() => go(`funding/${a.id}`)}>
                    <td>{day(a.createdAt)}<div className="quiet small">{a.industry}</div></td>
                    <td className="num">{money(a.amountRequestedCents)}</td>
                    <td>{a.summary ? <Status value={a.summary.decision} /> : <span className="quiet">Not assessed</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {creating ? (
          <NewApplication onCreated={(id) => { reload(); go(`funding/${id}`); }} />
        ) : selected ? (
          <ApplicationDetail key={selected} id={selected} onChange={reload} />
        ) : (
          list && list.length > 0 && <p className="empty">Choose an application to see its assessment.</p>
        )}
      </div>
    </>
  );
}

const dollarsToCents = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").replace(/[$,]/g, "")) * 100);

function NewApplication({ onCreated }: { onCreated: (id: string) => void }) {
  const [error, setError] = useState<unknown>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ application: FundingApplication }>("/applications", {
        method: "POST",
        json: {
          industry: f.get("industry"),
          monthsInBusiness: Number(f.get("months")),
          statedMonthlyRevenueCents: dollarsToCents(f.get("revenue")),
          amountRequestedCents: dollarsToCents(f.get("amount")),
          useOfFunds: f.get("use"),
        },
      });
      onCreated(r.application.id);
    } catch (err) {
      setError(err);
    }
  }
  return (
    <form className="panel" onSubmit={submit} aria-label="New application">
      <h3>New funding application</h3>
      <label>Industry<input name="industry" required placeholder="Auto repair" /></label>
      <div className="row" style={{ alignItems: "stretch" }}>
        <label style={{ flex: 1 }}>Months in business<input name="months" type="number" min="0" required /></label>
        <label style={{ flex: 1 }}>Monthly revenue ($)<input name="revenue" inputMode="decimal" required /></label>
      </div>
      <label>Amount requested ($)<input name="amount" inputMode="decimal" required /></label>
      <label>What it's for<input name="use" required placeholder="Working capital" /></label>
      <ErrorText error={error} />
      <div><button>Create application</button></div>
    </form>
  );
}

function ApplicationDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const [app, setApp] = useState<FundingApplication | null>(null);
  const [upload, setUpload] = useState<{ received: number; inserted: number; duplicates: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ application: FundingApplication }>(`/applications/${id}`).then((r) => setApp(r.application), setError);
  }, [id]);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }
  const sendStatement = (file: File) =>
    run("upload", async () => setUpload(await api(`/applications/${id}/statements`, { method: "POST", text: await file.text() })));
  const assess = () => run("assess", async () => setApp((await api<{ application: FundingApplication }>(`/applications/${id}/assess`, { method: "POST" })).application));
  const memo = () =>
    run("memo", async () => {
      const r = await api<{ memo: Memo }>(`/applications/${id}/memo`, { method: "POST" });
      setApp((a) => (a ? { ...a, memo: r.memo } : a));
    });

  if (!app) return <ErrorText error={error} />;
  return (
    <section className="panel" aria-label="Application">
      <div>
        <h3>{money(app.amountRequestedCents)} for {app.useOfFunds.toLowerCase()}</h3>
        <p className="quiet small">
          {app.industry}, {app.monthsInBusiness} months in business, states {money(app.statedMonthlyRevenueCents)} a month
        </p>
      </div>

      {app.status === "draft" && (
        <div className="stack">
          <label>
            Bank statement (CSV export, 3 to 6 months)
            <input type="file" accept=".csv,text/csv" disabled={!!busy} onChange={(e) => e.target.files?.[0] && sendStatement(e.target.files[0])} />
          </label>
          {upload && (
            <p role="status" className="small">
              Read {upload.received} transactions: {upload.inserted} new{upload.duplicates ? `, ${upload.duplicates} already uploaded` : ""}.
            </p>
          )}
        </div>
      )}
      <ErrorText error={error} />
      <div className="row">
        <button disabled={!!busy} onClick={assess}>{busy === "assess" ? "Assessing…" : app.assessment ? "Assess again" : "Assess"}</button>
        {app.assessment && (
          <button className="secondary" disabled={!!busy} onClick={memo}>{busy === "memo" ? "Writing memo…" : app.memo ? "Rewrite memo" : "Write memo"}</button>
        )}
      </div>

      {app.assessment && <RiskPanel a={app.assessment} />}
      {app.memo && <MemoPanel m={app.memo} />}
    </section>
  );
}

function RiskPanel({ a }: { a: Assessment }) {
  const pts = new Map(a.scoreLines.map((l) => [l.metricId, l]));
  return (
    <div className="stack" style={{ borderTop: "1px solid var(--rule)", paddingTop: "1rem" }}>
      <div className="decision">
        <span className={`big ${a.decision}`} data-testid="decision">{a.decision[0]!.toUpperCase() + a.decision.slice(1)}</span>
        <div>
          <div>Band {a.band}, score {a.score} of 100</div>
          {a.bandNote && <div className="quiet small">{a.bandNote}</div>}
        </div>
      </div>

      <ScoreStrip lines={a.scoreLines} metrics={a.metrics} score={a.score} />

      {a.offer ? (
        <p>
          Offer up to <strong>{money(a.offer.amountCents)}</strong>, repaid as {money(a.offer.paybackCents)} over {a.offer.termBusinessDays} business days
          ({exact(a.offer.dailyPaymentCents)} a day, factor {a.offer.factorRate}). Limited by {a.offer.limitedBy === "affordability" ? "what daily revenue can carry" : a.offer.limitedBy === "revenue" ? "monthly revenue" : "the amount requested"}.
        </p>
      ) : (
        <p className="quiet">No offer{a.decision === "review" ? " until an underwriter reviews it" : ""}.</p>
      )}

      {a.reasons.length > 0 && (
        <div>
          <h3 style={{ marginBottom: "0.4rem" }}>Why</h3>
          <ul className="reasons" data-testid="reasons">
            {a.reasons.map((r, i) => <li key={i}>{r.text}<Cites ids={r.metricIds} /></li>)}
          </ul>
        </div>
      )}

      <details>
        <summary>Metrics from the bank statement</summary>
        <table style={{ marginTop: "0.5rem" }}>
          <thead><tr><th>Id</th><th>Metric</th><th className="num">Value</th><th className="num">Points</th></tr></thead>
          <tbody>
            {a.metrics.map((m) => (
              <tr key={m.id}>
                <td>{m.id}</td>
                <td>{m.label}</td>
                <td className="num">{m.display}</td>
                <td className="num">{pts.get(m.id)!.points.toFixed(1)} / {pts.get(m.id)!.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="quiet small" style={{ marginTop: "0.5rem" }}>
          Statement {a.facts.period.from} to {a.facts.period.to}. Scorecard {a.scorecardVersion}.
        </p>
      </details>
    </div>
  );
}

function MemoPanel({ m }: { m: Memo }) {
  return (
    <div className="stack" style={{ borderTop: "1px solid var(--rule)", paddingTop: "1rem" }} data-testid="memo">
      <h3>Underwriting memo</h3>
      {m.disagreement && (
        <p className="error">
          The model recommended "{m.modelRecommendation}", but the engine's decision is "{m.engineDecision}". The engine's decision stands.
        </p>
      )}
      {m.summary && <p>{m.summary.text}<Cites ids={m.summary.cites} /></p>}
      {m.strengths.length > 0 && (
        <div><strong>Strengths</strong><ul className="reasons">{m.strengths.map((c, i) => <li key={i}>{c.text}<Cites ids={c.cites} /></li>)}</ul></div>
      )}
      {m.risks.length > 0 && (
        <div><strong>Risks</strong><ul className="reasons">{m.risks.map((c, i) => <li key={i}>{c.text}<Cites ids={c.cites} /></li>)}</ul></div>
      )}
      {m.dropped.length > 0 && (
        <details>
          <summary>{m.dropped.length} claim{m.dropped.length === 1 ? "" : "s"} removed by the fact check</summary>
          <ul className="reasons small" style={{ marginTop: "0.5rem" }}>
            {m.dropped.map((d, i) => <li key={i}>"{d.text}" <span className="quiet">({d.why})</span></li>)}
          </ul>
        </details>
      )}
      <p className="quiet small">Written by {m.model}, checked against scorecard {m.scorecardVersion}.</p>
    </div>
  );
}

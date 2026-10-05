import { useCallback, useEffect, useState } from "react";
import type { FundingApplication } from "../../src/domain";
import type { ApplicantView } from "../../src/risk/applicantView";
import { api, day, dollars as money } from "../api";
import { ErrorText, Status } from "../ui/bits";
import { ApplicantCard } from "../ui/ApplicantCard";
import { RiskBreakdown } from "../ui/RiskBreakdown";

type ListItem = Omit<FundingApplication, "assessment" | "memo" | "decisionLog">;
const OUTCOME_WORD: Record<string, string> = { approved: "approve", declined: "decline", pending_review: "review" };
const OUTCOME_LABEL: Record<string, string> = { approved: "Approved", declined: "Declined", pending_review: "Under review" };

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
        {!creating && <button onClick={() => go("funding/new")} data-tour="new-application">New application</button>}
      </div>
      <ErrorText error={error} />
      <div className="split">
        <div>
          {list && list.length === 0 && <p className="empty">No applications yet. Start one to see what your business could get.</p>}
          {list && list.length > 0 && (
            <table data-tour="funding-table">
              <thead><tr><th>Started</th><th className="num">Asked for</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} className={`clickable${a.id === selected ? " selected" : ""}`} onClick={() => go(`funding/${a.id}`)}>
                    <td>{day(a.createdAt)}<div className="quiet small">{a.industry}</div></td>
                    <td className="num">{money(a.amountRequestedCents)}</td>
                    <td>
                      {a.decision ? (
                        <span className={`status ${OUTCOME_WORD[a.decision.outcome]}`}>{OUTCOME_LABEL[a.decision.outcome]}</span>
                      ) : (
                        <span className="quiet">Needs a statement</span>
                      )}
                    </td>
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
          list && list.length > 0 && <p className="empty">Choose an application to see where it stands.</p>
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
      <h3>Apply for funding</h3>
      <p className="quiet small">We decide from your business bank statement. We don't ask for personal details like age or address.</p>
      <label>What kind of business is it?<input name="industry" required placeholder="Auto repair" /></label>
      <div className="row" style={{ alignItems: "stretch" }}>
        <label style={{ flex: 1 }}>Months in business<input name="months" type="number" min="0" required /></label>
        <label style={{ flex: 1 }}>Monthly sales ($)<input name="revenue" inputMode="decimal" required /></label>
      </div>
      <label>How much do you need ($)?<input name="amount" inputMode="decimal" required /></label>
      <label>What's it for?<input name="use" required placeholder="Working capital" /></label>
      <ErrorText error={error} />
      <div><button>Create application</button></div>
    </form>
  );
}

function ApplicationDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const [app, setApp] = useState<FundingApplication | null>(null);
  const [view, setView] = useState<ApplicantView | null>(null);
  const [upload, setUpload] = useState<{ received: number; inserted: number; duplicates: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const show = (r: { application: FundingApplication; applicantView: ApplicantView }) => {
    setApp(r.application);
    setView(r.applicantView);
  };
  useEffect(() => {
    api<{ application: FundingApplication; applicantView: ApplicantView }>(`/applications/${id}`).then(show, setError);
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
  const sendStatement = (file: File) => run("upload", async () => setUpload(await api(`/applications/${id}/statements`, { method: "POST", text: await file.text() })));
  const assess = () => run("assess", async () => show(await api(`/applications/${id}/assess`, { method: "POST" })));

  if (!app || !view) return <ErrorText error={error} />;
  return (
    <section className="panel" aria-label="Application">
      <div>
        <h3>{money(app.amountRequestedCents)} for {app.useOfFunds.toLowerCase()}</h3>
        <p className="quiet small">{app.industry}, {app.monthsInBusiness} months in business, about {money(app.statedMonthlyRevenueCents)} a month in sales</p>
      </div>

      <ApplicantCard v={view} />

      {app.status === "draft" && (
        <div className="stack">
          <label
            className={`dropzone${over ? " over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void sendStatement(f); }}
          >
            <strong>{busy === "upload" ? "Reading your statement…" : "Upload your bank statement"}</strong>
            <span className="quiet small">Drop a CSV export here, or click to choose one. 3 to 6 months works best.</span>
            <input type="file" accept=".csv,text/csv" aria-label="Bank statement CSV" disabled={!!busy} onChange={(e) => e.target.files?.[0] && sendStatement(e.target.files[0])} />
          </label>
          {upload && (
            <p role="status" className="small">
              Read {upload.received} transactions: {upload.inserted} new{upload.duplicates ? `, ${upload.duplicates} already uploaded` : ""}.
            </p>
          )}
        </div>
      )}
      <ErrorText error={error} />
      {!app.assessment && upload && (
        <div className="row">
          <button disabled={!!busy} onClick={assess}>{busy === "assess" ? "Checking…" : "See what I qualify for"}</button>
        </div>
      )}

      {app.assessment && (
        <details data-tour="how-decided">
          <summary>How we decided</summary>
          <div style={{ marginTop: "0.75rem" }}>
            <RiskBreakdown a={app.assessment} showEngineDecision={false} />
          </div>
        </details>
      )}
      {(app.decisionLog?.length ?? 0) > 1 && (
        <details>
          <summary>History</summary>
          <ul className="log" style={{ marginTop: "0.5rem" }}>
            {app.decisionLog!.map((d, i) => (
              <li key={i}>
                {day(d.at)}: <Status value={OUTCOME_WORD[d.outcome]!} /> {d.decidedBy.kind === "underwriter" ? `by ${d.decidedBy.name}` : "automatically"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

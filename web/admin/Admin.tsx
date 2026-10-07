// /admin: the platform owner's numbers. Who signed up, what they did, what the AI cost.
// Servers, errors and latency live in CloudWatch (linked at the bottom).
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Frame } from "../account/Account";
import { ErrorText } from "../ui/bits";

type Day = {
  day: string;
  signups: number;
  businesses: number;
  demos: number;
  leads: number;
  aiCalls: number;
  aiFailures: number;
  aiCostUsd: number;
  emailsSent: number;
  emailsFailed: number;
};
type Overview = {
  generatedAt: string;
  totals: { total: number; confirmed: number; real: number; demosLive: number };
  days: Day[];
  ai: { model: string | null; dailyLimit: number; period: { calls: number; failures: number; inputTokens: number; outputTokens: number; costUsd: number } };
  dashboardUrl: string | null;
};

const SERIES = [
  { key: "signups", label: "Sign-ups" },
  { key: "demos", label: "Demos" },
  { key: "businesses", label: "New businesses" },
  { key: "leads", label: "Requests" },
  { key: "aiCalls", label: "AI calls" },
  { key: "aiCostUsd", label: "AI cost" },
  { key: "emailsSent", label: "Emails" },
] as const;
type SeriesKey = (typeof SERIES)[number]["key"];

const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const fmt = (k: SeriesKey, n: number) => (k === "aiCostUsd" ? usd(n) : n.toLocaleString());
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const sum = (days: Day[], k: keyof Omit<Day, "day">) => days.reduce((a, d) => a + d[k], 0);

export function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [series, setSeries] = useState<SeriesKey>("signups");

  useEffect(() => {
    api<Overview>("/admin/overview").then(setData, (err) => {
      if (err instanceof ApiError && err.status === 401) location.replace("/signin?next=/admin");
      else setError(err);
    });
  }, []);

  if (!data) return <Frame title="Platform" wide><ErrorText error={error} /></Frame>;
  const { totals, days, ai } = data;
  const label = SERIES.find((s) => s.key === series)!.label;
  const peak = Math.max(...days.map((d) => d[series]), 0);
  const failedEmails = sum(days, "emailsFailed");

  return (
    <Frame title="Platform" wide>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <p className="quiet small">Last 14 days, UTC. Demo businesses and their sample requests are left out of business and request counts.</p>
        <a className="small" href="/account">Your businesses</a>
      </div>

      <div className="kpis" data-testid="admin-kpis">
        <div className="kpi"><div className="v">{totals.confirmed}</div><div className="l">Confirmed accounts{totals.total > totals.confirmed ? ` (${totals.total - totals.confirmed} unconfirmed)` : ""}</div></div>
        <div className="kpi"><div className="v">{totals.real}</div><div className="l">Real businesses, {totals.demosLive} demo{totals.demosLive === 1 ? "" : "s"} live</div></div>
        <div className="kpi"><div className="v">{usd(ai.period.costUsd)}</div><div className="l">AI spend, {ai.period.calls} call{ai.period.calls === 1 ? "" : "s"}</div></div>
        <div className="kpi"><div className="v">{sum(days, "emailsSent")}</div><div className="l">Emails sent{failedEmails ? `, ${failedEmails} failed` : ""}</div></div>
      </div>

      <section className="panel" aria-label="Activity by day">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>{label} by day</h3>
          <div className="seg" role="group" aria-label="Show">
            {SERIES.map((s) => (
              <button key={s.key} className={s.key === series ? "small" : "secondary small"} aria-pressed={s.key === series} onClick={() => setSeries(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {peak === 0 ? (
          <p className="empty">No {label.toLowerCase()} in the last 14 days.</p>
        ) : (
          <>
            <div className="bars" role="img" aria-label={`${label} by day: ${days.map((d) => `${dayLabel(d.day)} ${fmt(series, d[series])}`).join(", ")}`}>
              {days.map((d) => (
                <div key={d.day} className="bar" tabIndex={0} style={{ height: `${(d[series] / peak) * 100}%` }}>
                  <span className="tip">{dayLabel(d.day)}: {fmt(series, d[series])}</span>
                </div>
              ))}
            </div>
            <div className="bar-labels" aria-hidden="true">{days.map((d, i) => <span key={d.day}>{(days.length - 1 - i) % 2 === 0 ? dayLabel(d.day) : ""}</span>)}</div>
          </>
        )}
        <details>
          <summary className="small">Every day, as a table</summary>
          <div className="table-wrap">
            <table style={{ marginTop: "0.5rem" }} data-testid="admin-days">
              <thead>
                <tr><th>Day</th><th className="num">Sign-ups</th><th className="num">Demos</th><th className="num">Businesses</th><th className="num">Requests</th><th className="num">AI calls</th><th className="num">AI cost</th><th className="num">Emails</th><th className="num">Failed</th></tr>
              </thead>
              <tbody>
                {[...days].reverse().map((d) => (
                  <tr key={d.day}>
                    <td>{dayLabel(d.day)}</td><td className="num">{d.signups}</td><td className="num">{d.demos}</td><td className="num">{d.businesses}</td><td className="num">{d.leads}</td>
                    <td className="num">{d.aiCalls}{d.aiFailures ? ` (${d.aiFailures} failed)` : ""}</td><td className="num">{usd(d.aiCostUsd)}</td><td className="num">{d.emailsSent}</td><td className="num">{d.emailsFailed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="panel" aria-label="AI usage">
        <h3>AI usage</h3>
        <dl className="facts">
          <dt>Model</dt><dd>{ai.model ?? "none configured"}</dd>
          <dt>Calls</dt><dd>{ai.period.calls.toLocaleString()}{ai.period.failures ? `, ${ai.period.failures} failed` : ""}</dd>
          <dt>Tokens</dt><dd>{ai.period.inputTokens.toLocaleString()} in, {ai.period.outputTokens.toLocaleString()} out</dd>
          <dt>Cost</dt><dd>{usd(ai.period.costUsd)}{ai.period.calls ? `, about ${usd(ai.period.costUsd / ai.period.calls)} a call` : ""}</dd>
          <dt>Daily cap</dt><dd>{ai.dailyLimit} calls across every business; today {days.at(-1)!.aiCalls}</dd>
        </dl>
      </section>

      <section className="panel" aria-label="Servers">
        <h3>Servers</h3>
        <p className="quiet">
          Requests, errors, response times and alarms are in CloudWatch. Alarms email you when errors spike, pages slow down, AI spend jumps, email fails or the site stops answering.
        </p>
        {data.dashboardUrl && <div><a className="button secondary" href={data.dashboardUrl} target="_blank" rel="noreferrer">Open the CloudWatch dashboard</a></div>}
      </section>
    </Frame>
  );
}

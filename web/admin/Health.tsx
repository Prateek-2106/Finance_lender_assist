// /admin/health: is the server healthy right now, and where is the time going?
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Frame } from "../account/Account";
import { ErrorText } from "../ui/bits";
import { MiniChart } from "../ui/MiniChart";

type Stat = { key: string; count: number; errors: number; p50: number; p95: number; p99: number; max: number; avg: number; avgDbMs?: number; dbCallsPerRequest?: number; dbShare?: number };
type Vitals = { cpuPercent: number; heapUsedMb: number; rssMb: number; loopP99Ms: number; loopMeanMs: number };
type Snapshot = {
  generatedAt: string;
  minutes: number;
  database: { ok: boolean; ms: number; error?: string };
  process: { startedAt: string; uptimeSeconds: number; node: string; heapUsedMb: number; rssMb: number; cpuPercent?: number; loopP99Ms?: number; vitalsOn: boolean };
  totals: { requests: number; requestsPerMinute: number; errors: number; errorRate: number; p50: number; p95: number; p99: number; dbP95: number; dbCalls: number };
  routes: Stat[];
  db: Stat[];
  external: Stat[];
  series: { t: string; requests: number; errors: number; p95: number; dbP95: number; dbCalls: number; vitals?: Vitals }[];
};

/** What "healthy" means here. Same lines as the CloudWatch alarms where they overlap. */
export const LIMITS = { p95Ms: 1500, errorRate: 0.01, loopP99Ms: 200, dbP95Ms: 250 };

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)} s` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
const pctText = (v: number) => `${(v * 100).toFixed(v && v < 0.01 ? 2 : 1)}%`;
const count = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));
const uptime = (s: number) => (s >= 86_400 ? `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h` : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min`);

export function status(s: Snapshot): { level: "healthy" | "degraded" | "down"; reasons: string[] } {
  const reasons: string[] = [];
  if (!s.database.ok) return { level: "down", reasons: [`The database isn't answering (${s.database.error ?? "no reply"})`] };
  if (s.totals.requests >= 20 && s.totals.errorRate > LIMITS.errorRate) reasons.push(`${pctText(s.totals.errorRate)} of requests failed (limit ${pctText(LIMITS.errorRate)})`);
  if (s.totals.requests >= 20 && s.totals.p95 > LIMITS.p95Ms) reasons.push(`95% of responses took up to ${ms(s.totals.p95)} (limit ${ms(LIMITS.p95Ms)})`);
  if (s.totals.dbCalls >= 20 && s.totals.dbP95 > LIMITS.dbP95Ms) reasons.push(`Database operations are slow: p95 ${ms(s.totals.dbP95)} (limit ${ms(LIMITS.dbP95Ms)})`);
  if ((s.process.loopP99Ms ?? 0) > LIMITS.loopP99Ms) reasons.push(`The server is overloaded: work waits up to ${ms(s.process.loopP99Ms!)} to start`);
  return { level: reasons.length ? "degraded" : "healthy", reasons };
}

const WINDOWS = [5, 15, 60];

export function HealthPage() {
  const [minutes, setMinutes] = useState(15);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [paused, setPaused] = useState(false);

  const load = useCallback(
    () =>
      api<Snapshot>(`/admin/health?minutes=${minutes}`).then(
        (r) => {
          setData(r);
          setError(null);
        },
        (err) => {
          if (err instanceof ApiError && err.status === 401) location.replace("/signin?next=/admin/health");
          else setError(err);
        },
      ),
    [minutes],
  );
  useEffect(() => {
    void load();
    if (paused) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load, paused]);

  if (!data) return <Frame title="System health" wide><ErrorText error={error} /></Frame>;
  const s = data;
  const st = status(s);
  const vit = s.series.map((p) => p.vitals);

  return (
    <Frame title="System health" wide>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <nav className="seg" aria-label="Admin pages">
          <a className="button secondary small" href="/admin">Platform numbers</a>
          <a className="button small" href="/admin/health" aria-current="page">System health</a>
        </nav>
        <div className="row">
          <div className="seg" role="group" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button key={w} className={w === minutes ? "small" : "secondary small"} aria-pressed={w === minutes} onClick={() => setMinutes(w)}>
                {w === 60 ? "1 hour" : `${w} min`}
              </button>
            ))}
          </div>
          <button className="secondary small" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>
      <p className="quiet small">
        This server, the last {minutes} minutes. {paused ? "Paused" : "Updates every 10 seconds"}; last at {new Date(s.generatedAt).toLocaleTimeString()}. It starts over when the
        server restarts (each deploy); CloudWatch keeps the long-term history.
      </p>
      <ErrorText error={error} />

      <section className={`health-status ${st.level}`} role="status" aria-label="Overall status" data-testid="health-status">
        <span className="health-icon" aria-hidden="true">{st.level === "healthy" ? "✓" : st.level === "degraded" ? "!" : "×"}</span>
        <div>
          <strong>{st.level === "healthy" ? "Healthy" : st.level === "degraded" ? "Degraded" : "Down"}</strong>
          {st.reasons.length ? (
            <ul>{st.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          ) : (
            <p className="small">Everything is answering within its limits.</p>
          )}
        </div>
      </section>

      <div className="kpis health-kpis" data-testid="health-kpis">
        <Tile label="Requests" value={`${count(s.totals.requestsPerMinute)}/min`} note={`${s.totals.requests.toLocaleString()} in ${minutes} min`} />
        <Tile label="Failed requests" value={pctText(s.totals.errorRate)} note={`${s.totals.errors} answered with a server error`} />
        <Tile label="Response time, p95" value={ms(s.totals.p95)} note={`median ${ms(s.totals.p50)}, p99 ${ms(s.totals.p99)}`} />
        <Tile label="Database operation, p95" value={ms(s.totals.dbP95)} note={`${s.totals.dbCalls.toLocaleString()} operations; ping ${s.database.ok ? ms(s.database.ms) : "failed"}`} />
        <Tile label="Event-loop delay, p99" value={s.process.loopP99Ms === undefined ? "n/a" : ms(s.process.loopP99Ms)} note="How long work waits for the CPU" />
        <Tile label="CPU" value={s.process.cpuPercent === undefined ? "n/a" : `${s.process.cpuPercent}%`} note="Last minute, this process" />
        <Tile label="Memory" value={`${Math.round(s.process.heapUsedMb)} MB`} note={`heap in use; ${Math.round(s.process.rssMb)} MB total`} />
        <Tile label="Up for" value={uptime(s.process.uptimeSeconds)} note={`Node ${s.process.node}`} />
      </div>

      <section className="health-charts" aria-label="Over time">
        <MiniChart title="Requests per minute" kind="columns" points={s.series.map((p) => ({ t: p.t, v: p.requests }))} format={count} />
        <MiniChart title="Response time, p95" points={s.series.map((p) => ({ t: p.t, v: p.requests ? p.p95 : null }))} format={ms} threshold={{ value: LIMITS.p95Ms, label: "limit" }} />
        <MiniChart title="Database operation, p95" points={s.series.map((p) => ({ t: p.t, v: p.dbCalls ? p.dbP95 : null }))} format={ms} />
        <MiniChart title="Server errors per minute" kind="columns" color="var(--decline)" points={s.series.map((p) => ({ t: p.t, v: p.errors }))} format={count} />
        {vit.some(Boolean) && (
          <>
            <MiniChart title="CPU" points={s.series.map((p) => ({ t: p.t, v: p.vitals?.cpuPercent ?? null }))} format={(v) => `${Math.round(v)}%`} />
            <MiniChart title="Event-loop delay, p99" points={s.series.map((p) => ({ t: p.t, v: p.vitals?.loopP99Ms ?? null }))} format={ms} />
          </>
        )}
      </section>

      <StatTable
        title="Routes"
        caption="Every route by how much total time it takes. Database share: how much of each response was waiting on the database."
        rows={s.routes}
        testId="health-routes"
        route
        empty="No requests in this window."
      />
      <StatTable title="Database operations" caption="Each repository call, e.g. leads.listByTenant reads one business's requests." rows={s.db} testId="health-db" empty="No database operations in this window." />
      <StatTable title="Outside calls" caption="The language model, email, DNS lookups, and database pings." rows={s.external} testId="health-external" empty="No outside calls in this window." />
    </Frame>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="kpi">
      <div className="v">{value}</div>
      <div className="l"><strong>{label}</strong><br />{note}</div>
    </div>
  );
}

function StatTable({ title, caption, rows, route, testId, empty }: { title: string; caption: string; rows: Stat[]; route?: boolean; testId: string; empty: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <section className="panel" aria-label={title}>
      <div>
        <h3>{title}</h3>
        <p className="quiet small">{caption}</p>
      </div>
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <>
          <table className="cards health-table" data-testid={testId}>
            <thead>
              <tr>
                <th>{route ? "Route" : "Operation"}</th>
                <th className="num">Calls</th>
                <th className="num">Failed</th>
                <th className="num">p50</th>
                <th className="num">p95</th>
                <th className="num">p99</th>
                {route ? <th className="num">Database share</th> : <th className="num">Slowest</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className={r.p95 > LIMITS.p95Ms || r.errors ? "warn" : undefined}>
                  <td><code>{r.key}</code></td>
                  <td className="num" data-label="Calls">{r.count.toLocaleString()}</td>
                  <td className="num" data-label="Failed">{r.errors ? <span className="status declined">{r.errors}</span> : 0}</td>
                  <td className="num" data-label="p50">{ms(r.p50)}</td>
                  <td className="num" data-label="p95">{ms(r.p95)}</td>
                  <td className="num" data-label="p99">{ms(r.p99)}</td>
                  {route ? (
                    <td className="num" data-label="Database share" title={`${ms(r.avgDbMs ?? 0)} in ${r.dbCallsPerRequest ?? 0} operations on average`}>
                      {Math.round((r.dbShare ?? 0) * 100)}% <span className="quiet small">({r.dbCallsPerRequest} ops)</span>
                    </td>
                  ) : (
                    <td className="num" data-label="Slowest">{ms(r.max)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 12 && <div><button className="secondary small" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${rows.length}`}</button></div>}
        </>
      )}
    </section>
  );
}

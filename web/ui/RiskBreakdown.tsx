import type { Assessment } from "../../src/risk/assess";
import { Cites } from "./bits";
import { ScoreStrip } from "./ScoreStrip";

/** How the scorecard reached its answer: the strip, the reasons with metric ids, and every metric's inputs. */
export function RiskBreakdown({ a, showEngineDecision = true }: { a: Assessment; showEngineDecision?: boolean }) {
  const pts = new Map(a.scoreLines.map((l) => [l.metricId, l]));
  return (
    <div className="stack">
      {showEngineDecision && (
        <div className="decision">
          <span className={`big ${a.decision}`} data-testid="engine-decision">{a.decision[0]!.toUpperCase() + a.decision.slice(1)}</span>
          <div>
            <div>Band {a.band}, score {a.score} of 100</div>
            {a.bandNote && <div className="quiet small">{a.bandNote}</div>}
          </div>
        </div>
      )}
      <div className="strip-head">
        <span className="small quiet">Score {a.score} of 100, band {a.band}</span>
        <a href="/scoring" target="_blank" rel="noopener" className="small" data-tour="how-scored">How is this scored? →</a>
      </div>
      <ScoreStrip lines={a.scoreLines} metrics={a.metrics} score={a.score} />
      {a.reasons.length > 0 && (
        <ul className="reasons" data-testid="reasons">
          {a.reasons.map((r, i) => (
            <li key={i}>{r.text}<Cites ids={r.metricIds} /></li>
          ))}
        </ul>
      )}
      <details>
        <summary>All 8 measures from the bank statement</summary>
        <table className="cards" style={{ marginTop: "0.5rem" }}>
          <thead><tr><th>Id</th><th>Measure</th><th className="num">Value</th><th className="num">Points</th></tr></thead>
          <tbody>
            {a.metrics.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.id}</strong></td>
                <td data-label="Measure">{m.label}</td>
                <td className="num" data-label="Value">{m.display}</td>
                <td className="num" data-label="Points">{pts.get(m.id)!.points.toFixed(1)} / {pts.get(m.id)!.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="quiet small" style={{ marginTop: "0.5rem" }}>Statement {a.facts.period.from} to {a.facts.period.to}. Scorecard {a.scorecardVersion}.</p>
      </details>
    </div>
  );
}

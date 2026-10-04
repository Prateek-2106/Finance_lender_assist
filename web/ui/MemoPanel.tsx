import type { Memo } from "../../src/ai/memo";
import { Cites } from "./bits";

export function MemoPanel({ m }: { m: Memo }) {
  return (
    <div className="stack" data-testid="memo">
      {m.disagreement && (
        <p className="error">The model recommended "{m.modelRecommendation}", but the scorecard says "{m.engineDecision}". Weigh both; the model can't decide.</p>
      )}
      {m.summary && <p>{m.summary.text}<Cites ids={m.summary.cites} /></p>}
      {m.strengths.length > 0 && <div><strong>Strengths</strong><ul className="reasons">{m.strengths.map((c, i) => <li key={i}>{c.text}<Cites ids={c.cites} /></li>)}</ul></div>}
      {m.risks.length > 0 && <div><strong>Risks</strong><ul className="reasons">{m.risks.map((c, i) => <li key={i}>{c.text}<Cites ids={c.cites} /></li>)}</ul></div>}
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

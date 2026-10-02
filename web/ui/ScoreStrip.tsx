import type { ScoreLine } from "../../src/risk/assess";
import type { Metric } from "../../src/risk/metrics";

/**
 * One 100-point bar split into the scorecard's weights. Each segment fills to what
 * that metric earned, so the points a business lost are visible before any reading.
 * Segments under the red-flag line are hatched.
 */
export function ScoreStrip({ lines, metrics, score, flagBelow = 0.3 }: { lines: ScoreLine[]; metrics: Metric[]; score: number; flagBelow?: number }) {
  const label = (id: string) => metrics.find((m) => m.id === id)?.label ?? id;
  const summary = lines.map((l) => `${l.metricId} ${label(l.metricId)}: ${l.points.toFixed(1)} of ${l.weight}`).join("; ");
  return (
    <div className="strip">
      <div className="strip-bar" role="img" aria-label={`Score ${score} of 100. ${summary}`}>
        {lines.map((l) => (
          <div
            key={l.metricId}
            className={`strip-seg${l.fraction < flagBelow ? " flag" : ""}`}
            style={{ width: `${l.weight}%` }}
            title={`${l.metricId} ${label(l.metricId)}: ${l.points.toFixed(1)} of ${l.weight} points`}
            data-testid={`seg-${l.metricId}`}
            data-fraction={l.fraction.toFixed(2)}
          >
            <div className="strip-fill" style={{ width: `${Math.round(l.fraction * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="strip-labels quiet" aria-hidden="true">
        {lines.map((l) => (
          <span key={l.metricId} style={{ width: `${l.weight}%` }}>
            {l.metricId}
          </span>
        ))}
      </div>
      <p className="strip-key">
        Each segment is one metric's share of the 100 points; the dark part is what it earned. Hatched segments earned under {Math.round(flagBelow * 100)}%.
      </p>
    </div>
  );
}

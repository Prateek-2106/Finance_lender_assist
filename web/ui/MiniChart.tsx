// One measure over time, one axis: a 2px line (or columns), hairline grid, a crosshair that snaps
// to the nearest minute, and a tooltip. Small multiples instead of two lines on two scales.
import { useId, useRef, useState } from "react";

export interface Point {
  t: string; // ISO time
  v: number | null; // null: nothing measured that minute
}

const W = 320;
const H = 120;
const PAD = { l: 36, r: 8, t: 8, b: 20 };

/** 0, then 1/2/5 × 10^n steps up to the peak. */
function ticks(max: number) {
  if (max <= 0) return [0, 1];
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw)!;
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1000) / 1000);
  if (out.at(-1)! < max) out.push(Math.round((out.at(-1)! + step) * 1000) / 1000);
  return out;
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function MiniChart({
  title,
  points,
  format,
  kind = "line",
  color = "var(--action)",
  threshold,
}: {
  title: string;
  points: Point[];
  format: (v: number) => string;
  kind?: "line" | "columns";
  color?: string;
  threshold?: { value: number; label: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const id = useId();
  const values = points.map((p) => p.v ?? 0);
  const peak = Math.max(...values);
  // Draw the limit only when the data comes near it; otherwise it would flatten the line to nothing
  const showLimit = !!threshold && peak >= threshold.value * 0.4;
  const yt = ticks(Math.max(peak, showLimit ? threshold!.value : 0));
  const top = yt.at(-1)!;
  const n = points.length;
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const step = n > 1 ? (W - PAD.l - PAD.r) / (n - 1) : W - PAD.l - PAD.r;
  const barW = Math.max(2, Math.min(24, step - 2));

  // Line breaks where nothing was measured, instead of inventing zeros
  const segments: string[] = [];
  let d = "";
  points.forEach((p, i) => {
    if (p.v === null) {
      if (d) segments.push(d);
      d = "";
    } else d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
  });
  if (d) segments.push(d);

  const onMove = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1)))));
  };
  const h = hover === null ? null : points[hover]!;
  const last = [...points].reverse().find((p) => p.v !== null);

  return (
    <figure className="mini-chart" aria-labelledby={`${id}-t`}>
      <figcaption id={`${id}-t`}>
        <span>
          {title}
          {threshold && !showLimit && <span className="quiet"> · limit {format(threshold.value)}</span>}
        </span>
        <span className="mini-chart-now">{last ? format(last.v!) : "no data"}</span>
      </figcaption>
      <div className="mini-chart-plot">
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`${title}, last ${n} minutes. Latest ${last ? format(last.v!) : "no data"}; highest ${format(Math.max(...values))}.`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((i) => Math.max(0, (i ?? n) - 1));
            if (e.key === "ArrowRight") setHover((i) => Math.min(n - 1, (i ?? -1) + 1));
          }}
          onBlur={() => setHover(null)}
        >
          {yt.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
              <text x={PAD.l - 4} y={y(v)} className="tick" textAnchor="end" dominantBaseline="middle">{format(v)}</text>
            </g>
          ))}
          {n > 0 && <text x={PAD.l} y={H - 4} className="tick">{hhmm(points[0]!.t)}</text>}
          {n > 1 && <text x={W - PAD.r} y={H - 4} className="tick" textAnchor="end">{hhmm(points[n - 1]!.t)}</text>}
          {showLimit && threshold && (
            <g>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(threshold.value)} y2={y(threshold.value)} className="threshold" />
              <text x={W - PAD.r} y={y(threshold.value) - 3} className="tick" textAnchor="end">{threshold.label}</text>
            </g>
          )}
          {kind === "columns"
            ? points.map((p, i) =>
                p.v ? (
                  <path
                    key={p.t}
                    d={`M${x(i) - barW / 2},${y(0)} V${y(p.v) + Math.min(4, y(0) - y(p.v))} q0,-4 4,-4 H${x(i) + barW / 2 - 4} q4,0 4,4 V${y(0)} Z`}
                    fill={color}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                ) : null,
              )
            : segments.map((s) => <path key={s} d={s} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
          {h && (
            <g>
              <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={H - PAD.b} className="crosshair" />
              {kind === "line" && h.v !== null && <circle cx={x(hover!)} cy={y(h.v)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />}
            </g>
          )}
        </svg>
        {h && (
          <div className="mini-chart-tip" role="status" style={{ left: `${Math.min(80, Math.max(20, (x(hover!) / W) * 100))}%` }}>
            <strong>{h.v === null ? "no data" : format(h.v)}</strong> at {hhmm(h.t)}
          </div>
        )}
      </div>
    </figure>
  );
}

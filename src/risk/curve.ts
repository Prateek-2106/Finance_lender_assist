import type { Curve } from "./config";

/** Linear interpolation between points; flat beyond the ends. */
export function evalCurve(curve: Curve, x: number): number {
  const first = curve[0]!;
  const last = curve.at(-1)!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]!;
    const [x0, y0] = curve[i - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

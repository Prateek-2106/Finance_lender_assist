import { evalCurve } from "../../src/risk/curve";

describe("evalCurve", () => {
  const up = [[0, 0], [10, 0.5], [20, 1]] as const;
  const down = [[0, 1], [10, 0]] as const;
  it("interpolates linearly between points", () => {
    expect(evalCurve(up, 5)).toBeCloseTo(0.25);
    expect(evalCurve(up, 15)).toBeCloseTo(0.75);
    expect(evalCurve(down, 2.5)).toBeCloseTo(0.75);
  });
  it("hits points exactly and is flat beyond the ends", () => {
    expect(evalCurve(up, 10)).toBe(0.5);
    expect(evalCurve(up, -100)).toBe(0);
    expect(evalCurve(up, 1e9)).toBe(1);
  });
});

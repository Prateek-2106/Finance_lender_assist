// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { ScoreStrip } from "../../web/ui/ScoreStrip";
import type { ScoreLine } from "../../src/risk/assess";
import type { Metric } from "../../src/risk/metrics";

const lines: ScoreLine[] = [
  { metricId: "M1", key: "trueMonthlyRevenue", weight: 60, fraction: 0.5, points: 30 },
  { metricId: "M7", key: "debtLoad", weight: 40, fraction: 0, points: 0 },
];
const metrics = [
  { id: "M1", key: "trueMonthlyRevenue", label: "True monthly revenue" },
  { id: "M7", key: "debtLoad", label: "Existing debt load" },
] as Metric[];

describe("ScoreStrip", () => {
  it("sizes segments by weight and fills them by what they earned", () => {
    render(<ScoreStrip lines={lines} metrics={metrics} score={30} />);
    const m1 = screen.getByTestId("seg-M1");
    expect(m1.style.width).toBe("60%");
    expect((m1.firstChild as HTMLElement).style.width).toBe("50%");
  });
  it("hatches red-flag segments", () => {
    render(<ScoreStrip lines={lines} metrics={metrics} score={30} />);
    expect(screen.getByTestId("seg-M7").className).toContain("flag");
    expect(screen.getByTestId("seg-M1").className).not.toContain("flag");
  });
  it("describes the whole strip to screen readers", () => {
    render(<ScoreStrip lines={lines} metrics={metrics} score={30} />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Score 30 of 100. M1 True monthly revenue: 30.0 of 60; M7 Existing debt load: 0.0 of 40",
    );
  });
});

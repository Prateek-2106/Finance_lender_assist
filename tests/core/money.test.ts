import { lineTotalCents, computeTotals, formatUSD } from "../../src/lib/money";

describe("lineTotalCents", () => {
  it("multiplies quantity by unit price", () => {
    expect(lineTotalCents({ description: "x", quantity: 3, unitPriceCents: 1999 })).toBe(5997);
  });
  it("rounds fractional quantities half-up to the cent", () => {
    // 1.5 h × $85.33 = $127.995 → $128.00
    expect(lineTotalCents({ description: "labor", quantity: 1.5, unitPriceCents: 8533 })).toBe(12800);
    // 0.333 × 100 = 33.3 → 33
    expect(lineTotalCents({ description: "x", quantity: 0.333, unitPriceCents: 100 })).toBe(33);
  });
  it("rejects non-integer or negative prices and non-positive quantities", () => {
    expect(() => lineTotalCents({ description: "x", quantity: 1, unitPriceCents: 10.5 })).toThrow(RangeError);
    expect(() => lineTotalCents({ description: "x", quantity: 1, unitPriceCents: -1 })).toThrow(RangeError);
    expect(() => lineTotalCents({ description: "x", quantity: 0, unitPriceCents: 100 })).toThrow(RangeError);
  });
});

describe("computeTotals", () => {
  const items = [
    { description: "Water heater flush", quantity: 1, unitPriceCents: 12900 },
    { description: "Labor", quantity: 2, unitPriceCents: 9500 },
  ];
  it("sums lines and applies tax in basis points", () => {
    // subtotal 31900, tax 8.75% = 2791.25 → 2791
    expect(computeTotals(items, 875)).toEqual({ subtotalCents: 31900, taxCents: 2791, totalCents: 34691 });
  });
  it("rounds tax half-up", () => {
    // 1000 × 0.0825 = 82.5 → 83
    expect(computeTotals([{ description: "x", quantity: 1, unitPriceCents: 1000 }], 825).taxCents).toBe(83);
  });
  it("handles empty estimates and zero tax", () => {
    expect(computeTotals([], 800)).toEqual({ subtotalCents: 0, taxCents: 0, totalCents: 0 });
    expect(computeTotals(items, 0).totalCents).toBe(31900);
  });
  it("never produces floating-point garbage", () => {
    const many = Array.from({ length: 10 }, () => ({ description: "x", quantity: 1, unitPriceCents: 10 }));
    const t = computeTotals(many, 0);
    expect(Number.isInteger(t.totalCents)).toBe(true);
    expect(t.totalCents).toBe(100);
  });
  it("rejects invalid tax rates", () => {
    expect(() => computeTotals(items, -5)).toThrow(RangeError);
    expect(() => computeTotals(items, 8.25)).toThrow(RangeError);
  });
});

describe("formatUSD", () => {
  it("formats cents as dollars", () => {
    expect(formatUSD(0)).toBe("$0.00");
    expect(formatUSD(5)).toBe("$0.05");
    expect(formatUSD(123450)).toBe("$1,234.50");
    expect(formatUSD(-500)).toBe("-$5.00");
  });
});

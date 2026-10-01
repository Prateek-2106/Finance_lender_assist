import type { LineItem, Totals } from "../domain";

function roundHalfUp(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) + Number.EPSILON * Math.abs(n));
}

export function lineTotalCents(item: LineItem): number {
  if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0)
    throw new RangeError("unitPriceCents must be a non-negative integer");
  if (!(item.quantity > 0)) throw new RangeError("quantity must be > 0");
  return roundHalfUp(item.quantity * item.unitPriceCents);
}

export function computeTotals(items: LineItem[], taxRateBps: number): Totals {
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0) throw new RangeError("taxRateBps must be a non-negative integer");
  const subtotalCents = items.reduce((sum, i) => sum + lineTotalCents(i), 0);
  const taxCents = roundHalfUp((subtotalCents * taxRateBps) / 10_000);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function formatUSD(cents: number): string {
  return usd.format(cents / 100);
}

/**
 * Estimated APR of a fixed daily repayment: the yearly rate at which `dailyPayment`
 * for `businessDays` days exactly repays `amount`. A factor rate (1.25) hides this:
 * repaying 1.25x over ~6 months costs far more than "25%" a year.
 */
export const BUSINESS_DAYS_PER_YEAR = 252;

export function estimatedApr(amountCents: number, dailyPaymentCents: number, businessDays: number): number {
  if (amountCents <= 0 || dailyPaymentCents <= 0 || businessDays <= 0) throw new RangeError("amount, payment and term must be positive");
  if (dailyPaymentCents * businessDays <= amountCents) return 0;
  const pv = (r: number) => (dailyPaymentCents * (1 - (1 + r) ** -businessDays)) / r;
  let lo = 1e-9;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > amountCents) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * BUSINESS_DAYS_PER_YEAR;
}

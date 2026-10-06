// How the funding score works, rendered from the same config the risk engine runs on,
// so this page and the decisions can never disagree.
import { useEffect } from "react";
import { AFFORDABILITY, BAND_A_MIN_FRACTION, BANDS, KNOCKOUTS, METRIC_CONFIG, OFFER_TERMS, SCORECARD_VERSION, type Curve } from "../../src/risk/config";
import { NEUTRAL } from "../../src/risk/assess";
import { BUSINESS_DAYS_PER_YEAR, estimatedApr } from "../../src/risk/apr";
import type { MetricKey } from "../../src/risk/metrics";

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

type Def = { id: string; key: MetricKey; name: string; formula: string; why: string; fmt: (x: number) => string; higherIsBetter: boolean };
const DEFS: Def[] = [
  {
    id: "M1", key: "trueMonthlyRevenue", name: "True monthly revenue",
    formula: "sum of deposits classified as sales ÷ (statement days ÷ 30.44)",
    why: "Transfers between the owner's accounts, loan proceeds and refunds are excluded, so only money customers paid counts. It sets the size of any offer.",
    fmt: usd, higherIsBetter: true,
  },
  {
    id: "M2", key: "revenueTrend", name: "Revenue trend",
    formula: "sales in the last 3 full months ÷ sales in the 3 full months before (fewer if the statements are shorter)",
    why: "Growing or steady sales repay more reliably than shrinking ones. Under 1.0 means sales are falling.",
    fmt: (x) => `${x.toFixed(2)}×`, higherIsBetter: true,
  },
  {
    id: "M3", key: "revenueVolatility", name: "Revenue volatility",
    formula: "standard deviation ÷ mean of full-month sales (coefficient of variation)",
    why: "Daily repayments are fixed; sales that swing widely make some months hard to cover.",
    fmt: (x) => x.toFixed(2), higherIsBetter: false,
  },
  {
    id: "M4", key: "balanceCushion", name: "Balance cushion",
    formula: "average end-of-day balance ÷ true monthly revenue",
    why: "Money left in the account is the buffer that absorbs a slow week.",
    fmt: (x) => `${x.toFixed(2)}×`, higherIsBetter: true,
  },
  {
    id: "M5", key: "negativeDays", name: "Negative-balance days",
    formula: "days in the last 90 that ended below $0",
    why: "Repeatedly running out of money is one of the clearest stress signals in a bank statement.",
    fmt: (x) => `${x}`, higherIsBetter: false,
  },
  {
    id: "M6", key: "nsfEvents", name: "NSF and overdraft events",
    formula: "insufficient-funds and overdraft fees in the last 90 days",
    why: "Each one is a payment the account couldn't make.",
    fmt: (x) => `${x}`, higherIsBetter: false,
  },
  {
    id: "M7", key: "debtLoad", name: "Existing debt load",
    formula: "payments to other lenders ÷ sales, over the statement period",
    why: "Sales already promised to other lenders can't repay a new advance.",
    fmt: (x) => pct(x), higherIsBetter: false,
  },
  {
    id: "M8", key: "monthsInBusiness", name: "Time in business",
    formula: "months in business, from the application",
    why: "Young businesses close more often; this carries the least weight because the bank data says more.",
    fmt: (x) => `${x} mo`, higherIsBetter: true,
  },
];

const SOURCES = [
  {
    title: "FinRegLab: The Use of Cash-Flow Data in Underwriting Credit (2020)",
    url: "https://finreglab.org/wp-content/uploads/2023/12/FinRegLab_2020-03-03_Research-Report_The-Use-of-Cash-Flow-Data-in-Underwriting-Credit_Market-Context-and-Policy-Analysis.pdf",
    supports: "Using bank-account inflows, balances, overdraft fees and income volatility to judge repayment capacity (M1, M3–M6).",
  },
  {
    title: "Federal regulators: Interagency Statement on the Use of Alternative Data in Credit Underwriting (2019)",
    url: "https://www.occ.gov/news-issuances/news-releases/2019/nr-ia-2019-142a.pdf",
    supports: "Cash-flow data as a recognised input to credit decisions, alongside or instead of credit history.",
  },
  {
    title: "Merchant cash advance (Wikipedia)",
    url: "https://en.wikipedia.org/wiki/Merchant_cash_advance",
    supports: "Repayment as a share of daily sales, typically 15–35%. This scorecard caps all lender payments together at the low end, 15%.",
  },
  {
    title: "California Code of Regulations, Title 10, § 914: sales-based financing disclosures",
    url: "https://www.law.cornell.edu/regulations/california/10-CCR-914",
    supports: "Showing an estimated APR for sales-based financing, not just a factor rate.",
  },
  {
    title: "Coefficient of variation (Wikipedia)",
    url: "https://en.wikipedia.org/wiki/Coefficient_of_variation",
    supports: "The volatility measure in M3.",
  },
];

/** A tiny chart of one metric's curve: value → share of its weight earned. */
function CurveChart({ curve, fmt, label }: { curve: Curve; fmt: (x: number) => string; label: string }) {
  const W = 220, H = 70, P = 6;
  const xs = curve.map((p) => p[0]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const sx = (x: number) => P + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * P);
  const sy = (y: number) => H - P - y * (H - 2 * P);
  const pts = curve.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ");
  const desc = curve.map(([x, y]) => `${fmt(x)} earns ${pct(y)}`).join(", ");
  return (
    <figure className="curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${desc}`}>
        <line x1={P} y1={sy(0)} x2={W - P} y2={sy(0)} className="axis" />
        <line x1={P} y1={sy(1)} x2={W - P} y2={sy(1)} className="grid" />
        <polyline points={pts} className="line" />
        {curve.map(([x, y]) => <circle key={x} cx={sx(x)} cy={sy(y)} r={2.5} className="dot" />)}
      </svg>
      <figcaption className="small quiet">{curve.map(([x, y]) => `${fmt(x)} → ${pct(y)}`).join(" · ")}</figcaption>
    </figure>
  );
}

export function Scoring() {
  useEffect(() => {
    document.title = "How funding decisions are made · Vendor Street";
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);
  const exampleApr = estimatedApr(10_000_00, Math.ceil((10_000_00 * OFFER_TERMS.A.factorRate) / OFFER_TERMS.A.termBusinessDays), OFFER_TERMS.A.termBusinessDays);
  const total = Object.values(METRIC_CONFIG).reduce((s, c) => s + c.weight, 0);
  return (
    <div className="home scoring">
      <header className="hero">
        <p className="eyebrow"><a href="/">Vendor Street</a></p>
        <h1>How funding decisions are made</h1>
        <p className="lede">
          Every decision comes from a business's bank statements, through the formulas below. This page is generated from the same settings the
          engine runs on (scorecard {SCORECARD_VERSION}), so it always matches the decisions you see.
        </p>
        <p className="notice small">
          This is a demonstration of an underwriting engine on synthetic data, designed for this project and informed by the public sources at the end.
          It is not an industry-standard formula, and no real credit is offered.
        </p>
        <nav className="toc small" aria-label="On this page">
          <a href="#measures">1. Measures</a> <a href="#score">2. Score</a> <a href="#bands">3. Bands</a> <a href="#knockouts">4. Automatic stops</a>{" "}
          <a href="#decision">5. Decision</a> <a href="#offer">6. Offer</a> <a href="#apr">7. Estimated APR</a> <a href="#sources">Sources</a>
        </nav>
      </header>

      <section id="measures" aria-labelledby="h-measures">
        <h2 id="h-measures">1. Eight measures from the bank statement</h2>
        <p className="quiet">Each transaction is first classified (sales, transfer, loan funding, lender payment, fee…) by rules that record why. Then:</p>
        <div className="metric-grid">
          {DEFS.map((d) => {
            const cfg = METRIC_CONFIG[d.key];
            return (
              <article key={d.id} id={d.id.toLowerCase()} className="metric-card">
                <header>
                  <span className="mid">{d.id}</span>
                  <h3>{d.name}</h3>
                  <span className="weight">{cfg.weight} pts</span>
                </header>
                <p className="formula"><code>{d.formula}</code></p>
                <p className="small">{d.why}</p>
                <CurveChart curve={cfg.curve} fmt={d.fmt} label={`${d.id} ${d.name}`} />
              </article>
            );
          })}
        </div>
      </section>

      <section id="score" aria-labelledby="h-score">
        <h2 id="h-score">2. The score</h2>
        <p className="formula big"><code>score = Σ weightᵢ × curveᵢ(measureᵢ)</code></p>
        <p>
          The weights add up to {total}. Each curve above turns a measure into the share of its weight earned, by straight lines between the marked
          points (flat beyond the ends). A measure the statements can't support, such as volatility with fewer than three full months, earns {pct(NEUTRAL)}.
          The dashboard's score bar shows exactly this: one segment per measure, filled to what it earned.
        </p>
      </section>

      <section id="bands" aria-labelledby="h-bands">
        <h2 id="h-bands">3. Bands</h2>
        <table>
          <thead><tr><th>Band</th><th>Score</th><th>Offer terms</th></tr></thead>
          <tbody>
            {BANDS.map((b, i) => {
              const t = OFFER_TERMS[b.band as keyof typeof OFFER_TERMS];
              const upper = i === 0 ? 100 : BANDS[i - 1]!.min - 0.1;
              return (
                <tr key={b.band}>
                  <td><strong>{b.band}</strong></td>
                  <td>{b.min}–{upper}</td>
                  <td className="small">
                    {t ? `up to ${t.revenueMultiple}× monthly revenue, factor ${t.factorRate}, ${t.termBusinessDays} business days` : b.band === "C" ? "a person reviews it" : "declined"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="small quiet">
          Band A also needs every measure to earn at least {pct(BAND_A_MIN_FRACTION)} of its weight. One very weak measure caps the business at B,
          however good the rest are.
        </p>
      </section>

      <section id="knockouts" aria-labelledby="h-knockouts">
        <h2 id="h-knockouts">4. Automatic stops</h2>
        <p className="quiet">Checked before the score matters. Each one is shown to the business in plain words.</p>
        <table>
          <thead><tr><th>Rule</th><th>Result</th></tr></thead>
          <tbody>
            <tr><td>Fewer than {KNOCKOUTS.minMonthsInBusiness} months in business</td><td>Decline</td></tr>
            <tr><td>True monthly revenue under {usd(KNOCKOUTS.minMonthlyRevenueCents)}</td><td>Decline</td></tr>
            <tr><td>More than {KNOCKOUTS.maxNsfEvents90d} NSF or overdraft fees in 90 days</td><td>Decline</td></tr>
            <tr><td>Statements cover fewer than {KNOCKOUTS.minStatementDays} days</td><td>A person reviews it</td></tr>
            <tr><td>Stated revenue more than {KNOCKOUTS.maxStatedToTrueRatio}× what the bank shows</td><td>A person reviews it</td></tr>
            <tr><td>Existing lender payments already use the {pct(AFFORDABILITY.maxHoldbackOfDailyRevenue)} limit (no room for an offer of at least {usd(AFFORDABILITY.minOfferCents)})</td><td>A person reviews it</td></tr>
          </tbody>
        </table>
      </section>

      <section id="decision" aria-labelledby="h-decision">
        <h2 id="h-decision">5. The decision</h2>
        <ul className="rules">
          <li><strong>Decline</strong> if any stop says decline, or the band is D.</li>
          <li><strong>A person reviews it</strong> if any stop says review, or the band is C. A named underwriter decides, with a note the business sees.</li>
          <li><strong>Approve</strong> otherwise, with the offer below.</li>
        </ul>
        <p className="small quiet">
          The reasons shown to the business are the stops that fired, then the measures that cost the most points, each citing its measure (M1–M8). An AI memo for the
          underwriter may summarise them, but any sentence that cites a measure that doesn't exist, or a number that isn't in the data, is removed before anyone sees it.
        </p>
      </section>

      <section id="offer" aria-labelledby="h-offer">
        <h2 id="h-offer">6. The offer</h2>
        <p className="formula big"><code>amount = round down to {usd(AFFORDABILITY.roundToCents)} of min(requested, revenue cap, affordability cap)</code></p>
        <ul className="rules">
          <li><strong>Revenue cap</strong> = band multiple × M1 (true monthly revenue).</li>
          <li>
            <strong>Affordability cap</strong> = (({pct(AFFORDABILITY.maxHoldbackOfDailyRevenue)} × daily sales) − existing daily lender payments) × term ÷ factor rate,
            where daily sales = M1 ÷ {AFFORDABILITY.businessDaysPerMonth} business days. All lender payments together, old and new, stay within {pct(AFFORDABILITY.maxHoldbackOfDailyRevenue)} of a day's sales.
          </li>
          <li><strong>Repayment</strong> = amount × factor rate, in equal payments each business day over the term.</li>
          <li>Offers under {usd(AFFORDABILITY.minOfferCents)} aren't made; the case goes to a person instead.</li>
        </ul>
      </section>

      <section id="apr" aria-labelledby="h-apr">
        <h2 id="h-apr">7. Estimated APR</h2>
        <p>
          A factor rate hides the cost: repaying {OFFER_TERMS.A.factorRate}× over {OFFER_TERMS.A.termBusinessDays} business days is not "{Math.round((OFFER_TERMS.A.factorRate - 1) * 100)}%".
          The estimated APR is the yearly rate <code>r × {BUSINESS_DAYS_PER_YEAR}</code> where <code>amount = Σₜ₌₁ⁿ daily payment ÷ (1 + r)ᵗ</code> over the n business days of the term.
          For band A terms that's about <strong>{pct(exampleApr)}</strong>, and the business sees it next to every offer.
        </p>
      </section>

      <section id="sources" aria-labelledby="h-sources">
        <h2 id="h-sources">Sources</h2>
        <p className="small quiet">These support the ideas behind the measures and disclosures. The specific weights, curves and thresholds are this project's own choices.</p>
        <ol className="sources">
          {SOURCES.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
              <span className="small quiet">{s.supports}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="small quiet">
        <a href="/">← Vendor Street</a> · Scorecard {SCORECARD_VERSION}. Every assessment records the version it used, so any decision can be replayed exactly.
      </footer>
    </div>
  );
}

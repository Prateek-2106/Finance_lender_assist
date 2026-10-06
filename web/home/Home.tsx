import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorText } from "../ui/bits";
import { Guide } from "../tour/Tour";

export type Platform = {
  baseDomain: string;
  signupOpen: boolean;
  demo: { ttlDays: number; underwriterKey: string | null } | null;
  aiEnabled: boolean;
  author: string | null;
  repoUrl: string | null;
};

// Act 1 is running the business; act 2 is what that record makes possible.
const ACT_1 = [
  { what: "See the numbers first", how: "Your demo opens on Insights: six months of jobs turned into money paid, average job, days to pay, unpaid invoices and repeat customers. Nothing here is typed in; it all comes from the work below." },
  { what: "Win the next job", how: "Under Leads, open the newest request (Jordan, leaking water heater) and press Draft estimate. The AI picks items from the price list; prices always come from the list, and you approve before the customer sees anything." },
  { what: "Get paid", how: "Send the estimate, mark it accepted, create the invoice, record the payment. Each stage writes its email (open them under Insights → Emails), and the numbers update." },
];
const ACT_2 = [
  { what: "Ask what you qualify for", how: "Funding shows three applications scored from bank statements: one approved, one declined, one waiting for a person. Each answer is in plain words, with an estimated APR and what would help next time." },
  { what: "Be the underwriter", how: "Open the underwriter console, read why the scorecard couldn't decide, ask the AI for a fact-checked memo, and approve or decline with a note. Your name goes on the decision." },
];

const BUILT = [
  ["React + TypeScript", "Dashboard, public business sites, underwriter console"],
  ["Node + Express + MongoDB Atlas", "Multi-tenant REST API; the business comes from the web address"],
  ["Risk engine", "Bank-statement parsing, 8 measures, automatic stops, scorecard bands, affordability-capped offers (see How the funding score works)"],
  ["Claude (capped)", "Drafts quotes and underwriting memos; every claim is checked against the numbers before anyone sees it"],
  ["Twilio + SES", "Leads by text message; an email at every stage"],
  ["AWS", "CloudFront, EC2 + ECR, Route 53, ACM, SES, SSM, defined in CDK; GitHub Actions deploys on push"],
  ["Tests", "Vitest unit, contract and HTTP tests; Playwright end to end"],
];

/** The front door on the main domain: what this is, and a button that gives you your own business to try. */
export function Home({ platform }: { platform: Platform }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    document.title = "Vendor Street · run a small business, see what it can borrow";
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ dashboardUrl: string }>("/demo", { method: "POST" });
      location.href = r.dashboardUrl;
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <header className="hero" data-tour="hero">
        <p className="eyebrow">Vendor Street</p>
        <h1>Run a small business from one place, and watch the numbers build themselves.</h1>
        <p className="lede">
          A plumber gets a website that takes requests, AI-drafted quotes they approve, invoices and payments, and a dashboard that adds it all up.
          And because the platform sees how the business earns, it can tell them what funding they qualify for, and exactly why.
        </p>
        {platform.demo ? (
          <div className="cta">
            <button onClick={start} disabled={busy} className="big-button" data-tour="try">
              {busy ? "Setting up your business…" : "Try it with a demo business"}
            </button>
            <p className="quiet small">
              You get your own made-up plumbing business with six months of jobs, payments and bank statements. Nothing is real: no one is emailed, no money moves, and it expires after {platform.demo.ttlDays} days.
            </p>
            <ErrorText error={error} />
          </div>
        ) : (
          <p className="quiet">Demos are turned off on this server.</p>
        )}
      </header>

      <section aria-labelledby="try">
        <h2 id="try">What to try</h2>
        <div className="acts">
          <div>
            <h3 className="act"><span>Act 1</span> Run the business</h3>
            <ol className="try">
              {ACT_1.map((t) => (
                <li key={t.what}>
                  <strong>{t.what}</strong>
                  <span className="quiet">{t.how}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3 className="act"><span>Act 2</span> Turn that record into a funding decision</h3>
            <ol className="try" start={ACT_1.length + 1}>
              {ACT_2.map((t) => (
                <li key={t.what}>
                  <strong>{t.what}</strong>
                  <span className="quiet">{t.how}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        {platform.demo?.underwriterKey && (
          <p className="small quiet">
            Underwriter console: <a href="/underwriting">/underwriting</a> with the demo key <code>{platform.demo.underwriterKey}</code> (it only sees demo businesses).
          </p>
        )}
      </section>

      <section aria-labelledby="formula" data-tour="formula">
        <h2 id="formula">How the funding score works</h2>
        <p>
          Eight measures come from the bank statement: true monthly revenue, its trend and volatility, the balance cushion, negative-balance days,
          overdraft fees, existing debt and time in business. Each earns part of its weight:
        </p>
        <p className="formula big"><code>score = Σ weightᵢ × curveᵢ(measureᵢ)</code></p>
        <p>
          The score sets a band (A–D). Automatic stops can decline or send a case to a person first. An offer is the smallest of what was asked, a multiple of monthly
          revenue, and what keeps all lender payments within 15% of a day's sales, with an estimated APR shown next to it.
        </p>
        <p><a href="/scoring" className="button secondary">Every formula, curve and source →</a></p>
        <p className="small quiet">A demonstration of an underwriting engine on synthetic data. No real credit is offered.</p>
      </section>

      <section aria-labelledby="flow" data-tour="diagrams">
        <h2 id="flow">How it fits together</h2>
        <figure>
          <a href="/workflow.webp"><img src="/workflow.webp" alt="Workflow: a customer request becomes a lead, an AI-drafted estimate a person approves, an invoice and a receipt; bank statements become a risk assessment, an offer or a decline, and an underwriter decision." loading="lazy" /></a>
          <figcaption className="small quiet">Every feature, from a customer's request to a funding decision.</figcaption>
        </figure>
        <figure>
          <a href="/dataflow.webp"><img src="/dataflow.webp" alt="Data flow from the customer, through the business owner and the platform, to the underwriter and back." loading="lazy" /></a>
          <figcaption className="small quiet">Who sends what to whom.</figcaption>
        </figure>
      </section>

      <section aria-labelledby="built">
        <h2 id="built">How it's built</h2>
        <table>
          <tbody>
            {BUILT.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Guide page="home" auto={!!platform.demo} />
      <footer className="small quiet">
        All businesses, customers and bank statements here are synthetic. Funding decisions demonstrate an underwriting engine; no real credit is offered.
        {platform.author && <> Built by {platform.author}.</>}
        {platform.repoUrl && <> <a href={platform.repoUrl}>Source code</a>.</>}
      </footer>
    </div>
  );
}

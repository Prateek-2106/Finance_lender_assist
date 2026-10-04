import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorText } from "../ui/bits";

export type Platform = {
  baseDomain: string;
  signupOpen: boolean;
  demo: { ttlDays: number; underwriterKey: string | null } | null;
  aiEnabled: boolean;
  author: string | null;
  repoUrl: string | null;
};

const TRY = [
  { what: "Draft a quote with AI", how: "Open the newest lead (Jordan, leaking water heater) and press Draft with AI. The model picks items from the price list; prices come from the list, never from the model, and a person approves before anything is sent." },
  { what: "Send, accept, invoice, get paid", how: "Walk an estimate through each stage. Every stage writes the email it would send. Open them under Insights → Emails." },
  { what: "Ask for funding", how: "Funding shows three applications scored from bank statements: one approved, one declined, one waiting for a person. Each answer is in plain words, with what would help next time." },
  { what: "Be the underwriter", how: "From the waiting application, open the underwriter console and approve or decline it with a note. Your name goes on the decision and the business sees it." },
  { what: "Read the numbers", how: "Insights turns six months of work into a funnel, monthly revenue, days to pay and repeat customers." },
];

const BUILT = [
  ["React + TypeScript", "Dashboard, public business sites, underwriter console"],
  ["Node + Express + MongoDB Atlas", "Multi-tenant REST API; the business comes from the web address"],
  ["Risk engine", "Bank-statement parsing, 8 metrics, knockouts, scorecard bands, affordability-capped offers"],
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
    document.title = "Mainstreet · run a small business, get funded";
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
      <header className="hero">
        <p className="eyebrow">Mainstreet</p>
        <h1>A website, quotes, invoices and funding for a small business, in one place.</h1>
        <p className="lede">
          A plumber gets a website that takes requests, drafts quotes with AI, sends invoices and records payments. When they need money for a new van, the
          same platform reads their bank statements and decides, in plain words, how much it can offer.
        </p>
        {platform.demo ? (
          <div className="cta">
            <button onClick={start} disabled={busy} className="big-button">
              {busy ? "Setting up your business…" : "Try it with a demo business"}
            </button>
            <p className="quiet small">
              You get your own made-up plumbing business with six months of history. Nothing is real: no one is emailed, and it expires after {platform.demo.ttlDays} days.
            </p>
            <ErrorText error={error} />
          </div>
        ) : (
          <p className="quiet">Demos are turned off on this server.</p>
        )}
      </header>

      <section aria-labelledby="try">
        <h2 id="try">What to try</h2>
        <ol className="try">
          {TRY.map((t) => (
            <li key={t.what}>
              <strong>{t.what}</strong>
              <span className="quiet">{t.how}</span>
            </li>
          ))}
        </ol>
        {platform.demo?.underwriterKey && (
          <p className="small quiet">
            Underwriter console: <a href="/underwriting">/underwriting</a> with the demo key <code>{platform.demo.underwriterKey}</code> (it only sees demo businesses).
          </p>
        )}
      </section>

      <section aria-labelledby="flow">
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

      <footer className="small quiet">
        All businesses, customers and bank statements here are synthetic. Funding decisions are a demonstration, not an offer of credit.
        {platform.author && <> Built by {platform.author}.</>}
        {platform.repoUrl && <> <a href={platform.repoUrl}>Source code</a>.</>}
      </footer>
    </div>
  );
}

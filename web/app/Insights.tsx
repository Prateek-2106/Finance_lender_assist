import { useEffect, useState } from "react";
import type { Message } from "../../src/domain";
import type { insights as computeInsights } from "../../src/services/insights";
import { api, day, dollars, money } from "../api";
import { ErrorText } from "../ui/bits";

type Insights = Awaited<ReturnType<typeof computeInsights>>;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => MONTHS.at(Number(ym.slice(5, 7)) - 1)!;
const TEMPLATE_WORDS: Record<string, string> = {
  lead_received_customer: "Request received (to customer)",
  lead_received_owner: "New lead (to you)",
  estimate_sent: "Estimate",
  invoice_issued: "Invoice",
  payment_receipt: "Receipt",
  funding_approved: "Funding: approved",
  funding_declined: "Funding: declined",
  funding_pending_review: "Funding: under review",
};

/** What happens after "payment recorded": the pipeline read back as numbers. */
export function Insights() {
  const [s, setS] = useState<Insights | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api<{ insights: Insights }>("/insights").then((r) => setS(r.insights), setError);
    api<{ messages: Message[] }>("/messages").then((r) => setMessages(r.messages), setError);
  }, []);
  if (!s) return <ErrorText error={error} />;

  const steps = [
    { label: "Leads", n: s.funnel.leads, rate: null },
    { label: "Estimates sent", n: s.funnel.estimatesSent, rate: s.conversion.leadToEstimatePercent },
    { label: "Accepted", n: s.funnel.accepted, rate: s.conversion.estimateToAcceptedPercent },
    { label: "Paid", n: s.funnel.paid, rate: s.conversion.acceptedToPaidPercent },
  ];
  const max = Math.max(1, s.funnel.leads);
  const peak = Math.max(1, ...s.revenue.byMonth.map((m) => m.revenueCents));

  return (
    <>
      <h2>Insights</h2>
      <div className="kpis">
        <div className="kpi"><div className="v">{dollars(s.revenue.paidCents)}</div><div className="l">Paid to you, all time</div></div>
        <div className="kpi"><div className="v">{s.revenue.averageJobCents === null ? "n/a" : dollars(s.revenue.averageJobCents)}</div><div className="l">Average job</div></div>
        <div className="kpi"><div className="v">{s.revenue.averageDaysToPay === null ? "n/a" : `${s.revenue.averageDaysToPay} days`}</div><div className="l">Invoice to payment</div></div>
        <div className="kpi"><div className="v">{dollars(s.revenue.outstandingCents)}</div><div className="l">{s.revenue.outstandingInvoices} unpaid invoice{s.revenue.outstandingInvoices === 1 ? "" : "s"}</div></div>
      </div>

      <section className="panel" aria-label="Pipeline">
        <h3>From lead to paid</h3>
        <div className="funnel">
          {steps.map((st) => (
            <div className="funnel-row" key={st.label}>
              <span>{st.label}</span>
              <div><div className="funnel-bar" style={{ width: `${(st.n / max) * 100}%` }} /></div>
              <span className="num">{st.n}{st.rate !== null ? <span className="quiet small"> ({st.rate}%)</span> : null}</span>
            </div>
          ))}
        </div>
        <p className="quiet small">
          {s.customers.total} customer{s.customers.total === 1 ? "" : "s"}, {s.customers.returning} came back for another job. Leads: {s.leadsBySource.web} from your website, {s.leadsBySource.sms} by text.
        </p>
      </section>

      <section className="panel" aria-label="Revenue by month">
        <h3>Paid each month</h3>
        {s.revenue.paidCents === 0 ? (
          <p className="empty">No payments recorded yet. Each payment you record shows up here by month.</p>
        ) : (<>
        <div className="bars" role="img" aria-label={`Paid each month: ${s.revenue.byMonth.map((m) => `${monthLabel(m.month)} ${dollars(m.revenueCents)}`).join(", ")}`}>
          {s.revenue.byMonth.map((m) => (
            <div key={m.month} className="bar" tabIndex={0} style={{ height: `${(m.revenueCents / peak) * 100}%` }}>
              <span className="tip">{monthLabel(m.month)}: {money(m.revenueCents)} from {m.invoices} invoice{m.invoices === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>
        <div className="bar-labels" aria-hidden="true">{s.revenue.byMonth.map((m) => <span key={m.month}>{monthLabel(m.month)}</span>)}</div>
        </>)}
        <details>
          <summary className="small">As a table</summary>
          <table style={{ marginTop: "0.5rem" }}>
            <thead><tr><th>Month</th><th className="num">Invoices paid</th><th className="num">Amount</th></tr></thead>
            <tbody>{s.revenue.byMonth.map((m) => <tr key={m.month}><td>{m.month}</td><td className="num">{m.invoices}</td><td className="num">{money(m.revenueCents)}</td></tr>)}</tbody>
          </table>
        </details>
      </section>

      <NotificationEmail />

      <section className="panel" aria-label="Emails sent">
        <h3>Emails</h3>
        {messages.length === 0 ? (
          <p className="empty">Nothing sent yet. Emails go out when a request comes in, and when you send an estimate, issue an invoice or record a payment.</p>
        ) : (
          <table>
            <thead><tr><th>When</th><th>What</th><th>To</th><th>Result</th></tr></thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="small">{day(m.createdAt)}</td>
                  <td>{TEMPLATE_WORDS[m.template] ?? m.template}</td>
                  <td className="small">{m.to ?? "-"}</td>
                  <td className="small">{m.status === "sent" ? "Sent" : m.status === "skipped" ? `Not sent: ${m.error}` : m.status === "failed" ? `Failed: ${m.error}` : "Sending"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function NotificationEmail() {
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api<{ settings: { ownerEmail: string | null } }>("/settings").then((r) => setEmail(r.settings.ownerEmail ?? ""), setError);
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ settings: { ownerEmail: string | null } }>("/settings", { method: "PATCH", json: { ownerEmail: email } });
      setEmail(r.settings.ownerEmail ?? "");
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  }
  return (
    <form className="panel" onSubmit={save} aria-label="Notifications">
      <h3>Where should we email you?</h3>
      <p className="quiet small">New leads and funding decisions go here.</p>
      <div className="row">
        <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSaved(false); }} placeholder="you@yourbusiness.com" aria-label="Your email" style={{ maxWidth: "22rem" }} />
        <button>Save</button>
        {saved && <span role="status" className="small">Saved.</span>}
      </div>
      <ErrorText error={error} />
    </form>
  );
}

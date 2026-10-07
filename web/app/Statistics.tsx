import { useEffect, useState } from "react";
import type { Message } from "../../src/domain";
import type { insights as computeInsights } from "../../src/services/insights";
import type { SourceRows } from "../../src/services/insightSources";
import { api, day, dollars, money } from "../api";
import { ErrorText, Status } from "../ui/bits";

type Insights = Awaited<ReturnType<typeof computeInsights>>;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthShort = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1]!.slice(0, 3);
const monthLong = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TEMPLATE_WORDS: Record<string, string> = {
  lead_received_customer: "Request received (to customer)",
  lead_received_owner: "New request (to you)",
  estimate_sent: "Estimate",
  invoice_issued: "Invoice",
  payment_receipt: "Receipt",
  funding_approved: "Funding: approved",
  funding_declined: "Funding: declined",
  funding_pending_review: "Funding: under review",
};

/**
 * The business in numbers. Every number links to the records behind it:
 * #/statistics/paid/2026-09 lists September's paid invoices and the services on them.
 */
export function Statistics({ view, go }: { view: string[]; go: (path: string) => void }) {
  if (view[0]) return <Sources view={view} go={go} />;
  return <Overview />;
}

function Overview() {
  const [s, setS] = useState<Insights | null>(null);
  const [messages, setMessages] = useState<(Message & { hasPreview?: boolean })[]>([]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api<{ insights: Insights }>("/insights").then((r) => setS(r.insights), setError);
    api<{ messages: Message[] }>("/messages").then((r) => setMessages(r.messages), setError);
  }, []);
  if (!s) return <ErrorText error={error} />;

  const steps = [
    { label: "Requests", n: s.funnel.leads, rate: null, href: "requests" },
    { label: "Quotes sent", n: s.funnel.estimatesSent, rate: s.conversion.leadToEstimatePercent, href: "quoted" },
    { label: "Accepted", n: s.funnel.accepted, rate: s.conversion.estimateToAcceptedPercent, href: "accepted" },
    { label: "Paid", n: s.funnel.paid, rate: s.conversion.acceptedToPaidPercent, href: "paid" },
  ];
  const max = Math.max(1, s.funnel.leads);
  const r = s.revenue;
  const peak = Math.max(1, ...r.byMonth.map((m) => m.grossCents));
  const monthTax = r.byMonth.reduce((a, m) => a + m.taxCents, 0);

  return (
    <>
      <h2>Statistics</h2>
      <p className="quiet small">Click any number to see where it comes from.</p>
      <div className="kpis" data-tour="kpis">
        <a className="kpi" href="#/statistics/paid">
          <div className="v">{dollars(r.grossCents)}</div>
          <div className="l">Gross income, all time</div>
        </a>
        <a className="kpi" href="#/statistics/paid">
          <div className="v">{r.averageJobCents === null ? "n/a" : dollars(r.averageJobCents)}</div>
          <div className="l">Average job</div>
        </a>
        <a className="kpi" href="#/statistics/paid">
          <div className="v">{r.averageDaysToPay === null ? "n/a" : plural(r.averageDaysToPay, "day")}</div>
          <div className="l">Average time to get paid</div>
        </a>
        <a className="kpi" href="#/statistics/unpaid">
          <div className="v">{dollars(r.outstandingCents)}</div>
          <div className="l">Owed to you, {plural(r.outstandingInvoices, "unpaid invoice")}</div>
        </a>
      </div>
      {r.taxCollectedCents > 0 && (
        <p className="quiet small">Income is before sales tax. You also collected {money(r.taxCollectedCents)} in sales tax, which goes to the state.</p>
      )}

      <section className="panel" aria-label="Pipeline" data-tour="funnel">
        <h3>From request to payment</h3>
        <div className="funnel">
          {steps.map((st) => (
            <a className="funnel-row" key={st.label} href={`#/statistics/${st.href}`}>
              <span>{st.label}</span>
              <div><div className="funnel-bar" style={{ width: `${(st.n / max) * 100}%` }} /></div>
              <span className="num">{st.n}{st.rate !== null ? <span className="quiet small"> ({st.rate}%)</span> : null}</span>
            </a>
          ))}
        </div>
        <p className="quiet small">
          <a href="#/statistics/customers">{plural(s.customers.total, "customer")}</a>, <a href="#/statistics/customers/returning">{s.customers.returning} came back</a> for another job.
          Requests: <a href="#/statistics/requests/web">{s.leadsBySource.web} from your website</a>, <a href="#/statistics/requests/sms">{s.leadsBySource.sms} by text</a>.
        </p>
      </section>

      <section className="panel" aria-label="Income by month">
        <h3>Gross income by month</h3>
        {r.grossCents === 0 ? (
          <p className="empty">No payments recorded yet. Each payment you record shows up here by month.</p>
        ) : (
          <>
            <div className="bars" role="list" aria-label="Gross income by month">
              {r.byMonth.map((m) => (
                <a
                  key={m.month}
                  role="listitem"
                  className="bar"
                  href={`#/statistics/paid/${m.month}`}
                  style={{ height: `${(m.grossCents / peak) * 100}%` }}
                  aria-label={`${monthLong(m.month)}: ${money(m.grossCents)} from ${plural(m.invoices, "invoice")}. See the jobs`}
                >
                  <span className="tip" aria-hidden="true">{monthShort(m.month)}: {money(m.grossCents)} from {plural(m.invoices, "invoice")}</span>
                </a>
              ))}
            </div>
            <div className="bar-labels" aria-hidden="true">{r.byMonth.map((m) => <span key={m.month}>{monthShort(m.month)}</span>)}</div>
            <p className="quiet small">Click a month to see the jobs you were paid for.</p>
          </>
        )}
        <details>
          <summary className="small">As a table</summary>
          <table className="cards" style={{ marginTop: "0.5rem" }}>
            <thead><tr><th>Month</th><th className="num">Invoices paid</th><th className="num">Gross income</th><th className="num">Sales tax</th></tr></thead>
            <tbody>
              {r.byMonth.map((m) => (
                <tr key={m.month}>
                  <td><a href={`#/statistics/paid/${m.month}`}>{monthLong(m.month)}</a></td>
                  <td className="num" data-label="Invoices paid">{m.invoices}</td>
                  <td className="num" data-label="Gross income">{money(m.grossCents)}</td>
                  <td className="num" data-label="Sales tax">{money(m.taxCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {monthTax > 0 && <p className="small quiet">Sales tax is collected for the state, so it isn't counted as income.</p>}
        </details>
      </section>

      {viewing && <EmailPreview id={viewing} onClose={() => setViewing(null)} />}
      <NotificationEmail />

      <section className="panel" aria-label="Emails sent" data-tour="emails">
        <h3>Emails</h3>
        {messages.length === 0 ? (
          <p className="empty">Nothing sent yet. Emails go out when a request comes in, and when you send an estimate, issue an invoice or record a payment.</p>
        ) : (
          <table className="cards">
            <thead><tr><th>When</th><th>What</th><th>To</th><th>Result</th><th></th></tr></thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id}>
                  <td className="small" data-label="When">{day(m.createdAt)}</td>
                  <td data-label="What">{TEMPLATE_WORDS[m.template] ?? m.template}</td>
                  <td className="small" data-label="To">{m.to ?? "-"}</td>
                  <td className="small" data-label="Result">{m.status === "sent" ? "Sent" : m.status === "skipped" ? `Not sent: ${m.error}` : m.status === "failed" ? `Failed: ${m.error}` : "Sending"}</td>
                  <td>{m.hasPreview && <button className="secondary small" onClick={() => setViewing(m.id)} aria-label={`View email: ${m.subject}`}>View</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/** The records behind one number. */
function Sources({ view }: { view: string[]; go: (path: string) => void }) {
  const [kind, extra] = view as [string, string | undefined];
  const [data, setData] = useState<SourceRows | null>(null);
  const [error, setError] = useState<unknown>(null);
  const q = new URLSearchParams({ kind });
  if (kind === "paid" && extra) q.set("month", extra);
  if (kind === "requests" && extra) q.set("source", extra);
  if (kind === "customers" && extra === "returning") q.set("returning", "1");
  const qs = q.toString();
  useEffect(() => {
    setData(null);
    setError(null);
    api<{ sources: SourceRows }>(`/insights/sources?${qs}`).then((r) => setData(r.sources), setError);
  }, [qs]);

  const title =
    kind === "paid" ? (extra ? `Gross income, ${monthLong(extra)}` : "Gross income, all time")
    : kind === "unpaid" ? "Owed to you"
    : kind === "requests" ? (extra === "sms" ? "Requests by text" : extra === "web" ? "Requests from your website" : "Requests")
    : kind === "quoted" ? "Quotes sent"
    : kind === "accepted" ? "Accepted quotes"
    : kind === "customers" ? (extra === "returning" ? "Customers who came back" : "Customers")
    : "Statistics";

  return (
    <>
      <p className="small"><a href="#/statistics">← Statistics</a></p>
      <h2>{title}</h2>
      <ErrorText error={error} />
      {data && <SourceBody data={data} month={kind === "paid" ? extra : undefined} />}
    </>
  );
}

function SourceBody({ data, month }: { data: SourceRows; month?: string }) {
  switch (data.kind) {
    case "paid":
    case "unpaid": {
      const inv = data.invoices;
      const gross = inv.reduce((a, i) => a + i.subtotalCents, 0);
      const tax = inv.reduce((a, i) => a + i.taxCents, 0);
      if (!inv.length) return <p className="empty">{data.kind === "paid" ? `No payments recorded${month ? ` in ${monthLong(month)}` : ""}.` : "Nothing is owed to you right now."}</p>;
      return (
        <>
          <p data-testid="source-summary">
            {data.kind === "paid" ? `${plural(inv.length, "invoice")} paid: ` : `${plural(inv.length, "unpaid invoice")}: `}
            <strong>{money(gross)}</strong> before sales tax{tax ? `, plus ${money(tax)} tax` : ""}.
          </p>
          <section className="panel" aria-label="Services">
            <h3>{data.kind === "paid" ? "What you were paid for" : "What's still to be paid for"}</h3>
            <table>
              <thead><tr><th>Service or item</th><th className="num">Quantity</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {data.services.map((sv) => (
                  <tr key={sv.description}>
                    <td data-label="Service">{sv.description}</td>
                    <td className="num" data-label="Quantity">{sv.quantity}</td>
                    <td className="num" data-label="Amount">{money(sv.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="grand"><td colSpan={2}>Before sales tax</td><td className="num">{money(gross)}</td></tr></tfoot>
            </table>
          </section>
          <section className="panel" aria-label="Invoices">
            <h3>Invoices</h3>
            <table className="cards" data-testid="source-invoices">
              <thead>
                <tr><th>Invoice</th><th>Customer</th><th>Services</th><th>{data.kind === "paid" ? "Paid" : "Issued"}</th><th className="num">Before tax</th>{data.kind === "paid" && <th className="num">Days to pay</th>}</tr>
              </thead>
              <tbody>
                {inv.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Invoice"><a href={`#/estimates/${i.estimateId}`}>{i.number}</a></td>
                    <td data-label="Customer">{i.customer ?? "-"}</td>
                    <td data-label="Services" className="small">{i.items.map((l) => (l.quantity === 1 ? l.description : `${l.description} × ${l.quantity}`)).join(", ")}</td>
                    <td data-label={data.kind === "paid" ? "Paid" : "Issued"} className="small">{day(i.paidAt ?? i.issuedAt)}</td>
                    <td className="num" data-label="Before tax">{money(i.subtotalCents)}</td>
                    {data.kind === "paid" && <td className="num" data-label="Days to pay">{i.daysToPay}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      );
    }
    case "quoted":
    case "accepted":
      if (!data.estimates.length) return <p className="empty">None yet.</p>;
      return (
        <table className="cards">
          <thead><tr><th>Date</th><th>Customer</th><th>Status</th><th className="num">Quote, before tax</th></tr></thead>
          <tbody>
            {data.estimates.map((e) => (
              <tr key={e.id}>
                <td className="small" data-label="Date">{day(e.createdAt)}</td>
                <td data-label="Customer"><a href={`#/estimates/${e.id}`}>{e.customer ?? "Open quote"}</a></td>
                <td data-label="Status"><Status value={e.status} /></td>
                <td className="num" data-label="Quote">{money(e.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "requests":
      if (!data.requests.length) return <p className="empty">None yet.</p>;
      return (
        <table className="cards">
          <thead><tr><th>Received</th><th>From</th><th>Request</th><th>Quote</th></tr></thead>
          <tbody>
            {data.requests.map((l) => (
              <tr key={l.id}>
                <td className="small" data-label="Received">{day(l.createdAt)}</td>
                <td data-label="From">{l.name}<div className="quiet small">{l.contact}{l.source === "sms" ? " (text)" : ""}</div></td>
                <td data-label="Request">{l.message}</td>
                <td data-label="Quote">{l.estimateId ? <a href={`#/estimates/${l.estimateId}`}>Open quote</a> : <a href="#/requests">Not quoted yet</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "customers":
      if (!data.customers.length) return <p className="empty">None yet.</p>;
      return (
        <table className="cards">
          <thead><tr><th>Customer</th><th className="num">Requests</th><th>Last request</th></tr></thead>
          <tbody>
            {data.customers.map((c) => (
              <tr key={c.id}>
                <td data-label="Customer">{c.name}<div className="quiet small">{c.contact}</div></td>
                <td className="num" data-label="Requests">{c.requests}</td>
                <td className="small" data-label="Last request">{day(c.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
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
      <p className="quiet small">New requests and funding decisions go here.</p>
      <div className="row">
        <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSaved(false); }} placeholder="you@yourbusiness.com" aria-label="Your email" style={{ maxWidth: "22rem" }} />
        <button>Save</button>
        {saved && <span role="status" className="small">Saved.</span>}
      </div>
      <ErrorText error={error} />
    </form>
  );
}

/** The email exactly as it would have gone out, in a sandboxed frame (no scripts, no same-origin access). */
function EmailPreview({ id, onClose }: { id: string; onClose: () => void }) {
  const [m, setM] = useState<Message | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api<{ message: Message }>(`/messages/${id}`).then((r) => setM(r.message), setError);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [id, onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Email preview" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="contact">
            <strong style={{ fontSize: "var(--step-0)" }}>{m?.subject ?? "Loading…"}</strong>
            {m && <span className="quiet">To {m.to ?? "(no address)"} · not sent (demo business)</span>}
          </div>
          <button className="secondary small" onClick={onClose} autoFocus>Close</button>
        </div>
        <ErrorText error={error} />
        {m?.preview && <iframe title="Email" sandbox="" srcDoc={m.preview.html} className="email-frame" />}
      </div>
    </div>
  );
}

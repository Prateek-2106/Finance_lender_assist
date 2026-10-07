import { useCallback, useEffect, useState } from "react";
import type { Estimate, Invoice, LineItem, Receipt, Totals } from "../../src/domain";
import { api, day, money, openPdf } from "../api";
import { ErrorText, Status } from "../ui/bits";

type EstimateView = Estimate & { totals: Totals };

/** What the owner can do next, per status. Mirrors the server's state machine. */
const ACTIONS: Record<string, { to: string; label: string; style?: string }[]> = {
  needs_review: [{ to: "draft", label: "Approve draft" }],
  draft: [{ to: "sent", label: "Send to customer" }],
  sent: [
    { to: "accepted", label: "Mark accepted" },
    { to: "declined", label: "Mark declined", style: "danger" },
    { to: "draft", label: "Back to draft", style: "secondary" },
  ],
  declined: [{ to: "draft", label: "Reopen" }],
};

export function Estimates({ selected, go }: { selected?: string; go: (path: string) => void }) {
  const [list, setList] = useState<EstimateView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(() => api<{ estimates: EstimateView[] }>("/estimates").then((r) => setList(r.estimates), setError), []);
  useEffect(() => void reload(), [reload]);

  return (
    <>
      <h2>Estimates</h2>
      <ErrorText error={error} />
      {list && list.length === 0 && <p className="empty">No estimates yet. Draft one from a request.</p>}
      {list && list.length > 0 && (
        <div className="split">
          <table data-tour="estimates-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className={`clickable${e.id === selected ? " selected" : ""}`} onClick={() => go(`estimates/${e.id}`)}>
                  <td>{day(e.createdAt)}</td>
                  <td><Status value={e.status} /></td>
                  <td className="num">{money(e.totals.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selected ? <EstimateDetail key={selected} id={selected} onChange={reload} /> : <p className="empty">Choose an estimate to see its details.</p>}
        </div>
      )}
    </>
  );
}

function EstimateDetail({ id, onChange }: { id: string; onChange: () => void }) {
  const [e, setE] = useState<EstimateView | null>(null);
  const [items, setItems] = useState<LineItem[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const show = (x: EstimateView) => {
    setE(x);
    setItems(x.lineItems);
  };
  useEffect(() => {
    api<{ estimate: EstimateView }>(`/estimates/${id}`).then(async (r) => {
      show(r.estimate);
      // converting is idempotent: for an invoiced estimate this just returns its invoice
      if (r.estimate.status === "invoiced") setInvoice((await api<{ invoice: Invoice }>(`/estimates/${id}/invoice`, { method: "POST" })).invoice);
    }, setError);
  }, [id]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const transition = (to: string) => run(async () => show((await api<{ estimate: EstimateView }>(`/estimates/${id}/transition`, { method: "POST", json: { to } })).estimate));
  const save = () => run(async () => show((await api<{ estimate: EstimateView }>(`/estimates/${id}`, { method: "PATCH", json: { lineItems: items } })).estimate));
  const makeInvoice = () =>
    run(async () => {
      setInvoice((await api<{ invoice: Invoice }>(`/estimates/${id}/invoice`, { method: "POST" })).invoice);
      setE((x) => (x ? { ...x, status: "invoiced" } : x));
    });
  const pay = () =>
    run(async () => {
      const r = await api<{ invoice: Invoice; receipt: Receipt }>(`/invoices/${invoice!.id}/pay`, { method: "POST" });
      setInvoice(r.invoice);
      setReceipt(r.receipt);
    });

  if (!e) return <ErrorText error={error} />;
  const editable = e.status === "needs_review" || e.status === "draft";
  const dirty = JSON.stringify(items) !== JSON.stringify(e.lineItems);

  return (
    <section className="panel" aria-label="Estimate" data-tour="estimate-panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>Estimate from {day(e.createdAt)}</h3>
        <Status value={e.status} />
      </div>
      {e.customer ? (
        <div className="contact" data-testid="customer">
          <strong>For {e.customer.name}</strong>
          {e.customer.phone && <span>{e.customer.phone}</span>}
          {e.customer.email && <span>{e.customer.email}</span>}
          {!e.customer.email && <span className="quiet">No email on file, so estimates and invoices can't be emailed.</span>}
        </div>
      ) : (
        <p className="quiet small">No customer attached.</p>
      )}

      {e.aiDraft && (
        <div className="small" style={{ borderLeft: "3px solid var(--review)", paddingLeft: "0.75rem" }}>
          <p>
            Drafted by {e.aiDraft.model} from the customer's message. Prices come from your price list.
            {e.status === "needs_review" ? " Check it before it goes to the customer." : ""}
          </p>
          {e.aiDraft.questions.length > 0 && (
            <>
              <p style={{ marginTop: "0.5rem", fontWeight: 600 }}>Questions to ask the customer</p>
              <ul className="reasons">{e.aiDraft.questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </>
          )}
          {e.aiDraft.rejected.length > 0 && (
            <p className="quiet" style={{ marginTop: "0.5rem" }}>
              Left out: {e.aiDraft.rejected.map((r) => `${r.sku} (${r.why})`).join("; ")}
            </p>
          )}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num hide-sm">Unit</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((li, i) => (
            <tr key={i}>
              <td>{li.description}</td>
              <td className="num">
                {editable ? (
                  <input
                    aria-label={`Quantity for ${li.description}`}
                    type="number" min={li.fractional ? 0.25 : 1} step={li.fractional ? 0.25 : 1} value={li.quantity} style={{ width: "4.25rem", textAlign: "right" }}
                    onChange={(ev) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: Number(ev.target.value) } : x)))}
                  />
                ) : (
                  li.quantity
                )}
              </td>
              <td className="num hide-sm">{money(li.unitPriceCents)}</td>
              <td className="num">{money(Math.round(li.quantity * li.unitPriceCents))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Subtotal</td><td className="hide-sm" /><td className="num">{money(e.totals.subtotalCents)}</td></tr>
          <tr><td colSpan={2}>Tax ({(e.taxRateBps / 100).toFixed(2)}%)</td><td className="hide-sm" /><td className="num">{money(e.totals.taxCents)}</td></tr>
          <tr className="grand"><td colSpan={2}>Total</td><td className="hide-sm" /><td className="num">{money(e.totals.totalCents)}</td></tr>
        </tfoot>
      </table>
      {e.notes && !e.aiDraft && <p className="quiet small" style={{ whiteSpace: "pre-line" }}>{e.notes}</p>}

      <ErrorText error={error} />
      <div className="row" data-tour="estimate-actions">
        {editable && dirty && <button disabled={busy} onClick={save}>Save changes</button>}
        {!dirty &&
          (ACTIONS[e.status] ?? []).map((a) => (
            <button key={a.to} className={a.style} disabled={busy} onClick={() => transition(a.to)}>{a.label}</button>
          ))}
        {e.status === "accepted" && <button disabled={busy} onClick={makeInvoice}>Create invoice</button>}
      </div>

      {invoice && (
        <div className="stack" style={{ borderTop: "1px solid var(--rule)", paddingTop: "1rem" }} data-tour="invoice">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>Invoice {invoice.number}</h3>
            <Status value={invoice.status} />
          </div>
          {invoice.billTo && (
            <p className="small" data-testid="bill-to">
              Bill to {invoice.billTo.name}{invoice.billTo.phone ? `, ${invoice.billTo.phone}` : ""}{invoice.billTo.email ? `, ${invoice.billTo.email}` : ""}
            </p>
          )}
          <div className="row">
            <button className="secondary" onClick={() => openPdf(`/invoices/${invoice.id}/pdf`).catch(setError)}>Open PDF</button>
            {invoice.status === "open" && <button disabled={busy} onClick={pay}>Record payment of {money(invoice.totals.totalCents)}</button>}
          </div>
          {receipt && (
            <p role="status">
              Payment recorded: {money(receipt.amountPaidCents)} for {receipt.invoiceNumber} on {day(receipt.paidAt)}.
              {receipt.billTo?.email ? ` A receipt was emailed to ${receipt.billTo.email}.` : ""}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import type { Customer, Estimate, Lead } from "../../src/domain";
import { api, day } from "../api";
import { ErrorText, Status } from "../ui/bits";

export function Leads({ go }: { go: (path: string) => void }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Map<string, Customer>>(new Map());
  const [latest, setLatest] = useState<Map<string, Estimate>>(new Map()); // newest estimate per lead
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ leads: Lead[] }>("/leads").then((r) => setLeads(r.leads), setError);
    api<{ estimates: Estimate[] }>("/estimates").then((r) => {
      const m = new Map<string, Estimate>();
      for (const e of r.estimates) if (e.leadId && !m.has(e.leadId)) m.set(e.leadId, e); // list is newest first
      setLatest(m);
    }, () => {});
    api<{ customers: Customer[] }>("/customers").then((r) => setCustomers(new Map(r.customers.map((c) => [c.id, c]))), () => {});
  }, []);

  async function draft(lead: Lead) {
    setDrafting(lead.id);
    setError(null);
    try {
      const r = await api<{ estimate: { id: string } }>(`/leads/${lead.id}/draft-estimate`, { method: "POST" });
      go(`estimates/${r.estimate.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setDrafting(null);
    }
  }

  return (
    <>
      <h2>Leads</h2>
      <ErrorText error={error} />
      {leads && leads.length === 0 && (
        <p className="empty">No leads yet. Share your website link, or text your business number, and new requests show up here.</p>
      )}
      {leads && leads.length > 0 && (
        <table data-tour="leads-table">
          <thead>
            <tr>
              <th>From</th>
              <th>Request</th>
              <th>Received</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id}>
                <td>
                  <div>
                    {l.name}
                    {l.customerId && (customers.get(l.customerId)?.leadCount ?? 0) > 1 && (
                      <span className="badge">Returning, {customers.get(l.customerId)!.leadCount} requests</span>
                    )}
                  </div>
                  <div className="quiet small">{l.phone ?? l.email}{l.source === "sms" ? " (text)" : ""}</div>
                </td>
                <td style={{ maxWidth: "36rem" }}>{l.message}</td>
                <td className="quiet small">{day(l.createdAt)}</td>
                <td className="num">
                  {latest.has(l.id) ? (
                    <a href={`#/estimates/${latest.get(l.id)!.id}`} className="small" data-tour="lead-status" aria-label={`Open estimate for ${l.name}`}>
                      <Status value={latest.get(l.id)!.status} />
                    </a>
                  ) : (
                    <button className="secondary" disabled={drafting === l.id} onClick={() => draft(l)} data-tour="draft">
                      {drafting === l.id ? "Drafting…" : "Draft estimate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

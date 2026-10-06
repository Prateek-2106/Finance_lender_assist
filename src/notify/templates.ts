import type { Estimate, FundingApplication, Invoice, Lead, Receipt, Tenant } from "../domain";
import { computeTotals, formatUSD, lineTotalCents } from "../lib/money";
import type { ApplicantView } from "../risk/applicantView";

export interface Rendered {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const p = (s: string) => `<p style="margin:0 0 12px">${esc(s)}</p>`;
const wrap = (business: string, body: string) =>
  `<div style="font-family:Segoe UI,Arial,sans-serif;color:#12343b;max-width:560px;line-height:1.5">` +
  `<p style="font-size:18px;font-weight:700;margin:0 0 16px">${esc(business)}</p>${body}` +
  `<p style="color:#4f6468;font-size:12px;margin-top:24px">Sent by Vendor Street on behalf of ${esc(business)}.</p></div>`;

function itemsTable(e: Pick<Estimate, "lineItems" | "taxRateBps">) {
  const t = computeTotals(e.lineItems, e.taxRateBps);
  const rows = e.lineItems
    .map((li) => `<tr><td style="padding:4px 8px 4px 0">${esc(li.description)}</td><td style="text-align:right;padding:4px 8px">${li.quantity}</td><td style="text-align:right;padding:4px 0">${formatUSD(lineTotalCents(li))}</td></tr>`)
    .join("");
  const html =
    `<table style="border-collapse:collapse;width:100%;margin:0 0 12px">${rows}` +
    `<tr><td colspan="2" style="padding:6px 8px 2px 0;border-top:1px solid #cfdccf">Subtotal</td><td style="text-align:right;border-top:1px solid #cfdccf">${formatUSD(t.subtotalCents)}</td></tr>` +
    `<tr><td colspan="2" style="padding:2px 8px 2px 0">Tax (${(e.taxRateBps / 100).toFixed(2)}%)</td><td style="text-align:right">${formatUSD(t.taxCents)}</td></tr>` +
    `<tr><td colspan="2" style="padding:2px 8px 2px 0;font-weight:700">Total</td><td style="text-align:right;font-weight:700">${formatUSD(t.totalCents)}</td></tr></table>`;
  const text = [...e.lineItems.map((li) => `- ${li.description} x ${li.quantity}: ${formatUSD(lineTotalCents(li))}`), `Total: ${formatUSD(t.totalCents)}`].join("\n");
  return { html, text, totals: t };
}

export const templates = {
  signInLink(link: string, minutes: number): Rendered {
    const lines = [
      "Here is your link to sign in to Vendor Street.",
      `It works once and expires in ${minutes} minutes.`,
      "If you didn't ask to sign in, you can ignore this email; nothing changes without the link.",
    ];
    const button = `<p style="margin:0 0 16px"><a href="${esc(link)}" style="display:inline-block;background:#0f6e6a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Sign in</a></p>`;
    return {
      subject: "Your Vendor Street sign-in link",
      text: [lines[0], link, lines[1], lines[2]].join("\n\n"),
      html: wrap("Vendor Street", p(lines[0]!) + button + p(lines[1]!) + p(lines[2]!)).replace("Sent by Vendor Street on behalf of Vendor Street.", "Sent by Vendor Street."),
    };
  },
  leadReceivedCustomer(t: Tenant, lead: Lead): Rendered {
    const lines = [`Hi ${lead.name},`, `Thanks for reaching out. ${t.name} got your request and will get back to you with a quote soon.`, `Your request: "${lead.message}"`];
    return { subject: `We got your request - ${t.name}`, text: lines.join("\n\n"), html: wrap(t.name, lines.map(p).join("")) };
  },
  leadReceivedOwner(t: Tenant, lead: Lead, dashboardUrl: string): Rendered {
    const contact = [lead.phone, lead.email].filter(Boolean).join(", ");
    const lines = [`New ${lead.source === "sms" ? "text message" : "quote request"} from ${lead.name} (${contact}):`, `"${lead.message}"`, `Open it in your dashboard: ${dashboardUrl}`];
    return { subject: `New lead: ${lead.name}`, text: lines.join("\n\n"), html: wrap(t.name, lines.map(p).join("")) };
  },
  estimateSent(t: Tenant, e: Estimate): Rendered {
    const items = itemsTable(e);
    const hi = `Hi ${e.customer?.name ?? "there"},`;
    const intro = `Here is your estimate from ${t.name}. Reply to this email or call us to go ahead.`;
    return {
      subject: `Your estimate from ${t.name}: ${formatUSD(items.totals.totalCents)}`,
      text: `${hi}\n\n${intro}\n\n${items.text}`,
      html: wrap(t.name, p(hi) + p(intro) + items.html),
    };
  },
  invoiceIssued(t: Tenant, inv: Invoice): Rendered {
    const items = itemsTable(inv);
    const hi = `Hi ${inv.billTo?.name ?? "there"},`;
    const intro = `Invoice ${inv.number} for ${formatUSD(inv.totals.totalCents)} is attached. Thank you for your business.`;
    return { subject: `Invoice ${inv.number} from ${t.name}`, text: `${hi}\n\n${intro}\n\n${items.text}`, html: wrap(t.name, p(hi) + p(intro) + items.html) };
  },
  paymentReceipt(t: Tenant, r: Receipt): Rendered {
    const lines = [
      `Hi ${r.billTo?.name ?? "there"},`,
      `We received your payment of ${formatUSD(r.amountPaidCents)} for invoice ${r.invoiceNumber} on ${new Date(r.paidAt).toLocaleDateString("en-US", { dateStyle: "medium" })}.`,
      "Keep this email as your receipt.",
    ];
    return { subject: `Receipt for ${r.invoiceNumber} - ${t.name}`, text: lines.join("\n\n"), html: wrap(t.name, lines.map(p).join("")) };
  },
  fundingDecision(t: Tenant, app: FundingApplication, v: ApplicantView, dashboardUrl: string): Rendered {
    const reasons = v.reasons.map((r) => `- ${r.text}${r.whatWouldHelp ? ` ${r.whatWouldHelp}` : ""}`);
    const text = [v.headline, v.summary, ...reasons, ...v.nextSteps, v.decidedBy ?? "", v.note ? `Note from the reviewer: ${v.note}` : "", `See it in your dashboard: ${dashboardUrl}`]
      .filter(Boolean)
      .join("\n\n");
    const html =
      `<p style="font-size:20px;font-weight:700;margin:0 0 8px">${esc(v.headline)}</p>` +
      p(v.summary) +
      (v.reasons.length ? `<ul style="margin:0 0 12px;padding-left:18px">${v.reasons.map((r) => `<li style="margin-bottom:6px">${esc(r.text)} <em>${esc(r.whatWouldHelp)}</em></li>`).join("")}</ul>` : "") +
      v.nextSteps.map(p).join("") +
      (v.decidedBy ? p(`${v.decidedBy}.`) : "") +
      (v.note ? p(`Note from the reviewer: ${v.note}`) : "") +
      p(`See it in your dashboard: ${dashboardUrl}`);
    const subject = { approved: "You're approved", declined: "Your funding application", pending_review: "Your application is being reviewed", not_assessed: "Your application" }[v.status];
    const whole = `$${Math.round(app.amountRequestedCents / 100).toLocaleString("en-US")}`;
    return { subject: `${subject} - ${whole} request`, text, html: wrap(t.name, html) };
  },
};

import type { Config } from "../deps";
import type { Estimate, FundingApplication, Invoice, Lead, Receipt, Tenant } from "../domain";
import { renderInvoicePdf } from "../lib/invoicePdf";
import type { Repos } from "../repos/types";
import { applicantView } from "../risk/applicantView";
import type { Mailer, OutgoingEmail } from "./mailer";
import { templates, type Rendered } from "./templates";

/** https://joes-plumbing.yourdomain.com, or http://joes-plumbing.lvh.me:3000 locally. */
export function tenantUrl(config: Config, t: Pick<Tenant, "subdomain">, path = "") {
  const u = new URL(config.publicUrl);
  const port = u.port ? `:${u.port}` : "";
  const base = config.baseDomain === "localhost" ? "lvh.me" : config.baseDomain;
  return `${u.protocol}//${t.subdomain}.${base}${port}${path}`;
}

export const DEMO_SKIP = "demo business: shown here, not sent";

/**
 * Sends the email for each stage of the pipeline and logs every attempt in `messages`.
 * Sending happens after the response: a slow or failing mail server never breaks the
 * action that triggered it. `idle()` lets tests wait for in-flight sends.
 */
export class Notifier {
  private pending = new Set<Promise<void>>();
  constructor(
    private readonly repos: Repos,
    private readonly config: Config,
    private readonly mailer?: Mailer,
  ) {}

  async idle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private deliver(t: Tenant, template: string, to: string | undefined, relatedId: string, build: () => Promise<Rendered & Pick<OutgoingEmail, "attachments">>) {
    const job = (async () => {
      let subject = template;
      try {
        const r = await build();
        subject = r.subject;
        const tenantId = t.id;
        // Demo businesses run every stage but never email anyone: the message is kept so the
        // visitor can open it in the dashboard instead (otherwise strangers could aim mail at anyone).
        if (t.demo) {
          await this.repos.messages.create({ tenantId, template, subject, relatedId, status: "skipped", ...(to ? { to } : {}), error: DEMO_SKIP, preview: { html: r.html } });
          return;
        }
        const skip = !to ? "no email address on file" : !this.mailer ? "email is turned off (MAIL_TRANSPORT=none)" : undefined;
        const msg = await this.repos.messages.create({ tenantId, template, subject, relatedId, status: skip ? "skipped" : "queued", ...(to ? { to } : {}), ...(skip ? { error: skip } : {}) });
        if (skip) return;
        try {
          await this.mailer!.send({ to: to!, subject: r.subject, text: r.text, html: r.html, attachments: r.attachments });
          await this.repos.messages.setStatus(msg.id, "sent", { sentAt: new Date() });
        } catch (e) {
          await this.repos.messages.setStatus(msg.id, "failed", { error: (e as Error).message.slice(0, 300) });
          console.warn(`[email] ${template} to ${to} failed: ${(e as Error).message}`);
        }
      } catch (e) {
        console.warn(`[email] ${template} could not be prepared: ${(e as Error).message}`);
      }
    })();
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
    return job;
  }

  /** Platform email (codes, account notices), not on behalf of a business: logged under "platform". */
  platformEmail(to: string, template: string, r: Rendered) {
    const job = (async () => {
      if (!this.mailer) {
        await this.repos.messages.create({ tenantId: "platform", template, subject: r.subject, to, status: "skipped", error: "email is turned off (MAIL_TRANSPORT=none)" });
        // Local development without a mail server: print it so you can still sign up. Never in production.
        if (!this.config.production) console.log(`[email] ${template} for ${to}: ${r.subject}`);
        return;
      }
      const msg = await this.repos.messages.create({ tenantId: "platform", template, subject: r.subject, to, status: "queued" });
      try {
        await this.mailer.send({ to, subject: r.subject, text: r.text, html: r.html });
        await this.repos.messages.setStatus(msg.id, "sent", { sentAt: new Date() });
      } catch (e) {
        await this.repos.messages.setStatus(msg.id, "failed", { error: (e as Error).message.slice(0, 300) });
        console.warn(`[email] ${template} to ${to} failed: ${(e as Error).message}`);
      }
    })();
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
    return job;
  }

  leadReceived(t: Tenant, lead: Lead) {
    return Promise.all([
      this.deliver(t, "lead_received_customer", lead.email, lead.id, async () => templates.leadReceivedCustomer(t, lead)),
      this.deliver(t, "lead_received_owner", t.ownerEmail, lead.id, async () => templates.leadReceivedOwner(t, lead, tenantUrl(this.config, t, "/app#/leads"))),
    ]);
  }

  estimateSent(t: Tenant, e: Estimate) {
    return this.deliver(t, "estimate_sent", e.customer?.email, e.id, async () => templates.estimateSent(t, e));
  }

  invoiceIssued(t: Tenant, inv: Invoice) {
    return this.deliver(t, "invoice_issued", inv.billTo?.email, inv.id, async () => ({
      ...templates.invoiceIssued(t, inv),
      attachments: [{ filename: `${inv.number}.pdf`, content: await renderInvoicePdf(inv, t), contentType: "application/pdf" }],
    }));
  }

  paymentReceived(t: Tenant, inv: Invoice, receipt: Receipt) {
    return this.deliver(t, "payment_receipt", inv.billTo?.email, inv.id, async () => templates.paymentReceipt(t, receipt));
  }

  async fundingDecision(app: FundingApplication) {
    const t = await this.repos.tenants.findById(app.tenantId);
    if (!t) return;
    return this.deliver(t, `funding_${app.decision?.outcome ?? "update"}`, t.ownerEmail, app.id, async () =>
      templates.fundingDecision(t, app, applicantView(app), tenantUrl(this.config, t, `/app#/funding/${app.id}`)),
    );
  }
}

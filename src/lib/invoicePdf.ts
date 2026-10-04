import PDFDocument from "pdfkit";
import type { Invoice, PublicTenant } from "../domain";
import { formatUSD, lineTotalCents } from "./money";

/** Renders an invoice to a PDF buffer. `compress: false` keeps text searchable for tests. */
export function renderInvoicePdf(
  invoice: Invoice,
  tenant: Pick<PublicTenant, "name">,
  opts: { compress?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54, compress: opts.compress ?? true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text(tenant.name);
    doc.moveDown(0.5).fontSize(12).text(`Invoice ${invoice.number}`);
    doc.text(`Issued ${invoice.createdAt.toISOString().slice(0, 10)}`);
    doc.text(`Status: ${invoice.status.toUpperCase()}`);
    if (invoice.billTo) {
      doc.moveDown(0.6).font("Helvetica-Bold").text("Bill to").font("Helvetica");
      doc.text(invoice.billTo.name);
      if (invoice.billTo.phone) doc.text(invoice.billTo.phone);
      if (invoice.billTo.email) doc.text(invoice.billTo.email);
    }
    doc.moveDown();

    const cols = { desc: 54, qty: 330, unit: 390, total: 470 };
    const y0 = doc.y;
    doc.font("Helvetica-Bold");
    doc.text("Description", cols.desc, y0).text("Qty", cols.qty, y0).text("Unit", cols.unit, y0).text("Amount", cols.total, y0);
    doc.font("Helvetica").moveDown(0.5);
    for (const item of invoice.lineItems) {
      const y = doc.y;
      doc.text(item.description, cols.desc, y, { width: 260 });
      const after = doc.y;
      doc.text(String(item.quantity), cols.qty, y);
      doc.text(formatUSD(item.unitPriceCents), cols.unit, y);
      doc.text(formatUSD(lineTotalCents(item)), cols.total, y);
      doc.y = Math.max(after, doc.y);
      doc.moveDown(0.3);
    }

    doc.moveDown();
    const t = invoice.totals;
    const rows: [string, string][] = [
      ["Subtotal", formatUSD(t.subtotalCents)],
      [`Tax (${(invoice.taxRateBps / 100).toFixed(2)}%)`, formatUSD(t.taxCents)],
      ["Total", formatUSD(t.totalCents)],
    ];
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.font(label === "Total" ? "Helvetica-Bold" : "Helvetica");
      doc.text(label, cols.unit - 60, y).text(value, cols.total, y);
    }
    doc.end();
  });
}

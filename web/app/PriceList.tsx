// The business's items and services. The AI only quotes from this list, at these prices.
import { useEffect, useMemo, useState } from "react";
import type { PriceItem } from "../../src/domain";
import { api } from "../api";
import { ErrorText } from "../ui/bits";

type Row = { key: number; sku: string; name: string; price: string; unit: string; fractional: boolean };
let nextKey = 1;
const toRow = (p: PriceItem): Row => ({ key: nextKey++, sku: p.sku, name: p.name, price: (p.unitPriceCents / 100).toFixed(2), unit: p.unit ?? "", fractional: !!p.fractional });
const blank = (): Row => ({ key: nextKey++, sku: "", name: "", price: "", unit: "", fractional: false });
const cents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);
const toItem = (r: Row): PriceItem => ({
  sku: r.sku.trim().toUpperCase(),
  name: r.name.trim(),
  unitPriceCents: cents(r.price),
  ...(r.unit.trim() ? { unit: r.unit.trim() } : {}),
  ...(r.fractional ? { fractional: true } : {}),
});
/** "Water heater flush" → "WATER-HEATER-FLUSH" (shortened), for rows where the owner skips the code. */
const codeFrom = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "ITEM";

/** Splits one CSV line, honouring "quoted, fields". */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Accepts "code,name,price,unit,sold_in_parts" (header optional; code, unit and parts optional). */
export function parsePriceCsv(text: string): { rows: Row[]; problems: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const problems: string[] = [];
  const rows: Row[] = [];
  if (!lines.length) return { rows, problems: ["The file is empty"] };
  const NAME = ["name", "description", "item", "service"], PRICE = ["price", "rate", "cost", "amount"];
  let header = csvCells(lines[0]!).map((h) => h.toLowerCase());
  const has = (h: string, names: string[]) => names.some((n) => h.includes(n));
  const hasHeader = header.some((h) => has(h, NAME) || has(h, PRICE)) && !header.some((h) => /^\$?\d/.test(h));
  if (!hasHeader) header = ["code", "name", "price", "unit", "sold_in_parts"];
  const col = (...names: string[]) => header.findIndex((h) => has(h, names));
  const iCode = col("code", "sku"), iName = col(...NAME), iPrice = col(...PRICE), iUnit = header.findIndex((h) => has(h, ["unit", "per"]) && !has(h, PRICE)), iParts = col("part", "fraction", "decimal");
  if (iName < 0 || iPrice < 0) return { rows, problems: ['Add a header row with at least "name" and "price" columns'] };
  lines.slice(hasHeader ? 1 : 0).forEach((line, n) => {
    const c = csvCells(line);
    const name = c[iName] ?? "";
    const price = c[iPrice] ?? "";
    if (!name || !price || !Number.isFinite(cents(price)) || cents(price) < 0) {
      problems.push(`Line ${n + (hasHeader ? 2 : 1)}: needs a name and a price`);
      return;
    }
    rows.push({ key: nextKey++, sku: (iCode >= 0 && c[iCode]) || codeFrom(name), name, price: (cents(price) / 100).toFixed(2), unit: iUnit >= 0 ? c[iUnit] ?? "" : "", fractional: iParts >= 0 && /^(y|yes|true|1)$/i.test(c[iParts] ?? "") });
  });
  return { rows, problems };
}

function toCsv(items: PriceItem[]) {
  const q = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ["code,name,price,unit,sold_in_parts", ...items.map((i) => [i.sku, i.name, (i.unitPriceCents / 100).toFixed(2), i.unit ?? "", i.fractional ? "yes" : "no"].map(q).join(","))].join("\n");
}

export function PriceList() {
  const [saved, setSaved] = useState<PriceItem[] | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [tax, setTax] = useState("");
  const [savedTax, setSavedTax] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  useEffect(() => {
    api<{ priceList: PriceItem[] }>("/price-list").then((r) => {
      setSaved(r.priceList);
      setRows(r.priceList.length ? r.priceList.map(toRow) : [blank()]);
    }, setError);
    api<{ settings: { taxRateBps: number } }>("/settings").then((r) => {
      const t = (r.settings.taxRateBps / 100).toString();
      setTax(t);
      setSavedTax(t);
    }, () => {});
  }, []);

  const filled = rows.filter((r) => r.name.trim() || r.price.trim() || r.sku.trim());
  const items = useMemo(() => filled.map((r) => toItem({ ...r, sku: r.sku.trim() || codeFrom(r.name) })), [filled]);
  const dirty = saved !== null && (JSON.stringify(items) !== JSON.stringify(saved) || tax !== savedTax);
  const set = (key: number, patch: Partial<Row>) => {
    setStatus(null);
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  async function save() {
    const bad = filled.findIndex((r) => !r.name.trim() || !r.price.trim() || !Number.isFinite(cents(r.price)) || cents(r.price) < 0);
    if (bad >= 0) {
      setError(new Error(`Row ${rows.indexOf(filled[bad]!) + 1} needs a name and a price`));
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const r = await api<{ priceList: PriceItem[] }>("/price-list", { method: "PUT", json: items });
      setSaved(r.priceList);
      setRows(r.priceList.length ? r.priceList.map(toRow) : [blank()]);
      if (tax !== savedTax) {
        await api("/settings", { method: "PATCH", json: { taxRateBps: Math.round(Number(tax || 0) * 100) } });
        setSavedTax(tax);
      }
      setStatus(`Saved ${r.priceList.length} item${r.priceList.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(file: File) {
    const { rows: imported, problems } = parsePriceCsv(await file.text());
    if (imported.length) {
      setRows((rs) => {
        // Same code replaces the existing row; new codes are added
        const byCode = new Map(rs.filter((r) => r.name.trim() || r.sku.trim()).map((r) => [(r.sku || codeFrom(r.name)).toUpperCase(), r]));
        for (const r of imported) byCode.set(r.sku.toUpperCase(), r);
        return [...byCode.values()];
      });
    }
    setImportNote(`${imported.length} item${imported.length === 1 ? "" : "s"} read from ${file.name}${problems.length ? `; skipped: ${problems.slice(0, 3).join("; ")}` : ""}. Review them, then Save.`);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([toCsv(saved ?? [])], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "price-list.csv" });
    a.click();
    URL.revokeObjectURL(url);
  }

  if (saved === null) return <ErrorText error={error} />;
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Price list</h2>
        <div className="row">
          <label className="button secondary small file-button" data-tour="price-import">
            Import CSV
            <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ""; }} />
          </label>
          {saved.length > 0 && <button className="secondary small" onClick={download}>Download CSV</button>}
        </div>
      </div>
      <p className="quiet">
        Everything you sell, at your prices. When you press Draft estimate on a lead, the AI only picks from this list and never sets a price itself.
      </p>
      {importNote && <p className="small" role="status">{importNote}</p>}

      <div className="table-wrap">
        <table className="price-table" data-tour="price-table">
          <thead>
            <tr>
              <th>Item or service</th>
              <th className="num">Price ($)</th>
              <th>Per</th>
              <th title="Can be sold in parts, like 1.5 hours or 12.5 feet">Parts OK</th>
              <th>Code</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td><input aria-label={`Name, row ${i + 1}`} value={r.name} placeholder="Water heater flush" maxLength={200} onChange={(e) => set(r.key, { name: e.target.value })} /></td>
                <td className="num"><input aria-label={`Price, row ${i + 1}`} value={r.price} placeholder="129.00" inputMode="decimal" className="num" onChange={(e) => set(r.key, { price: e.target.value })} /></td>
                <td><input aria-label={`Unit, row ${i + 1}`} value={r.unit} placeholder="each" maxLength={20} onChange={(e) => set(r.key, { unit: e.target.value })} /></td>
                <td style={{ textAlign: "center" }}><input type="checkbox" aria-label={`Can be sold in parts, row ${i + 1}`} checked={r.fractional} onChange={(e) => set(r.key, { fractional: e.target.checked })} style={{ width: "auto" }} /></td>
                <td><input aria-label={`Code, row ${i + 1}`} value={r.sku} placeholder={r.name ? codeFrom(r.name) : "auto"} maxLength={40} onChange={(e) => set(r.key, { sku: e.target.value.toUpperCase() })} /></td>
                <td><button className="secondary small" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button className="secondary" onClick={() => setRows((rs) => [...rs, blank()])}>+ Add item</button></div>

      <div className="row" style={{ alignItems: "end" }}>
        <label style={{ maxWidth: "10rem" }}>
          Sales tax %
          <input value={tax} onChange={(e) => { setStatus(null); setTax(e.target.value); }} inputMode="decimal" placeholder="8.75" />
        </label>
        <span className="small quiet">Added to new estimates. Issued invoices keep the rate they were issued with.</span>
      </div>

      <ErrorText error={error} />
      <div className="row">
        <button onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save price list"}</button>
        {status && <span role="status" className="small">{status}</span>}
        {dirty && !busy && <span className="small quiet">Unsaved changes</span>}
      </div>
      <details className="small quiet">
        <summary>CSV format</summary>
        <p style={{ marginTop: "0.5rem" }}>
          Columns: <code>name, price</code>, and optionally <code>code, unit, sold_in_parts</code> (yes/no), with a header row. A row with an existing code replaces that item.
        </p>
        <pre className="csv-sample">{"code,name,price,unit,sold_in_parts\nSVC-CALL,Service call,89.00,,no\nLABOR,Labor,95.00,hour,yes\nFAUCET,Faucet replacement,220.00,,no"}</pre>
      </details>
    </>
  );
}

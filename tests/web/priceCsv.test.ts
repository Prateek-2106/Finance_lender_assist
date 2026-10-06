import { parsePriceCsv } from "../../web/app/PriceList";

describe("parsePriceCsv", () => {
  it("reads a header file with quoted names, optional columns and parts", () => {
    const { rows, problems } = parsePriceCsv('code,name,price,unit,sold_in_parts\nLABOR,Labor,95,hour,yes\n,"Faucet, kitchen",$220.50,,no\n');
    expect(problems).toEqual([]);
    expect(rows.map(({ key: _k, ...r }) => r)).toEqual([
      { sku: "LABOR", name: "Labor", price: "95.00", unit: "hour", fractional: true },
      { sku: "FAUCET-KITCHEN", name: "Faucet, kitchen", price: "220.50", unit: "", fractional: false },
    ]);
  });

  it("matches loose header names in any order", () => {
    const { rows } = parsePriceCsv("Service,Rate\nDrain cleaning,150");
    expect(rows[0]).toMatchObject({ name: "Drain cleaning", price: "150.00", sku: "DRAIN-CLEANING" });
    expect(parsePriceCsv("Item,Unit price,Per\nLabor,95,hour").rows[0]).toMatchObject({ name: "Labor", price: "95.00", unit: "hour" });
  });

  it("skips bad lines and explains why", () => {
    const { rows, problems } = parsePriceCsv("name,price\nGood,10\nNo price,\n,5\nBad,abc");
    expect(rows).toHaveLength(1);
    expect(problems).toEqual(["Line 3: needs a name and a price", "Line 4: needs a name and a price", "Line 5: needs a name and a price"]);
  });

  it("reads a file with no header as code,name,price,unit,parts", () => {
    expect(parsePriceCsv("SVC,Service call,89").rows[0]).toMatchObject({ sku: "SVC", name: "Service call", price: "89.00" });
    expect(parsePriceCsv("").problems).toEqual(["The file is empty"]);
  });
});

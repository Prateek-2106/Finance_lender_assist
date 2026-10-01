// npm run fixtures → writes fixtures/statements/<key>.csv and <key>.application.json
import { writeFileSync, mkdirSync } from "node:fs";
import { PROFILES } from "./profiles";
import { generateStatement, toCsv } from "./generate";

mkdirSync("fixtures/statements", { recursive: true });
for (const p of PROFILES) {
  const lines = generateStatement(p);
  writeFileSync(`fixtures/statements/${p.key}.csv`, toCsv(p, lines));
  const { industry, monthsInBusiness, statedMonthlyRevenueCents, amountRequestedCents, useOfFunds } = p;
  writeFileSync(
    `fixtures/statements/${p.key}.application.json`,
    JSON.stringify({ industry, monthsInBusiness, statedMonthlyRevenueCents, amountRequestedCents, useOfFunds }, null, 2) + "\n",
  );
  const n = (c: string) => lines.filter((l) => l.truth === c).length;
  console.log(`${p.key.padEnd(22)} ${String(lines.length).padStart(4)} lines  revenue ${n("revenue")}  nsf ${n("nsf_fee")}  lender ${n("lender_payment")}  ending $${(lines.at(-1)!.balanceCents / 100).toFixed(2)}`);
}

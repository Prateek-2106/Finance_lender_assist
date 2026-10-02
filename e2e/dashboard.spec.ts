import { test, expect } from "@playwright/test";
import { E2E_KEY } from "../scripts/e2e-server";

test.describe.configure({ mode: "serial" });

test("a customer requests a quote on the business's website", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Joe's Plumbing" })).toBeVisible();
  await page.getByLabel("Your name").fill("Ann Lee");
  await page.getByLabel("Phone").fill("716-555-0123");
  await page.getByLabel("What do you need?").fill("Water heater pops and the relief valve drips.");
  await page.getByRole("button", { name: "Request a quote" }).click();
  await expect(page.getByRole("status")).toContainText("we got your request");
});

test("website validation errors are shown, not swallowed", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your name").fill("No Contact");
  await page.getByLabel("What do you need?").fill("hi");
  await page.getByRole("button", { name: "Request a quote" }).click();
  await expect(page.getByRole("alert")).toContainText("phone or an email");
});

test("a wrong API key is refused", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("API key").fill("sk_wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText(/does not match/);
});

test("the owner drafts an estimate from the lead, approves it, invoices and gets paid", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("API key").fill(E2E_KEY);
  await page.getByRole("button", { name: "Sign in" }).click();

  const row = page.getByRole("row", { name: /Ann Lee/ });
  await expect(row).toContainText("Water heater pops");
  await row.getByRole("button", { name: "Draft estimate" }).click();

  const est = page.getByRole("region", { name: "Estimate" });
  await expect(est).toContainText("Needs review");
  await expect(est).toContainText("Water heater flush");
  await expect(est).toContainText("Left out: GOLD-PLATING (not on the price list)");
  await expect(est).toContainText("$189.23"); // 129 + 45 = 174.00, + 8.75% tax 15.23

  await est.getByLabel("Quantity for Pressure relief valve").fill("2");
  await est.getByRole("button", { name: "Save changes" }).click();
  await expect(est).toContainText("$238.16"); // 129 + 90 = 219.00; tax 19.1625 → 19.16

  for (const action of ["Approve draft", "Send to customer", "Mark accepted", "Create invoice"])
    await est.getByRole("button", { name: action }).click();
  await expect(est).toContainText("Invoice INV-0001");
  await est.getByRole("button", { name: /Record payment of \$238\.16/ }).click();
  await expect(est.getByRole("status")).toContainText("Payment recorded: $238.16 for INV-0001");
});

test("an underwriter assesses a funding application and reads the checked memo", async ({ page }) => {
  await page.goto("/app#/funding");
  await page.getByLabel("API key").fill(E2E_KEY);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByRole("button", { name: "New application" }).click();
  const form = page.getByRole("form", { name: "New application" });
  await form.getByLabel("Industry").fill("auto repair");
  await form.getByLabel("Months in business").fill("48");
  await form.getByLabel("Monthly revenue ($)").fill("60,000");
  await form.getByLabel("Amount requested ($)").fill("60,000");
  await form.getByLabel("What it's for").fill("Working capital");
  await form.getByRole("button", { name: "Create application" }).click();

  const app = page.getByRole("region", { name: "Application" });
  await app.getByLabel(/Bank statement/).setInputFiles("fixtures/statements/stacked-auto.csv");
  await expect(app.getByRole("status")).toContainText("533 new");
  await app.getByRole("button", { name: "Assess", exact: true }).click();

  await expect(app.getByTestId("decision")).toHaveText("Review");
  await expect(app).toContainText("Band B, score 85 of 100");
  await expect(app.getByTestId("seg-M7")).toHaveAttribute("data-fraction", "0.00");
  await expect(app.getByTestId("seg-M7")).toHaveClass(/flag/);
  await expect(app.getByTestId("reasons")).toContainText("Existing lender payments of $823 a day");

  await app.getByRole("button", { name: "Write memo" }).click();
  const memo = app.getByTestId("memo");
  await expect(memo).toContainText("take 22.2% of revenue");
  // the fabricated claim (cites M9, which doesn't exist) is not in the memo itself…
  await expect(memo.getByText(/bankruptcy/)).toBeHidden();
  // …only in the collapsed list of what the fact check removed, with the reason
  await memo.getByText("1 claim removed by the fact check").click();
  await expect(memo.getByText(/bankruptcy/)).toBeVisible();
  await expect(memo).toContainText("cites unknown source M9");

  await page.getByRole("link", { name: "Funding" }).click();
  await expect(page.getByRole("row", { name: /auto repair/ })).toContainText("Review");
});

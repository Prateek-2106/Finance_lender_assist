import { test, expect, type Page } from "@playwright/test";
import { E2E_KEY, E2E_UW_KEY } from "./constants";

test.describe.configure({ mode: "serial" });

const signIn = async (page: Page, path = "/app") => {
  await page.goto(path);
  await page.getByLabel("API key").fill(E2E_KEY);
  await page.getByRole("button", { name: "Sign in" }).click();
};
const emails = async (page: Page) =>
  (await (await page.request.get("http://localhost:3100/__test/emails")).json()) as { to: string; subject: string; text: string; attachments: string[] }[];

test("a customer requests a quote on the business's website", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Joe's Plumbing" })).toBeVisible();
  await page.getByLabel("Your name").fill("Ann Lee");
  await page.getByLabel("Phone").fill("716-555-0123");
  await page.getByLabel("Email").fill("ann@example.test");
  await page.getByLabel("What do you need?").fill("Water heater pops and the relief valve drips.");
  await page.getByRole("button", { name: "Request a quote" }).click();
  await expect(page.getByRole("status")).toContainText("we got your request");
  await expect.poll(async () => (await emails(page)).map((e) => e.subject)).toEqual(
    expect.arrayContaining(["We got your request - Joe's Plumbing", "New request: Ann Lee"]),
  );
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

test("the owner drafts an estimate for the customer, invoices them and gets paid, with emails at each stage", async ({ page }) => {
  await signIn(page);
  const row = page.getByRole("row", { name: /Ann Lee/ });
  await row.getByRole("button", { name: "Draft estimate" }).click();

  const est = page.getByRole("region", { name: "Estimate" });
  await expect(est.getByTestId("customer")).toContainText("For Ann Lee");
  await expect(est.getByTestId("customer")).toContainText("ann@example.test");
  await expect(est).toContainText("Left out: GOLD-PLATING (not on the price list)");
  await expect(est.getByLabel("Quantity for Pressure relief valve")).toHaveAttribute("step", "1");
  await est.getByLabel("Quantity for Pressure relief valve").fill("2");
  await est.getByRole("button", { name: "Save changes" }).click();
  await expect(est).toContainText("$238.16");

  for (const action of ["Approve draft", "Send to customer", "Mark accepted", "Create invoice"]) await est.getByRole("button", { name: action }).click();
  await expect(est.getByTestId("bill-to")).toHaveText("Bill to Ann Lee, +17165550123, ann@example.test");
  await est.getByRole("button", { name: /Record payment of \$238\.16/ }).click();
  await expect(est.getByRole("status")).toContainText("A receipt was emailed to ann@example.test");

  await expect.poll(async () => (await emails(page)).filter((e) => e.to === "ann@example.test").map((e) => e.subject)).toEqual([
    "We got your request - Joe's Plumbing",
    "Your estimate from Joe's Plumbing: $238.16",
    "Invoice INV-0001 from Joe's Plumbing",
    "Receipt for INV-0001 - Joe's Plumbing",
  ]);
  expect((await emails(page)).find((e) => e.subject.startsWith("Invoice"))!.attachments).toEqual(["INV-0001.pdf"]);
});

test("the owner applies for funding and is told, in plain words, that a person is reviewing it", async ({ page }) => {
  await signIn(page, "/app#/funding");
  await page.getByRole("button", { name: "New application" }).click();
  const form = page.getByRole("form", { name: "New application" });
  await form.getByLabel("What kind of business is it?").fill("auto repair");
  await form.getByLabel("Months in business").fill("48");
  await form.getByLabel("Monthly sales ($)").fill("60,000");
  await form.getByLabel("How much do you need ($)?").fill("60,000");
  await form.getByLabel("What's it for?").fill("Working capital");
  await form.getByRole("button", { name: "Create application" }).click();

  const app = page.getByRole("region", { name: "Application" });
  await app.getByLabel("Bank statement CSV").setInputFiles("fixtures/statements/stacked-auto.csv");
  await expect(app.getByRole("status")).toContainText("533 new");
  await app.getByRole("button", { name: "See what I qualify for" }).click();

  const card = app.getByTestId("applicant-card");
  await expect(card.getByRole("heading")).toHaveText("A specialist is reviewing your application");
  await expect(card).toContainText("Payments on your existing loans or advances, about $823 each business day");
  await expect(card).toContainText("Paying off or finishing one of your current advances would make room");
  await expect(app.getByTestId("memo")).toHaveCount(0); // the underwriting memo is internal
  await app.getByText("How we decided").click();
  await expect(app.getByTestId("seg-M7")).toHaveClass(/flag/);
});

test("an underwriter reviews the case, checks the AI memo, and approves with a note the owner can see", async ({ page }) => {
  await page.goto("/underwriting");
  await page.getByLabel("Underwriter key").fill(E2E_UW_KEY);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Signed in as Priya Shah")).toBeVisible();

  await page.getByRole("row", { name: /Joe's Plumbing/ }).first().click();
  const c = page.getByRole("region", { name: "Case" });
  await expect(c.getByTestId("engine-decision")).toHaveText("Review");
  await c.getByRole("button", { name: "Write memo" }).click();
  await expect(c.getByTestId("memo")).toContainText("take 22.2% of revenue");
  await expect(c.getByTestId("memo").getByText(/bankruptcy/)).toBeHidden();

  const form = c.getByRole("form", { name: "Decision" });
  await form.getByLabel("Amount ($)").fill("15000");
  await expect(form.getByTestId("preview")).toContainText("Repays $20,250.00 at $202.50 a day");
  await form.getByLabel("Note (the business will see this)").fill("One of your advances finishes this month, so a smaller amount fits.");
  await form.getByRole("button", { name: "Approve $15,000.00" }).click();
  await expect(c.getByTestId("current-decision")).toContainText("by Priya Shah");

  await signIn(page, "/app#/funding");
  await page.getByRole("row", { name: /auto repair/ }).click();
  const card = page.getByRole("region", { name: "Application" }).getByTestId("applicant-card");
  await expect(card.getByRole("heading")).toHaveText("You're approved for $15,000");
  await expect(card).toContainText("Note from the reviewer: One of your advances finishes this month");
  await expect(card.getByTestId("decided-by")).toContainText("Reviewed by Priya Shah");
  await expect.poll(async () => (await emails(page)).filter((e) => e.to === "joe@joesplumbing.test").map((e) => e.subject)).toContain("You're approved - $60,000 request");
});

test("statistics show what happened after payment, and every email sent", async ({ page }) => {
  await signIn(page, "/app#/statistics");
  const pipeline = page.getByRole("region", { name: "Pipeline" });
  await expect(pipeline.getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.locator(".kpi", { hasText: "Gross income" })).toContainText("$219"); // $238.16 paid, less $19.16 sales tax
  const log = page.getByRole("region", { name: "Emails sent" });
  await expect(log.getByRole("row", { name: /Invoice ann@example.test Sent/ })).toBeVisible();
  await expect(log.getByRole("row", { name: /Funding: approved/ })).toBeVisible();
});

test("the owner adds a service to the price list, imports more from a CSV, and it all persists", async ({ page }) => {
  await signIn(page, "/app#/prices");
  await expect(page.getByRole("heading", { name: "Price list" })).toBeVisible();
  const rows = page.locator(".price-table tbody tr");
  const before = await rows.count();
  await page.getByRole("button", { name: "+ Add item" }).click();
  await page.getByLabel(`Name, row ${before + 1}`).fill("Drain cleaning");
  await page.getByRole("button", { name: "Save price list" }).click();
  await expect(page.getByRole("alert")).toHaveText(`Row ${before + 1} needs a name and a price`);
  await page.getByLabel(`Price, row ${before + 1}`).fill("150");
  await page.getByLabel("Sales tax %").fill("8.75");
  await page.getByRole("button", { name: "Save price list" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toContainText(`Saved ${before + 1} items`);

  await page.locator('input[type="file"]').setInputFiles({
    name: "prices.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('name,price,unit,sold_in_parts\nCamera inspection,199,,no\n"Trenching, per foot",12.5,foot,yes\n'),
  });
  await expect(page.getByText("2 items read from prices.csv")).toBeVisible();
  await page.getByRole("button", { name: "Save price list" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toContainText(`Saved ${before + 3} items`);

  await page.reload();
  await expect(rows).toHaveCount(before + 3);
  await expect(page.getByLabel(`Name, row ${before + 1}`)).toHaveValue("Drain cleaning");
  await expect(page.getByLabel(`Code, row ${before + 1}`)).toHaveValue("DRAIN-CLEANING");
  await expect(page.getByLabel(`Can be sold in parts, row ${before + 3}`)).toBeChecked();
  await expect(page.getByLabel("Sales tax %")).toHaveValue("8.75");
});

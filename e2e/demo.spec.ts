import { test, expect } from "@playwright/test";

// A visitor on the main domain: one click to their own business, then both sides of the product.
test("Try it: a visitor gets a lived-in demo business and can act as the underwriter", async ({ page, context }) => {
  await page.goto("http://localhost:3100/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("small business");
  await page.getByRole("button", { name: /Try it/ }).click();

  await page.waitForURL(/demo-[0-9a-f]{6}\.lvh\.me:3100\/app#\/requests$/); // opens where the work starts; the key left the address bar
  await expect(page.getByLabel("Demo business")).toContainText("made up");
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link")).toHaveText(["Requests", "Statistics", "Estimates", "Price list", "Funding"]);
  await expect(page.getByRole("dialog")).toHaveCount(0); // no walkthrough unless asked for
  await expect(page.getByRole("row", { name: /Jordan Ellis/ }).getByRole("button", { name: "Draft estimate" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Tom Okafor/ }).getByText("Invoiced")).toBeVisible(); // done jobs aren't re-drafted

  // Emails are written but never sent: a new request shows up as a viewable message
  const host = new URL(page.url()).host;
  // Straight to the server with the business's Host header: no DNS needed for the random demo subdomain
  await page.request.post("http://localhost:3100/api/leads", { headers: { Host: host }, data: { name: "Visitor Test", email: "visitor@example.test", message: "Testing the demo" } });
  await page.goto(`http://${host}/app#/statistics`);
  await page.getByRole("button", { name: /View email: New request: Visitor Test/ }).click();
  await expect(page.getByRole("dialog", { name: "Email preview" })).toContainText("not sent");
  await expect(page.frameLocator("iframe.email-frame").getByText("Testing the demo")).toBeVisible();
  await page.keyboard.press("Escape");
  const outbox = (await (await page.request.get("http://localhost:3100/__test/emails")).json()) as { to: string }[];
  expect(outbox.map((e) => e.to)).not.toContain("visitor@example.test");

  // The other side: the public underwriter key, scoped to demo businesses, this visitor's case first
  await page.goto(`http://${host}/app#/funding`);
  await page.getByRole("link", { name: "Open the underwriter console" }).click();
  const uw = page;
  await expect(uw.getByLabel("Demo underwriter")).toBeVisible();
  expect(uw.url()).not.toContain("key=");
  const mine = uw.getByRole("row", { name: /Maple Street Plumbing.*Yours/ }).first();
  await mine.click();
  const c = uw.getByRole("region", { name: "Case" });
  const form = c.getByRole("form", { name: "Decision" });
  await form.getByRole("radio", { name: "Decline" }).check();
  await form.getByLabel("Note (the business will see this)").fill("Existing advances already take too much of daily revenue.");
  await form.getByRole("button", { name: "Decline" }).click();
  await expect(c.getByTestId("current-decision")).toContainText("by Demo underwriter");

  // Back to the business without being asked for a key, in this tab and in a new one
  await uw.getByRole("link", { name: "Back to the business" }).click();
  await expect(page.getByRole("heading", { name: "Funding" })).toBeVisible();
  const again = await context.newPage();
  await again.goto(`http://${host}/app#/leads`); // an old address, from emails sent before the rename
  await expect(again.getByRole("heading", { name: "Requests" })).toBeVisible();
  await expect(again).toHaveURL(/#\/requests$/);
  await expect(again.getByLabel("API key")).toHaveCount(0);
});

test("every number on Statistics opens to the jobs and invoices behind it", async ({ page }) => {
  const demo = await (await page.request.post("http://lvh.me:3100/api/demo")).json();
  await page.goto(demo.dashboardUrl);
  await page.getByRole("link", { name: "Statistics" }).click();
  const gross = page.locator("a.kpi", { hasText: "Gross income" });
  const amount = (await gross.locator(".v").textContent())!;

  // The all-time number opens to every paid invoice, and they add up to it
  await gross.click();
  await expect(page).toHaveURL(/#\/statistics\/paid$/);
  await expect(page.getByRole("heading", { name: "Gross income, all time" })).toBeVisible();
  await expect(page.getByTestId("source-summary")).toContainText(amount.replace(/\$/, "$").replace(/,/g, ","));

  // A month opens to the services you were paid for that month
  await page.getByRole("link", { name: "← Statistics" }).click();
  const bar = page.locator("a.bar").filter({ has: page.locator(".tip", { hasText: /from [1-9]/ }) }).last();
  const label = (await bar.getAttribute("aria-label"))!; // "September 2026: $1,234.00 from 3 invoices. See the jobs"
  await bar.click();
  const [month, money] = /^(\w+ \d{4}): (\$[\d,.]+)/.exec(label)!.slice(1);
  await expect(page.getByRole("heading", { name: `Gross income, ${month}` })).toBeVisible();
  await expect(page.getByTestId("source-summary")).toContainText(money!);
  const services = page.getByRole("region", { name: "Services" });
  await expect(services.locator("tbody tr").first()).toBeVisible();
  await expect(services.locator("tfoot")).toContainText(money!);

  // ...and each invoice opens the job itself
  await page.getByTestId("source-invoices").getByRole("link").first().click();
  await expect(page).toHaveURL(/#\/estimates\//);
  await expect(page.getByRole("region", { name: "Estimate" })).toBeVisible();

  // What's owed opens to the unpaid invoice; customers and requests open to their lists
  await page.goto(demo.dashboardUrl.replace(/#.*/, "#/statistics"));
  await page.locator("a.kpi", { hasText: "Owed to you" }).click();
  await expect(page.getByTestId("source-invoices").locator("tbody tr")).toHaveCount(1);
  await page.getByRole("link", { name: "← Statistics" }).click();
  await page.getByRole("link", { name: /came back/ }).click();
  await expect(page.getByRole("heading", { name: "Customers who came back" })).toBeVisible();
  await page.goBack();
  await page.locator('a.funnel-row[href="#/statistics/requests"]').click();
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  await expect(page).toHaveURL(/#\/statistics\/requests$/);
});

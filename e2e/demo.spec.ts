import { test, expect } from "@playwright/test";

// A visitor on the main domain: one click to their own business, then both sides of the product.
test("Try it: a visitor gets a lived-in demo business and can act as the underwriter", async ({ page, context }) => {
  await page.goto("http://localhost:3100/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("small business");
  await page.getByRole("button", { name: /Try it/ }).click();

  await page.waitForURL(/demo-[0-9a-f]{6}\.lvh\.me:3100\/app#\/leads$/); // the key left the address bar
  await expect(page.getByLabel("Demo business")).toContainText("made up");
  await expect(page.getByRole("row", { name: /Jordan Ellis/ }).getByRole("button", { name: "Draft estimate" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Tom Okafor/ }).getByText("Invoiced")).toBeVisible(); // done jobs aren't re-drafted

  // Emails are written but never sent: a new request shows up as a viewable message
  const host = new URL(page.url()).host;
  await page.request.post(`http://${host}/api/leads`, { data: { name: "Visitor Test", email: "visitor@example.test", message: "Testing the demo" } });
  await page.goto(`http://${host}/app#/insights`);
  await page.getByRole("button", { name: /View email: New lead: Visitor Test/ }).click();
  await expect(page.getByRole("dialog", { name: "Email preview" })).toContainText("not sent");
  await expect(page.frameLocator("iframe.email-frame").getByText("Testing the demo")).toBeVisible();
  await page.keyboard.press("Escape");
  const outbox = (await (await page.request.get("http://localhost:3100/__test/emails")).json()) as { to: string }[];
  expect(outbox.map((e) => e.to)).not.toContain("visitor@example.test");

  // The other side: the public underwriter key, scoped to demo businesses, this visitor's case first
  await page.goto(`http://${host}/app#/funding`);
  const [uw] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "Open the underwriter console" }).click()]);
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
});

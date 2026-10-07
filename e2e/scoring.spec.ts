import { test, expect } from "@playwright/test";
import { METRIC_CONFIG, SCORECARD_VERSION } from "../src/risk/config";

test("the funding formula is public, matches the engine, and is one click from any score", async ({ page, context }) => {
  // From the homepage
  await page.goto("http://localhost:3100/");
  await expect(page.getByRole("heading", { name: "How the funding score works" })).toBeVisible();
  await page.getByRole("link", { name: /Every formula, curve and source/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "How funding decisions are made" })).toBeVisible();
  await expect(page.getByText(`scorecard ${SCORECARD_VERSION}`).first()).toBeVisible();
  await expect(page.getByText(/no real credit is offered/i).first()).toBeVisible();
  // one card per measure, with the engine's own weight
  for (const [i, cfg] of Object.values(METRIC_CONFIG).entries()) {
    await expect(page.locator(`#m${i + 1}`)).toContainText(`${cfg.weight} pts`);
  }
  // sources are real links that open elsewhere
  const sources = page.locator("#sources a[href^='https://']");
  expect(await sources.count()).toBeGreaterThanOrEqual(4);

  // From a business's funding answer, next to the score
  await page.goto("http://localhost:3100/");
  await page.getByRole("button", { name: /Try it/ }).click();
  await page.waitForURL(/demo-.*\/app#\/requests$/);
  await page.getByRole("link", { name: "Funding" }).click();
  await page.locator("[data-tour=funding-table] tbody tr").filter({ hasText: "Declined" }).click();
  const [explainer] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: /How every application is scored/ }).click()]);
  await expect(explainer.getByRole("heading", { level: 1 })).toHaveText("How funding decisions are made");

  // A measure cited in a reason links straight to its definition
  await page.getByText("How we decided").click();
  await expect(page.getByRole("link", { name: "How is this scored? →" })).toBeVisible();
  const cite = page.locator(".reasons .cite a").first();
  await expect(cite).toHaveAttribute("href", /^\/scoring#m\d$/);
});

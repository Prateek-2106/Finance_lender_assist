import { test, expect } from "@playwright/test";

test("the walkthrough only opens when asked, guides without blocking, and follows the visitor's clicks", async ({ page }) => {
  await page.goto("http://localhost:3100/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByRole("dialog")).toHaveCount(0); // never pops up by itself

  await page.getByRole("button", { name: /What's this page/ }).click();
  await expect(page.getByRole("dialog", { name: /Run a business/ })).toContainText("1 of 4");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog")).toContainText("Get your own business");
  await page.getByRole("button", { name: /Try it/ }).click(); // doing the outlined thing

  await page.waitForURL(/demo-.*\/app#\/requests$/);
  await page.waitForTimeout(900);
  await expect(page.getByRole("dialog")).toHaveCount(0); // a new page doesn't start one either

  await page.getByRole("link", { name: "Statistics" }).click();
  await page.getByRole("button", { name: /What's this page/ }).click();
  await expect(page.getByRole("dialog")).toContainText("What the work added up to");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog")).toContainText("See where the numbers come from");
  await expect(page.locator(".tour-ring")).toBeVisible();
  await page.getByRole("link", { name: "Requests" }).first().click(); // doing the outlined thing
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0); // the tour ends; this page's starts only on request

  // Nothing is blocked mid-tour, and Escape closes it
  await page.getByRole("button", { name: /What's this page/ }).click();
  await expect(page.getByRole("dialog")).toContainText("1 of 3");
  await page.getByRole("link", { name: "Estimates" }).click();
  await expect(page.getByRole("heading", { name: "Estimates" })).toBeVisible();
  await page.getByRole("button", { name: /What's this page/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Every quote and where it stands");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

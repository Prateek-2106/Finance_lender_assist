import { test, expect } from "@playwright/test";

test("the walkthrough guides without blocking, follows the visitor's clicks, and replays per page", async ({ page }) => {
  await page.goto("http://localhost:3100/");
  const card = page.getByRole("dialog", { name: /One platform|Get your own/ });
  await expect(card).toContainText("1 of 3"); // starts by itself on the homepage
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog")).toContainText("Get your own business");
  await page.getByRole("button", { name: /Try it/ }).click(); // doing the outlined thing

  await page.waitForURL(/demo-.*\/app#\/leads$/);
  const tour = page.getByRole("dialog", { name: "This is your business" });
  await expect(tour).toContainText("1 of 4");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("dialog")).toContainText("Let AI draft the quote");
  await expect(page.locator(".tour-ring")).toBeVisible();

  // Nothing is blocked: the visitor can go anywhere mid-tour
  await page.getByRole("link", { name: "Insights" }).click();
  await expect(page.getByRole("dialog")).toContainText("What happened after"); // that page's own tour
  await page.getByRole("button", { name: "Close the walkthrough" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Seen once: coming back doesn't pop it up again, but the button replays it from the start
  await page.getByRole("link", { name: "Leads" }).click();
  await expect(page.getByRole("button", { name: /What's this page/ })).toBeVisible();
  await page.waitForTimeout(900);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /What's this page/ }).click();
  await expect(page.getByRole("dialog")).toContainText("1 of 4");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

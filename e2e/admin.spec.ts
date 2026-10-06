import { test, expect, type Page } from "@playwright/test";
import { E2E_ADMIN_EMAIL } from "./constants";

const APEX = "http://lvh.me:3100";
const outbox = async (page: Page) => (await (await page.request.get("http://localhost:3100/__test/emails")).json()) as { to: string; subject: string }[];

async function signUp(page: Page, email: string) {
  await page.goto(`${APEX}/signup`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("platform numbers 2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/verify\?email=/);
  let code = "";
  await expect.poll(async () => (code = /\b(\d{6})\b/.exec((await outbox(page)).filter((e) => e.to === email).at(-1)?.subject ?? "")?.[1] ?? "")).not.toBe("");
  await page.getByLabel("Code").fill(code);
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL(`${APEX}/account`);
}

test("the platform owner sees sign-ups, demos and AI spend on /admin; nobody else can", async ({ page, browser }) => {
  // Someone else first: no link, and the page refuses
  const other = await browser.newPage();
  await signUp(other, `someone-${Date.now()}@example.test`);
  await expect(other.getByRole("link", { name: "Platform numbers" })).toHaveCount(0);
  await other.goto(`${APEX}/admin`);
  await expect(other.getByRole("alert")).toContainText("people who run Vendor Street");
  await other.close();

  // A visitor starts a demo
  expect((await page.request.post(`${APEX}/api/demo`)).status()).toBe(201);

  await signUp(page, E2E_ADMIN_EMAIL);
  await page.getByRole("link", { name: "Platform numbers" }).click();
  await page.waitForURL(`${APEX}/admin`);
  const kpis = page.getByTestId("admin-kpis");
  await expect(kpis).toContainText("Confirmed accounts");
  await expect(kpis).toContainText(/demos? live/);

  await page.getByRole("button", { name: "Demos" }).click();
  await expect(page.getByRole("heading", { name: "Demos by day" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Demos by day/ })).toBeVisible();
  await page.getByText("Every day, as a table").click();
  const today = page.getByTestId("admin-days").locator("tbody tr").first();
  await expect(today.locator("td").nth(1)).not.toHaveText("0"); // sign-ups today
  await expect(today.locator("td").nth(2)).not.toHaveText("0"); // demos today
  await expect(page.getByRole("region", { name: "AI usage" })).toContainText("scripted/e2e");
  await expect(page.getByRole("link", { name: "Open the CloudWatch dashboard" })).toHaveAttribute("href", /cloudwatch.*VendorStreet/);
});

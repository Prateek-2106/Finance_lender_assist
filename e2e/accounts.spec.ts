import { test, expect, type Page } from "@playwright/test";

const outbox = async (page: Page) => (await (await page.request.get("http://localhost:3100/__test/emails")).json()) as { to: string; subject: string }[];
const latestCode = async (page: Page, email: string) => {
  let code = "";
  await expect.poll(async () => {
    const m = (await outbox(page)).filter((e) => e.to === email).at(-1);
    code = /\b(\d{6})\b/.exec(m?.subject ?? "")?.[1] ?? "";
    return code;
  }).not.toBe("");
  return code;
};

test("create an account with a password, confirm the email, run a business, reset the password", async ({ page }) => {
  const email = `owner-${Date.now()}@example.test`;
  const pw = "riverside wiring 2026";

  await page.goto("http://lvh.me:3100/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/verify\?email=/);
  await page.getByLabel("Code").fill(await latestCode(page, email));
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL("http://lvh.me:3100/account");
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  const form = page.getByRole("form", { name: "Create a business" });
  await form.getByLabel("Business name").fill("Riverside Electric");
  await form.getByRole("button", { name: "Create business" }).click();
  await expect(page.getByRole("status")).toContainText("Riverside Electric is ready");
  await page.getByRole("link", { name: "Open the dashboard" }).click();
  await page.waitForURL(/riverside-electric\.lvh\.me:3100\/app/);
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  // A new business is pointed at its price list before anything else
  await page.getByRole("link", { name: "Add items and services →" }).click();
  await expect(page.getByRole("heading", { name: "Price list" })).toBeVisible();
  await page.goto("http://riverside-electric.lvh.me:3100/app#/requests");

  // Sign out, then back in with the password
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Use my account" }).click();
  await page.waitForURL(/lvh\.me:3100\/signin\?next=/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("wrong password here");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect");
  await page.getByLabel("Password", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/riverside-electric\.lvh\.me:3100\/app/); // back where they started
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();

  // Forgot password
  await page.context().clearCookies();
  await page.goto("http://lvh.me:3100/forgot");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Code").fill(await latestCode(page, email));
  await page.getByLabel("New password", { exact: true }).fill("a whole new passphrase");
  await page.getByRole("button", { name: "Save and sign in" }).click();
  await page.waitForURL("http://lvh.me:3100/account");
  await expect(page.getByTestId("businesses")).toContainText("Riverside Electric");
});

test("signing in before confirming the email says the password was right, and finishes after the code", async ({ page }) => {
  const email = `later-${Date.now()}@example.test`;
  const pw = "confirm it later 2026";
  await page.goto("http://lvh.me:3100/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/verify\?email=/);

  // They leave without confirming, then come back to sign in
  await page.goto("http://lvh.me:3100/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(pw);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/verify\?email=.*from=signin/);
  await expect(page.getByRole("status")).toContainText("Your password is right");
  await page.getByLabel("Code").fill(await latestCode(page, email));
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.waitForURL("http://lvh.me:3100/account");
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
});

test("sign-in never redirects to another site", async ({ page }) => {
  const email = `next-${Date.now()}@example.test`;
  await page.goto("http://lvh.me:3100/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("no open redirects 2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/verify/);
  await page.getByLabel("Code").fill(await latestCode(page, email));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible(); // the page has finished loading
  await page.context().clearCookies();
  await page.goto(`http://lvh.me:3100/signin?next=${encodeURIComponent("https://evil.example/")}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("no open redirects 2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("http://lvh.me:3100/account");
});

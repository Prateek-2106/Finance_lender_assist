import { test, expect } from "@playwright/test";

const outbox = async (page: import("@playwright/test").Page) =>
  (await (await page.request.get("http://localhost:3100/__test/emails")).json()) as { to: string; subject: string; text: string }[];

test("sign up by email, create a business, and run it without an API key", async ({ page }) => {
  const email = `owner-${Date.now()}@example.test`;
  await page.goto("http://lvh.me:3100/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toContainText(email);

  let link = "";
  await expect.poll(async () => {
    const m = (await outbox(page)).find((e) => e.to === email);
    link = /http:\/\/\S+\/auth\/verify#\S+/.exec(m?.text ?? "")?.[0] ?? "";
    return link;
  }).not.toBe("");
  await page.goto(link);
  await page.waitForURL("http://lvh.me:3100/account");
  expect(page.url()).not.toContain("token="); // the token never stays in the address bar
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  const form = page.getByRole("form", { name: "Create a business" });
  await form.getByLabel("Business name").fill("Riverside Electric");
  await expect(form.getByLabel("Web address")).toHaveValue("riverside-electric");
  await form.getByRole("button", { name: "Create business" }).click();
  await expect(page.getByRole("status")).toContainText("Riverside Electric is ready");

  // The same sign-in works on the business's own address
  await page.getByRole("link", { name: "Open the dashboard" }).click();
  await page.waitForURL(/riverside-electric\.lvh\.me:3100\/app/);
  await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  await expect(page.getByLabel("API key")).toHaveCount(0);

  // A used link doesn't work twice
  const again = await page.context().newPage();
  await again.goto(link);
  await expect(again.getByRole("heading", { name: "That link didn't work" })).toBeVisible();

  // Signing out ends it everywhere
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Continue with email" })).toBeVisible();
  await page.goto("http://lvh.me:3100/account");
  await page.waitForURL(/\/signin\?next=/);
});

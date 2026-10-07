import { test, expect, devices, type Page } from "@playwright/test";

test.use({ viewport: devices["iPhone 13"].viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

/** Anything sticking out past the screen's right edge that you can't scroll to inside a box made for it. */
const cutOff = (page: Page) =>
  page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= W + 1) continue;
      let p = el.parentElement;
      let inScroller = false;
      while (p) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth) { inScroller = true; break; }
        p = p.parentElement;
      }
      if (!inScroller) bad.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ").join(".") : ""}`);
    }
    // Sideways scrolling hides things too: only code samples may scroll sideways
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.closest("pre, code, .csv-sample, nav, .strip")) continue;
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1) bad.push(`scrolls sideways: ${el.tagName.toLowerCase()}.${String(el.className)}`);
    }
    return { pageWidth: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) };
  });

test("on a phone nothing is cut off, and the sections fit on one line", async ({ page }) => {
  const demo = await (await page.request.post("http://lvh.me:3100/api/demo")).json();
  await page.goto(demo.dashboardUrl); // signs this browser in to the demo (the key leaves the address bar)
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  const app = (hash: string) => demo.dashboardUrl.replace(/#.*/, hash);
  const pages = [
    "http://lvh.me:3100/", "http://lvh.me:3100/signin", "http://lvh.me:3100/scoring", demo.siteUrl,
    app("#/requests"), app("#/statistics"), app("#/statistics/paid"), app("#/estimates"), app("#/prices"), app("#/funding"),
  ];
  for (const url of pages) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    if (url.includes("/app#")) await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
    const r = await cutOff(page);
    expect(r.bad, url).toEqual([]);
    expect(r.pageWidth, url).toBeLessThanOrEqual(r.W);
  }
  // Open records too: an estimate with its line items, a funding answer with its measures
  await page.goto(app("#/estimates"));
  await page.locator("[data-tour=estimates-table] tbody tr").first().click();
  await expect(page.getByRole("region", { name: "Estimate" })).toBeVisible();
  expect((await cutOff(page)).bad).toEqual([]);
  await page.goto(app("#/funding"));
  await page.locator("[data-tour=funding-table] tbody tr").first().click();
  await page.getByText("How we decided").click();
  expect((await cutOff(page)).bad).toEqual([]);

  const nav = page.getByRole("navigation", { name: "Sections" });
  const last = await nav.getByRole("link", { name: "Funding" }).boundingBox();
  expect(last!.x + last!.width).toBeLessThanOrEqual(390);
});

import { defineConfig } from "@playwright/test";

const PORT = 3100;
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1, // one shared in-memory server
  reporter: [["list"]],
  use: {
    baseURL: `http://joes-plumbing.lvh.me:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // *.lvh.me → 127.0.0.1 without needing DNS (works offline and in CI)
      args: ["--host-resolver-rules=MAP *.lvh.me 127.0.0.1"],
      ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    },
  },
  webServer: {
    command: "npm run web:build && npx tsx scripts/e2e-server.ts",
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

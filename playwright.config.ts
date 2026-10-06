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
    // PW_CHANNEL=chrome (or msedge) uses the browser already installed instead of downloading one
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    launchOptions: {
      // lvh.me and *.lvh.me → 127.0.0.1 without DNS: works offline, in CI, and behind routers or
      // secure-DNS settings that refuse public names pointing at 127.0.0.1
      args: ["--host-resolver-rules=MAP lvh.me 127.0.0.1, MAP *.lvh.me 127.0.0.1"],
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

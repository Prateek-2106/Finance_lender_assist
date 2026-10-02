import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    // React component tests opt into jsdom with a file-level comment.
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000, // first MongoDB download can be slow
  },
});

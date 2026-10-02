import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: `npm run web:dev`, then open http://<subdomain>.lvh.me:5173/app.
// The proxy keeps the Host header, so the API still knows which tenant you are.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { port: 5173, proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } } },
});

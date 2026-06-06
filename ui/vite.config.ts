import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only proxy. In production the same routes are served by nginx (see
// nginx.conf.template), so the app code always talks to same-origin /api and
// /fhir and never sees FHIR credentials or a CORS boundary.
const AGENT_TARGET = process.env.CP_AGENT_DEV_TARGET ?? "http://localhost:8001";
const FHIR_TARGET =
  process.env.CP_FHIR_DEV_TARGET ??
  "http://localhost:52773/csp/healthshare/centralpark/fhir/r4";
const FHIR_USER = process.env.CP_FHIR_USER ?? "_SYSTEM";
const FHIR_PASSWORD = process.env.CP_FHIR_PASSWORD ?? "SYS";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 8501,
    proxy: {
      "/api": {
        target: AGENT_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/fhir": {
        target: FHIR_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/fhir/, ""),
        configure: (proxy) => {
          const auth =
            "Basic " +
            Buffer.from(`${FHIR_USER}:${FHIR_PASSWORD}`).toString("base64");
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Authorization", auth);
          });
        },
      },
    },
  },
});

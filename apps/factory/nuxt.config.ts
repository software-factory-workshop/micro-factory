// Restart the whole `pnpm dev` command after changing this file or installing
// dependencies: this Eve/Nuxt version can keep proxying to its stopped child.
import { vercelProjectNames } from "./runtime/lib/factory-config.ts";

export default defineNuxtConfig({
  modules: ["evlog/nuxt", "workflow/nuxt", "./modules/station-routes"],
  vite: { optimizeDeps: { include: ["eve/vue"] } },
  extends: ["@software-factory-workshop/nuxt-adeo-ds"],
  css: ["~/assets/css/main.css"],
  compatibilityDate: "2026-09-14",
  devtools: { enabled: false },
  evlog: {
    env: { service: vercelProjectNames.cockpit },
    redact: true,
    transport: { enabled: true },
    exclude: ["/_nuxt/**", "/api/_evlog/ingest"],
  },
  app: {
    head: {
      title: "Micro-factory cockpit · ADEO",
      meta: [{ name: "description", content: "One v0 prototype in, one verified Nuxt draft PR out." }],
    },
  },
  runtimeConfig: { public: { factorySha: process.env.VERCEL_GIT_COMMIT_SHA || "local" } },
});

import { defineEventHandler } from "h3";
import { useLogger } from "evlog/nitro";

export default defineEventHandler((event) => {
  useLogger(event).set({ app: { surface: "factory-cockpit", runtime: "nuxt" } });
});

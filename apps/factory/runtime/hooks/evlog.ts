import { defineEvlogHook } from "evlog/eve";

export default defineEvlogHook({
  init: {
    env: { service: "adeo-factory-agent" },
    redact: true,
  },
  redact: true,
  message: "omit",
  maxSessions: 256,
  sessionEvent: true,
});

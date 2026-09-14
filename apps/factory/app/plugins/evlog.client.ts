import { log } from "evlog/client";

function errorMetadata(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const candidate = error as Error & { statusCode?: unknown };
    return {
      name: error.name,
      ...(typeof candidate.statusCode === "number" ? { statusCode: candidate.statusCode } : {}),
    };
  }
  return { name: typeof error };
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("app:error", (error) => {
    log.error({
      app: { surface: "factory-client", event: "app_error" },
      error: errorMetadata(error),
    });
  });
});

import { assertRequiredEnv } from "./env";
import { log } from "./log";

// Node.js runtime only: called from instrumentation register().
export async function startServer(): Promise<void> {
  try {
    assertRequiredEnv(process.env);
  } catch (error) {
    log("error", "refusing to start", { error: (error as Error).message });
    process.exit(1);
  }

  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV,
      release: process.env.RAILWAY_GIT_COMMIT_SHA,
      tracesSampleRate: 0,
    });
  }
  log("info", "server started", { commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown" });
}

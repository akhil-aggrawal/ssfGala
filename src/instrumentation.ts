import type { Instrumentation } from "next";

// Runs once when a Next.js server starts, before it serves requests.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startServer } = await import("./lib/server-start");
  await startServer();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ reportRequestError }, Sentry] = await Promise.all([
    import("./lib/observability"),
    import("@sentry/nextjs"),
  ]);
  reportRequestError(error, request, context, { dsn: process.env.SENTRY_DSN, sentry: Sentry });
};

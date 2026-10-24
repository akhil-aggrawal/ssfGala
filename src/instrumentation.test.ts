import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startServer = vi.fn();
const reportRequestError = vi.fn();
vi.mock("./lib/server-start", () => ({ startServer }));
vi.mock("./lib/observability", () => ({ reportRequestError }));
vi.mock("@sentry/nextjs", () => ({ captureRequestError: vi.fn(), withScope: vi.fn() }));

import { onRequestError, register } from "./instrumentation";

type OnRequestErrorArgs = Parameters<typeof onRequestError>;
const request = { path: "/x", method: "GET", headers: {} } as OnRequestErrorArgs[1];
const context = { routePath: "/x" } as OnRequestErrorArgs[2];

beforeEach(() => {
  startServer.mockClear();
  reportRequestError.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("register", () => {
  it("runs the startup check on the Node.js server", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "");
    await register();
    expect(startServer).toHaveBeenCalledOnce();
  });

  it("skips the check during next build", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await register();
    expect(startServer).not.toHaveBeenCalled();
  });

  it("skips the check on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(startServer).not.toHaveBeenCalled();
  });
});

describe("onRequestError", () => {
  it("reports with the current SENTRY_DSN", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1");
    const error = new Error("boom");
    await onRequestError(error, request, context);
    expect(reportRequestError).toHaveBeenCalledWith(
      error,
      request,
      context,
      expect.objectContaining({ dsn: "https://k@o1.ingest.sentry.io/1" }),
    );
  });

  it("does nothing on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await onRequestError(new Error("boom"), request, context);
    expect(reportRequestError).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { requestIdFrom, reportRequestError } from "./observability";

const request = { path: "/boom", method: "GET", headers: { "x-request-id": "req-1" } };
const context = {
  routerKind: "App Router",
  routePath: "/boom",
  routeType: "route",
  renderSource: undefined,
  revalidateReason: undefined,
  renderType: undefined,
} as unknown as Parameters<typeof reportRequestError>[2];

function fakeSentry() {
  const scope = { setTag: vi.fn() };
  return {
    scope,
    withScope: vi.fn((cb: (s: typeof scope) => void) => cb(scope)),
    captureRequestError: vi.fn(),
  };
}

describe("requestIdFrom", () => {
  it("prefers x-request-id, then Railway's header", () => {
    expect(requestIdFrom({ "x-request-id": "a", "x-railway-request-id": "b" })).toBe("a");
    expect(requestIdFrom({ "x-railway-request-id": "b" })).toBe("b");
  });

  it("makes one up when no header is present", () => {
    expect(requestIdFrom({})).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("reportRequestError", () => {
  it("reports to Sentry tagged with the request ID when SENTRY_DSN is set", () => {
    const sentry = fakeSentry();
    const log = vi.fn();
    reportRequestError(new Error("boom"), request, context, { dsn: "https://k@o1.ingest.sentry.io/1", sentry, log });
    expect(sentry.scope.setTag).toHaveBeenCalledWith("request_id", "req-1");
    expect(sentry.captureRequestError).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("error", "request failed", expect.objectContaining({ request_id: "req-1", path: "/boom", error: "boom" }));
  });

  it("sends nothing to Sentry when SENTRY_DSN is unset, but still logs", () => {
    const sentry = fakeSentry();
    const log = vi.fn();
    reportRequestError(new Error("boom"), request, context, { dsn: undefined, sentry, log });
    expect(sentry.withScope).not.toHaveBeenCalled();
    expect(sentry.captureRequestError).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
  });
});

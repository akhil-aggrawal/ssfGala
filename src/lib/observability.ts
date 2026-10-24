import { randomUUID } from "node:crypto";
import type { Instrumentation } from "next";
import { log as defaultLog } from "./log";

type Headers = Record<string, string | string[] | undefined>;
type RequestInfo = Parameters<Instrumentation.onRequestError>[1];
type ErrorContext = Parameters<Instrumentation.onRequestError>[2];

type SentryLike = {
  withScope: (cb: (scope: { setTag: (key: string, value: string) => void }) => void) => void;
  captureRequestError: (error: unknown, request: RequestInfo, context: ErrorContext) => void;
};

export function requestIdFrom(headers: Headers): string {
  const value = headers["x-request-id"] ?? headers["x-railway-request-id"];
  const id = Array.isArray(value) ? value[0] : value;
  return id || randomUUID();
}

export function reportRequestError(
  error: unknown,
  request: RequestInfo,
  context: ErrorContext,
  deps: { dsn: string | undefined; sentry: SentryLike; log?: typeof defaultLog },
): void {
  const requestId = requestIdFrom(request.headers);
  (deps.log ?? defaultLog)("error", "request failed", {
    request_id: requestId,
    method: request.method,
    path: request.path,
    route: context.routePath,
    error: error instanceof Error ? error.message : String(error),
  });
  if (!deps.dsn) return;
  deps.sentry.withScope((scope) => {
    scope.setTag("request_id", requestId);
    deps.sentry.captureRequestError(error, request, context);
  });
}

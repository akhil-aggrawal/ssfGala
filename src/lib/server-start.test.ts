import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REQUIRED_ENV } from "./env";

const sentryInit = vi.fn();
vi.mock("@sentry/nextjs", () => ({ init: sentryInit }));

const complete = Object.fromEntries(REQUIRED_ENV.map((name) => [name, "x"]));

class Exited extends Error {}

describe("startServer", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    sentryInit.mockClear();
    vi.spyOn(console, "log").mockImplementation((line) => void lines.push(line));
    vi.spyOn(console, "error").mockImplementation((line) => void lines.push(line));
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Exited();
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function stubEnv(env: Record<string, string | undefined>) {
    for (const name of [...REQUIRED_ENV, "SENTRY_DSN"]) vi.stubEnv(name, env[name] ?? "");
  }

  it("exits 1 and logs the missing variable's name", async () => {
    stubEnv({ ...complete, STRIPE_WEBHOOK_SECRET: undefined });
    const { startServer } = await import("./server-start");
    await expect(startServer()).rejects.toBeInstanceOf(Exited);
    expect(process.exit).toHaveBeenCalledWith(1);
    const line = JSON.parse(lines[0]);
    expect(line).toMatchObject({ level: "error", msg: "refusing to start" });
    expect(line.error).toContain("STRIPE_WEBHOOK_SECRET");
    expect(sentryInit).not.toHaveBeenCalled();
  });

  it("starts without Sentry when SENTRY_DSN is unset", async () => {
    stubEnv(complete);
    const { startServer } = await import("./server-start");
    await startServer();
    expect(process.exit).not.toHaveBeenCalled();
    expect(sentryInit).not.toHaveBeenCalled();
    expect(JSON.parse(lines[0])).toMatchObject({ level: "info", msg: "server started" });
  });

  it("initialises Sentry with the DSN when it is set", async () => {
    stubEnv({ ...complete, SENTRY_DSN: "https://k@o1.ingest.sentry.io/1" });
    const { startServer } = await import("./server-start");
    await startServer();
    expect(sentryInit).toHaveBeenCalledWith(expect.objectContaining({ dsn: "https://k@o1.ingest.sentry.io/1" }));
  });
});

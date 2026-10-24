import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("log", () => {
  it("writes one JSON line with level, message, time and fields", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log("info", "hello", { request_id: "r1" });
    const line = JSON.parse(out.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "info", msg: "hello", request_id: "r1" });
    expect(new Date(line.time).toString()).not.toBe("Invalid Date");
  });

  it("sends errors to stderr", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    log("error", "bad");
    expect(JSON.parse(err.mock.calls[0][0] as string).level).toBe("error");
  });
});

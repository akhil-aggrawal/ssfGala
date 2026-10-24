import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it.each([
    ["/invite/abc123", "/invite/abc123"],
    ["/tickets?tier=gold#qty", "/tickets?tier=gold#qty"],
    ["/", "/"],
  ])("keeps the same-origin path %s", (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["https://evil.example/phish"],
    ["//evil.example/phish"],
    ["/\\evil.example"],
    ["\\\\evil.example"],
    ["javascript:alert(1)"],
    ["invite/abc"],
    ["/\t/evil.example"],
  ])("falls back to / for %s", (next) => {
    expect(safeNextPath(next)).toBe("/");
  });
});

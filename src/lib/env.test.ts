import { describe, expect, it } from "vitest";
import { assertRequiredEnv, missingEnv, REQUIRED_ENV } from "./env";

const complete = Object.fromEntries(REQUIRED_ENV.map((name) => [name, "x"]));

describe("required env", () => {
  it("passes when every required variable is set", () => {
    expect(missingEnv(complete)).toEqual([]);
    expect(() => assertRequiredEnv(complete)).not.toThrow();
  });

  it.each(REQUIRED_ENV)("names %s when it is missing", (name) => {
    const env = { ...complete, [name]: undefined };
    expect(() => assertRequiredEnv(env)).toThrow(name);
  });

  it("treats a blank value as missing", () => {
    const env = { ...complete, SUPABASE_SERVICE_ROLE_KEY: "  " };
    expect(missingEnv(env)).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("does not require SENTRY_DSN", () => {
    expect(REQUIRED_ENV).not.toContain("SENTRY_DSN");
  });
});

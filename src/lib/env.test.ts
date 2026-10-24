import { describe, expect, it } from "vitest";
import { assertRequiredEnv, isDeployed, missingEnv, REQUIRED_ENV } from "./env";

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

describe("test sign-in guard", () => {
  it("refuses E2E_AUTH=1 on a deployed environment", () => {
    const env = { ...complete, E2E_AUTH: "1", RAILWAY_ENVIRONMENT: "production" };
    expect(() => assertRequiredEnv(env)).toThrow(/E2E_AUTH/);
  });

  it("allows E2E_AUTH=1 locally", () => {
    expect(() => assertRequiredEnv({ ...complete, E2E_AUTH: "1" })).not.toThrow();
  });

  it("allows a deployed environment without E2E_AUTH", () => {
    expect(() => assertRequiredEnv({ ...complete, RAILWAY_ENVIRONMENT: "production" })).not.toThrow();
  });

  it("treats a blank RAILWAY_ENVIRONMENT as not deployed", () => {
    expect(isDeployed({ RAILWAY_ENVIRONMENT: " " })).toBe(false);
    expect(isDeployed({ RAILWAY_ENVIRONMENT: "staging" })).toBe(true);
  });
});

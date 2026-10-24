import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /auth/test-signin", () => {
  it("returns 404 when E2E_AUTH is unset", async () => {
    vi.stubEnv("E2E_AUTH", undefined);
    const res = await GET(new NextRequest("http://localhost/auth/test-signin"));
    expect(res.status).toBe(404);
  });

  it("returns 404 when E2E_AUTH is anything but 1", async () => {
    vi.stubEnv("E2E_AUTH", "true");
    const res = await GET(new NextRequest("http://localhost/auth/test-signin"));
    expect(res.status).toBe(404);
  });

  it("rejects an email outside the .test domain", async () => {
    vi.stubEnv("E2E_AUTH", "1");
    const res = await GET(
      new NextRequest("http://localhost/auth/test-signin?email=admin@example.com"),
    );
    expect(res.status).toBe(400);
  });
});

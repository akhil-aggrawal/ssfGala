import { describe, expect, it, vi } from "vitest";
import { checkHealth } from "./health";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://db.example.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  RAILWAY_GIT_COMMIT_SHA: "abc1234",
};

describe("checkHealth", () => {
  it("returns 200 with the commit SHA when the database answers", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    const result = await checkHealth(env, fetch);
    expect(result).toEqual({
      status: 200,
      body: { status: "ok", commit: "abc1234", database: "ok" },
    });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://db.example.co/rest/v1/events?select=id&limit=1");
    expect(init.headers.apikey).toBe("service-key");
  });

  it("returns 503 when the database errors", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("down", { status: 500 }));
    const result = await checkHealth(env, fetch);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ status: "error", database: "error", commit: "abc1234" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const result = await checkHealth(env, fetch);
    expect(result.status).toBe(503);
  });

  it("reports an unknown commit outside Railway", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    const result = await checkHealth({ ...env, RAILWAY_GIT_COMMIT_SHA: undefined }, fetch);
    expect(result.body.commit).toBe("unknown");
  });
});

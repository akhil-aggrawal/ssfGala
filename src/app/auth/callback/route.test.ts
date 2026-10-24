import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const ensureProfile = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession } }),
  createSupabaseAdminClient: () => ({}),
}));
vi.mock("@/lib/auth/profile", () => ({ ensureProfile }));

const { GET } = await import("./route");

const user = { id: "u1", email: "g@example.com", user_metadata: {} };
const callback = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/auth/callback?${query}`));

beforeEach(() => {
  vi.unstubAllEnvs();
  exchangeCodeForSession.mockReset().mockResolvedValue({ data: { user }, error: null });
  ensureProfile.mockReset().mockResolvedValue(undefined);
});

describe("GET /auth/callback", () => {
  it("returns to the exact next path, including an invite link", async () => {
    const res = await callback("code=abc&next=%2Finvite%2Ftok123%3Fx%3D1");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(res.headers.get("location")).toBe("http://localhost:3000/invite/tok123?x=1");
  });

  it("ignores a next pointing to another origin and lands on /", async () => {
    const res = await callback("code=abc&next=https%3A%2F%2Fevil.example%2Fx");
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("ensures the profile row for the signed-in user", async () => {
    await callback("code=abc");
    expect(ensureProfile).toHaveBeenCalledWith({}, user);
  });

  it("sends a failed exchange back to /signin without creating a profile", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: new Error("bad") });
    const res = await callback("code=abc&next=%2Ftickets");
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/signin?error=callback&next=%2Ftickets",
    );
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("uses NEXT_PUBLIC_APP_URL as the redirect origin when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://gala.example.org");
    const res = await callback("code=abc&next=%2Ftickets");
    expect(res.headers.get("location")).toBe("https://gala.example.org/tickets");
  });
});

import { describe, expect, it, vi } from "vitest";
import { ensureProfile } from "./profile";

function fakeAdmin(error: { message: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const from = vi.fn().mockReturnValue({ upsert });
  return { client: { from } as never, from, upsert };
}

describe("ensureProfile", () => {
  it("inserts one profiles row and ignores a repeat sign-in", async () => {
    const admin = fakeAdmin();
    await ensureProfile(admin.client, {
      id: "u1",
      email: "guest@example.com",
      user_metadata: { full_name: "Guest One" },
    });
    expect(admin.from).toHaveBeenCalledWith("profiles");
    expect(admin.upsert).toHaveBeenCalledWith(
      { id: "u1", email: "guest@example.com", display_name: "Guest One" },
      { onConflict: "id", ignoreDuplicates: true },
    );
  });

  it("throws when the insert fails", async () => {
    const admin = fakeAdmin({ message: "boom" });
    await expect(
      ensureProfile(admin.client, { id: "u1", email: undefined, user_metadata: {} }),
    ).rejects.toThrow("boom");
  });
});

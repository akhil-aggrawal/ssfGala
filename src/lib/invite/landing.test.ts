import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { safeNextPath } from "@/lib/auth/next-path";
import { hashInviteToken, newInviteTokens } from "@/lib/sponsor/pledge";
import { invitePath, isTokenShape, loadInvite, toInvite, type InviteRow } from "./landing";

const row = (over: { event?: string; sponsorship?: string } = {}): InviteRow => ({
  seating_tiers: { name: "Gold" },
  sponsorships: { status: over.sponsorship ?? "committed", sponsors: { display_name: "Acme Family" } },
  events: { name: "SSF Gala 2027", status: over.event ?? "open" },
});

// Fake client that records the token hash it was asked for.
function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: { column: string; value: string }[] = [];
  const chain = {
    select: () => chain,
    eq: (column: string, value: string) => {
      calls.push({ column, value });
      return chain;
    },
    maybeSingle: async () => result,
  };
  const from = vi.fn(() => chain);
  return { client: { from } as unknown as SupabaseClient<Database>, from, calls };
}

describe("toInvite", () => {
  it("shows sponsor name and tier for a committed table in an open gala", () => {
    expect(toInvite(row())).toEqual({
      kind: "open",
      sponsorName: "Acme Family",
      tier: "Gold",
      eventName: "SSF Gala 2027",
    });
  });

  it.each(["closed", "archived", "draft"])("reads a %s gala as closed", (status) => {
    expect(toInvite(row({ event: status })).kind).toBe("closed");
  });

  it("treats an unknown token or a cancelled sponsorship as invalid", () => {
    expect(toInvite(null)).toEqual({ kind: "invalid" });
    expect(toInvite(row({ sponsorship: "cancelled" }))).toEqual({ kind: "invalid" });
  });
});

describe("isTokenShape", () => {
  it("accepts tokens from newInviteTokens and rejects anything else", () => {
    expect(isTokenShape(newInviteTokens(1)[0].token)).toBe(true);
    for (const bad of ["", "abc", "a".repeat(44), `${"a".repeat(42)}/`, `${"a".repeat(42)}=`]) {
      expect(isTokenShape(bad)).toBe(false);
    }
  });
});

describe("loadInvite", () => {
  const token = newInviteTokens(1)[0].token;

  it("looks the table up by token hash, never the raw token", async () => {
    const { client, calls } = fakeClient({ data: row(), error: null });
    const invite = await loadInvite(client, token);
    expect(invite.kind).toBe("open");
    expect(calls).toEqual([{ column: "invite_token_hash", value: hashInviteToken(token) }]);
  });

  it("returns invalid for an unknown token", async () => {
    const { client } = fakeClient({ data: null, error: null });
    expect(await loadInvite(client, token)).toEqual({ kind: "invalid" });
  });

  it("returns invalid for a malformed token without querying", async () => {
    const { client, from } = fakeClient({ data: row(), error: null });
    expect(await loadInvite(client, "not-a-token")).toEqual({ kind: "invalid" });
    expect(from).not.toHaveBeenCalled();
  });

  it("throws on a failed query so an outage never reads as an invalid link", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    await expect(loadInvite(client, token)).rejects.toThrow("loadInvite failed: boom");
  });
});

describe("invitePath", () => {
  it("survives the sign-in next-path check unchanged", () => {
    const path = invitePath(token());
    expect(safeNextPath(path)).toBe(path);
  });
});

function token() {
  return newInviteTokens(1)[0].token;
}

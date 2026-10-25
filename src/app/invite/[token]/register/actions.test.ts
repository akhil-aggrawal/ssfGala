import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #34 AC1: guests who register on a sponsored table are confirmed by
// email once the registration is saved, and never when it is refused.
const rpc = vi.hoisted(() => vi.fn());
const email = vi.hoisted(() => ({ confirmRegistration: vi.fn() }));

vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => ({ id: "user-1", email: "asha@example.test" }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/email/guest-confirmation", () => email);
vi.mock("@/lib/stripe/server", () => ({ stripeCheckout: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { registerGuests } = await import("./actions");

const TOKEN = "a".repeat(43);

function guestForm() {
  const fd = new FormData();
  fd.set("count", "2");
  fd.set("intent", "register");
  for (const [name, mail] of [
    ["Asha Guest", "asha@example.test"],
    ["Ravi Guest", "ravi@example.test"],
  ]) {
    fd.append("attendee_name", name);
    fd.append("attendee_email", mail);
  }
  return fd;
}

describe("registerGuests confirmation emails", () => {
  beforeEach(() => {
    rpc.mockReset();
    email.confirmRegistration.mockReset();
  });

  it("confirms the new registration once it is saved", async () => {
    rpc.mockResolvedValue({ data: "reg-34", error: null });
    await expect(registerGuests(TOKEN, null, guestForm())).resolves.toEqual({ done: true, count: 2 });
    expect(email.confirmRegistration).toHaveBeenCalledTimes(1);
    expect(email.confirmRegistration.mock.calls[0][1]).toBe("reg-34");
  });

  it("sends nothing when the registration is refused", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "invite_not_found" } });
    const state = await registerGuests(TOKEN, null, guestForm());
    expect(state).toMatchObject({ done: false });
    expect(email.confirmRegistration).not.toHaveBeenCalled();
  });
});

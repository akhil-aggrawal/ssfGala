import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";

const logger = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/lib/log", () => logger);

const { sendSponsorshipConfirmation } = await import("./sponsorship-confirmation");
const { createEmailTransport, outbox } = await import("./transport");

const FROM = "SSF Gala <onboarding@resend.dev>";
const memory = () => createEmailTransport({ EMAIL_TRANSPORT: "memory", EMAIL_FROM: FROM });

// The events lookup is the only database read.
const fakeDb = (result: { data: object | null; error: { message: string } | null }) => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => result };
  return { from: vi.fn(() => q) } as unknown as SupabaseClient<Database>;
};
const galaDb = () =>
  fakeDb({ data: { name: "An Evening That Moves You", date_at: "2027-01-24T02:00:00Z", venue: "ICC Milpitas" }, error: null });

const pledge = {
  sponsorshipId: "sp-33",
  sponsorEmail: "sponsor@example.test",
  sponsorName: "Acme Corp",
  pledgedCents: 650000,
  tables: [
    { tierName: "Silver", url: "https://gala.test/invite/tok-a" },
    { tierName: "Gold", url: "https://gala.test/invite/tok-b" },
    { tierName: "Gold", url: "https://gala.test/invite/tok-c" },
  ],
};

describe("sendSponsorshipConfirmation", () => {
  beforeEach(() => {
    outbox.length = 0;
    logger.log.mockReset();
  });

  it("AC1: a 3-table pledge sends one email containing 3 different table links", async () => {
    await sendSponsorshipConfirmation(galaDb(), "ev-1", pledge, memory());
    expect(outbox).toHaveLength(1);
    const [mail] = outbox;
    expect(mail.to).toBe("sponsor@example.test");
    expect(mail.from).toBe(FROM);
    expect(mail.idempotencyKey).toBe("sponsorship:sp-33");
    for (const part of [mail.text, mail.html]) {
      const links = new Set(part.match(/https:\/\/gala\.test\/invite\/[\w-]+/g));
      expect(links).toEqual(new Set(pledge.tables.map((t) => t.url)));
      expect(part).toContain("Silver");
      expect(part).toContain("Gold");
    }
    expect(mail.text).toContain("An Evening That Moves You");
    expect(mail.text).toContain("ICC Milpitas");
  });

  it("AC2: states the pledged amount and that no online payment was taken", async () => {
    await sendSponsorshipConfirmation(galaDb(), "ev-1", pledge, memory());
    for (const part of [outbox[0].text, outbox[0].html]) {
      expect(part).toContain("$6,500");
      expect(part).toContain("No payment was taken online");
    }
  });

  it("escapes the sponsor name in the HTML", async () => {
    await sendSponsorshipConfirmation(galaDb(), "ev-1", { ...pledge, sponsorName: "<b>x</b>" }, memory());
    expect(outbox[0].html).not.toContain("<b>x</b>");
  });

  it("a failed send is logged with the sponsorship id and never throws", async () => {
    const failing = { send: vi.fn(async () => { throw new Error("Resend send failed: 500"); }) };
    await expect(sendSponsorshipConfirmation(galaDb(), "ev-1", pledge, failing)).resolves.toBeUndefined();
    expect(logger.log).toHaveBeenCalledWith(
      "error",
      "email: send failed",
      expect.objectContaining({ sponsorshipId: "sp-33", kind: "sponsorship" }),
    );
  });

  it("a failed event lookup is logged and sends nothing", async () => {
    await sendSponsorshipConfirmation(fakeDb({ data: null, error: { message: "boom" } }), "ev-1", pledge, memory());
    expect(outbox).toHaveLength(0);
    expect(logger.log).toHaveBeenCalledWith("error", "email: send failed", expect.objectContaining({ sponsorshipId: "sp-33" }));
  });
});

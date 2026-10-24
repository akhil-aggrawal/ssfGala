// Admin "Add attendees": form parsing and error text for /admin/attendees/new.
// Pure functions; the Server Action in app/admin/attendees/new does the I/O.
// Complimentary and paid-offline only: nothing here ever charges a card.

import { dollarsToCents } from "@/lib/gala/setup";

export const ADMIN_KINDS = ["complimentary", "offline_paid"] as const;
export type AdminKind = (typeof ADMIN_KINDS)[number];

export type AttendeeInput = { full_name: string; email: string };

export type AddAttendeesInput = {
  kind: AdminKind;
  tier_id: string;
  attendees: AttendeeInput[];
  amount_cents: number | null;
};

export type AddAttendeesParse = { ok: true; value: AddAttendeesInput } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (fd: FormData, key: string) => (fd.get(key)?.toString() ?? "").trim();

export function parseAddAttendeesForm(fd: FormData): AddAttendeesParse {
  const fail = (error: string): AddAttendeesParse => ({ ok: false, error });

  const kind = text(fd, "kind");
  if (!(ADMIN_KINDS as readonly string[]).includes(kind)) return fail("Choose Complimentary or Paid offline.");
  const tierId = text(fd, "tier_id");
  if (!UUID.test(tierId)) return fail("Choose a tier.");

  const names = fd.getAll("attendee_name").map((v) => v.toString().trim());
  const emails = fd.getAll("attendee_email").map((v) => v.toString().trim());
  const attendees: AttendeeInput[] = [];
  for (let i = 0; i < Math.max(names.length, emails.length); i++) {
    const full_name = names[i] ?? "";
    const email = emails[i] ?? "";
    if (!full_name && !email) continue;
    if (!full_name || !email) return fail(`Attendee ${i + 1} needs a name and an email.`);
    if (!EMAIL.test(email)) return fail(`Attendee ${i + 1} email is not valid.`);
    attendees.push({ full_name, email });
  }
  if (attendees.length === 0) return fail("Add at least one attendee.");

  let amountCents: number | null = null;
  if (kind === "offline_paid") {
    amountCents = dollarsToCents(text(fd, "amount"));
    if (amountCents === null) return fail("Amount received must be a dollar amount, like 200 or 200.50.");
    if (amountCents === 0) return fail("Amount received must be more than $0.");
    if (amountCents < attendees.length) return fail("Amount received must be at least 1 cent per attendee.");
  }

  return { ok: true, value: { kind: kind as AdminKind, tier_id: tierId, attendees, amount_cents: amountCents } };
}

// Plain-words text for a failed add_admin_attendees call.
export function addAttendeesErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "55000") return "This gala is archived and read-only. Nothing was saved.";
  if (error.code === "P0002") return "That gala no longer exists. Nothing was saved.";
  if (error.code === "23503") return "That tier is not part of the active gala. Nothing was saved.";
  if (error.code === "22023") return "Check the attendees and amount. Nothing was saved.";
  return "The attendees could not be added. Try again.";
}

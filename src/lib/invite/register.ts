// Invited guest registration on a sponsored table: form parsing and error
// text for /invite/<token>/register. Pure functions; the Server Action does
// the write through register_sponsored_guests. No payment and no capacity
// check: the table takes every guest, and only admins see overbooking.
import { parseAttendees, type AttendeeErrors, type AttendeeInput } from "@/lib/tickets/order";
import { invitePath } from "./landing";

export const MAX_GUESTS = 10;

export type GuestsParse =
  | { ok: true; attendees: AttendeeInput[] }
  | { ok: false; errors: AttendeeErrors; values: AttendeeInput[]; message: string };

export function parseGuestCount(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_GUESTS ? n : null;
}

// One name and email pair per attendee, `count` of them.
export function parseGuests(fd: FormData): GuestsParse {
  const count = parseGuestCount(fd.get("count")?.toString());
  if (count === null) {
    return { ok: false, errors: {}, values: [], message: `Choose the number of attendees, 1 to ${MAX_GUESTS}.` };
  }
  const parsed = parseAttendees(fd, count);
  if (!parsed.ok) return { ...parsed, message: "Fix the highlighted fields. Nothing was saved." };
  return parsed;
}

// Plain-words text for a failed register_sponsored_guests call.
export function registerErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "55000") return "Registration for this gala is closed. Nothing was saved.";
  if (error.code === "P0002") return "This invitation link is not valid. Nothing was saved.";
  if (error.code === "22023") return "Check the attendee names and emails. Nothing was saved.";
  return "Your registration could not be saved. Try again.";
}

export function registerPath(token: string): string {
  return `${invitePath(token)}/register`;
}

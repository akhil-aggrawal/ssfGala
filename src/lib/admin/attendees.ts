import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { dollarsToCents, TIER_NAMES } from "@/lib/gala/setup";

// Admin attendee list (/admin/attendees): load, filter, and the edit form.
// Admin "Add attendees" (/admin/attendees/new): form parsing and error text;
// complimentary and paid-offline only, nothing here ever charges a card.
// Edits and cancels go through admin_update_attendee / admin_cancel_attendee,
// which write the audit row in the same transaction.

export const REGISTRATION_KINDS = ["individual", "sponsored", "complimentary", "offline_paid"] as const;

export type AttendeeRow = {
  id: string;
  fullName: string;
  email: string;
  // The attendee or its whole registration is cancelled.
  cancelled: boolean;
  kind: string;
  tier: string;
  // Seat the admin assigned, else the sponsored table's number.
  table: string | null;
  paid: boolean;
};

export type AttendeeFilters = {
  q: string;
  tier: string;
  kind: string;
  table: string;
  paid: "" | "yes" | "no";
  cancelled: boolean;
};

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

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v ?? "").trim();
const oneOf = (v: string, allowed: readonly string[]) => (allowed.includes(v) ? v : "");

export function parseFilters(params: Params): AttendeeFilters {
  return {
    q: one(params.q),
    tier: oneOf(one(params.tier), TIER_NAMES),
    kind: oneOf(one(params.kind), REGISTRATION_KINDS),
    table: one(params.table),
    paid: oneOf(one(params.paid), ["yes", "no"]) as AttendeeFilters["paid"],
    cancelled: one(params.cancelled) === "1",
  };
}

export function filterAttendees(rows: AttendeeRow[], f: AttendeeFilters): AttendeeRow[] {
  const q = f.q.toLowerCase();
  return rows.filter(
    (r) =>
      (f.cancelled || !r.cancelled) &&
      (!q || r.fullName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q)) &&
      (!f.tier || r.tier === f.tier) &&
      (!f.kind || r.kind === f.kind) &&
      (!f.table || r.table === f.table) &&
      (!f.paid || r.paid === (f.paid === "yes")),
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

export type AttendeeEdit = { attendeeId: string; fullName: string; email: string };

export function parseAttendeeId(fd: FormData): string | null {
  const id = fd.get("attendee_id")?.toString() ?? "";
  return UUID.test(id) ? id : null;
}

export function parseAttendeeEdit(
  fd: FormData,
): { ok: true; value: AttendeeEdit } | { ok: false; error: string } {
  const attendeeId = parseAttendeeId(fd);
  if (!attendeeId) return { ok: false, error: "Unknown attendee." };
  const fullName = (fd.get("full_name")?.toString() ?? "").trim();
  if (!fullName) return { ok: false, error: "Name is required." };
  const email = (fd.get("email")?.toString() ?? "").trim();
  if (!EMAIL.test(email)) return { ok: false, error: "Enter an email like name@example.com." };
  return { ok: true, value: { attendeeId, fullName, email } };
}

// Plain-words text for a refused edit or cancel.
export function attendeeErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "P0002") return "That attendee no longer exists in this gala. Nothing was saved.";
  if (error.code === "55000") return "This gala is read-only. Nothing was saved.";
  if (error.message.includes("attendee_already_cancelled")) return "That attendee is already cancelled.";
  if (error.code === "22023") return "Name and email are required. Nothing was saved.";
  return "The change could not be saved. Try again.";
}

const PAGE = 1000; // PostgREST max_rows (supabase/config.toml)

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function readAll<T>(label: string, page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`loadAttendees ${label} failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

// Every attendee of one event, sorted by name. Service-role client: the
// caller has already run requireRole("admin") and passes its eventId.
export async function loadAttendees(admin: SupabaseClient<Database>, eventId: string): Promise<AttendeeRow[]> {
  const [attendees, payment] = await Promise.all([
    readAll("attendees", (f, t) =>
      admin
        .from("attendees")
        .select(
          "id, full_name, email, cancelled_at, assigned_table_number, registration:registrations(kind, status, tier:seating_tiers(name), table:sponsored_tables(physical_table_number))",
        )
        .eq("event_id", eventId)
        .order("id")
        .range(f, t),
    ),
    readAll("attendee_payment_status", (f, t) =>
      admin
        .from("attendee_payment_status")
        .select("attendee_id, paid")
        .eq("event_id", eventId)
        .order("attendee_id")
        .range(f, t),
    ),
  ]);
  const paid = new Set(payment.filter((p) => p.paid).map((p) => p.attendee_id));
  return attendees
    .map((a) => ({
      id: a.id,
      fullName: a.full_name,
      email: a.email,
      cancelled: a.cancelled_at !== null || a.registration.status === "cancelled",
      kind: a.registration.kind,
      tier: a.registration.tier.name,
      table: a.assigned_table_number ?? a.registration.table?.physical_table_number ?? null,
      paid: paid.has(a.id),
    }))
    .sort((x, y) => x.fullName.localeCompare(y.fullName) || x.id.localeCompare(y.id));
}

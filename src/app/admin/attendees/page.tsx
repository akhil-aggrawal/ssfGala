import type { Metadata } from "next";
import { Suspense } from "react";
import {
  REGISTRATION_KINDS,
  filterAttendees,
  loadAttendees,
  parseFilters,
  type AttendeeFilters,
} from "@/lib/admin/attendees";
import { requireRole } from "@/lib/auth/guard";
import { TIER_NAMES } from "@/lib/gala/setup";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { AttendeeActions } from "./attendee-actions";

export const metadata: Metadata = { title: "Attendees — SSF Gala admin" };

const KIND_LABELS: Record<string, string> = {
  individual: "Ticket",
  sponsored: "Sponsored",
  complimentary: "Complimentary",
  offline_paid: "Offline paid",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// GET form: filters live in the URL, so a filtered list can be shared or reloaded.
function Filters({ f }: { f: AttendeeFilters }) {
  return (
    <form method="get" className="attendee-filters" role="search" aria-label="Filter attendees">
      <label>
        Search name or email
        <input name="q" type="search" defaultValue={f.q} />
      </label>
      <label>
        Tier
        <select name="tier" defaultValue={f.tier}>
          <option value="">All</option>
          {TIER_NAMES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Kind
        <select name="kind" defaultValue={f.kind}>
          <option value="">All</option>
          {REGISTRATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Table
        <input name="table" defaultValue={f.table} />
      </label>
      <label>
        Paid
        <select name="paid" defaultValue={f.paid}>
          <option value="">All</option>
          <option value="yes">Paid</option>
          <option value="no">Not paid</option>
        </select>
      </label>
      <label className="attendee-filters__check">
        <input type="checkbox" name="cancelled" value="1" defaultChecked={f.cancelled} />
        Show cancelled
      </label>
      <button type="submit">Filter</button>
    </form>
  );
}

async function AttendeeList({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireRole("admin", "/admin/attendees");
  if (access.eventId === null) return <p>No active gala is set up yet.</p>;

  const f = parseFilters(await searchParams);
  const all = await loadAttendees(createSupabaseAdminClient(), access.eventId);
  const rows = filterAttendees(all, f);

  return (
    <>
      <Filters f={f} />
      {rows.length === 0 ? (
        <p role="status">No attendees match.</p>
      ) : (
        // Focusable so keyboard users can scroll the wide table on a phone.
        <div className="admin-table-wrap" role="region" aria-label="Attendees" tabIndex={0}>
          <table className="admin-table">
            <caption>
              {rows.length} of {all.length} attendees
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Tier</th>
                <th scope="col">Kind</th>
                <th scope="col">Table</th>
                <th scope="col">Paid</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <th scope="row">{a.fullName}</th>
                  <td>{a.email}</td>
                  <td>{a.tier}</td>
                  <td>{KIND_LABELS[a.kind] ?? a.kind}</td>
                  <td>{a.table ?? "—"}</td>
                  <td>{a.paid ? "Paid" : "Not paid"}</td>
                  <td>{a.cancelled ? "Cancelled" : "Active"}</td>
                  <td>
                    <AttendeeActions attendee={a} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function AttendeesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <h1>Attendees</h1>
      <Suspense fallback={<p>Checking access…</p>}>
        <AttendeeList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

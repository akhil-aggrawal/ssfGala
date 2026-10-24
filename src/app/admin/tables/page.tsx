import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { loadSeating } from "@/lib/admin/seating";
import { requireRole } from "@/lib/auth/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { moveAttendee, setTableNumber } from "./actions";
import { SeatForm } from "./seat-form";

export const metadata: Metadata = { title: "Tables & Seating — SSF Gala admin" };

type SearchParams = Promise<{ show?: string }>;

async function Seating({ searchParams }: { searchParams: SearchParams }) {
  const access = await requireRole("admin", "/admin/tables");
  if (access.eventId === null) return <p>No active gala is set up yet.</p>;

  const overbookedOnly = (await searchParams).show === "overbooked";
  const { tables, guests } = await loadSeating(createSupabaseAdminClient(), access.eventId);
  const shown = overbookedOnly ? tables.filter((t) => t.overbooked) : tables;

  return (
    <>
      <section aria-labelledby="sponsored-tables">
        <h2 id="sponsored-tables">Sponsored tables</h2>
        <nav aria-label="Table filter" className="seat-filter">
          <Link href="/admin/tables" aria-current={overbookedOnly ? undefined : "page"}>
            All tables
          </Link>
          <Link href="/admin/tables?show=overbooked" aria-current={overbookedOnly ? "page" : undefined}>
            Overbooked only
          </Link>
        </nav>
        {shown.length === 0 ? (
          <p>{overbookedOnly ? "No table is overbooked." : "No sponsored tables yet."}</p>
        ) : (
          // Focusable so keyboard users can scroll the wide table on a phone.
          <div className="admin-table-wrap" role="region" aria-label="Sponsored tables" tabIndex={0}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Sponsor</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Guests</th>
                  <th scope="col">Table number</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id}>
                    <td>{t.sponsorName}</td>
                    <td>{t.tierName}</td>
                    <td>
                      {t.guestCount} / {t.capacity}
                      {t.overbooked && <span className="seat-badge">Overbooked</span>}
                    </td>
                    <td>
                      <SeatForm
                        action={setTableNumber}
                        id={t.id}
                        value={t.tableNumber}
                        label={`Table number for ${t.sponsorName} (${t.tierName})`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="guests">
        <h2 id="guests">Guests</h2>
        <p>A guest shows their sponsored table&apos;s number unless moved. Clear a moved guest&apos;s number to send them back.</p>
        {guests.length === 0 ? (
          <p>No guests yet.</p>
        ) : (
          <div className="admin-table-wrap" role="region" aria-label="Guests" tabIndex={0}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Guest</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Sponsor</th>
                  <th scope="col">Table</th>
                  <th scope="col">Move to table</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((g) => (
                  <tr key={g.id}>
                    <td>
                      {g.fullName}
                      <span className="admin-id">{g.email}</span>
                    </td>
                    <td>{g.tierName}</td>
                    <td>{g.sponsorName ?? "Individual"}</td>
                    <td>
                      {g.tableNumber ?? "—"}
                      {g.moved && <span className="admin-id">moved</span>}
                    </td>
                    <td>
                      <SeatForm
                        action={moveAttendee}
                        id={g.id}
                        value={g.moved ? g.tableNumber : null}
                        label={`Move ${g.fullName} to table`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default function TablesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <h1>Tables & Seating</h1>
      <Suspense fallback={<p>Checking access…</p>}>
        <Seating searchParams={searchParams} />
      </Suspense>
    </>
  );
}

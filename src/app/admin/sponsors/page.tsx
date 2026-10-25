import type { Metadata } from "next";
import { Suspense } from "react";
import { formatCents } from "@/lib/admin/overview";
import { loadSponsorList } from "@/lib/admin/sponsors";
import { requireRole } from "@/lib/auth/guard";
import { loadPledgeTiers, tableCents } from "@/lib/sponsor/pledge";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { PledgeForm } from "@/app/sponsor/pledge-form";
import { adminPledge } from "./actions";
import { GuestForm } from "./guest-form";

export const metadata: Metadata = { title: "Sponsors — SSF Gala admin" };

async function Sponsors() {
  const access = await requireRole("admin", "/admin/sponsors");
  if (access.eventId === null) return <p>No active gala is set up yet.</p>;

  const admin = createSupabaseAdminClient();
  const [sponsors, tiers] = await Promise.all([
    loadSponsorList(admin, access.eventId),
    loadPledgeTiers(admin, access.eventId),
  ]);

  return (
    <>
      <details className="gala-form">
        <summary>New sponsor pledge</summary>
        <PledgeForm
          action={adminPledge}
          audience="admin"
          email=""
          tiers={tiers.map((t) => ({
            name: t.name,
            price: formatCents(tableCents(t)),
            table_cents: tableCents(t),
            tables_left: t.tables_left,
          }))}
        />
      </details>

      {sponsors.length === 0 ? (
        <p>No sponsors yet.</p>
      ) : (
        <>
          <div className="admin-table-wrap" role="region" aria-label="Sponsors, scrollable" tabIndex={0}>
            <table className="admin-table">
              <caption>Sponsors</caption>
              <thead>
                <tr>
                  <th scope="col">Sponsor</th>
                  <th scope="col">Email</th>
                  <th scope="col">Pledged</th>
                  <th scope="col">Tables</th>
                </tr>
              </thead>
              <tbody>
                {sponsors.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.name}</th>
                    <td>{s.email}</td>
                    <td>{formatCents(s.pledgedCents)}</td>
                    <td>{s.tableCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sponsors
            .filter((s) => s.tables.length > 0)
            .map((s) => (
              <section key={s.id} className="gala-form" aria-labelledby={`sponsor-${s.id}`}>
                <h2 id={`sponsor-${s.id}`}>{s.name}</h2>
                <ol className="receipt-list">
                  {s.tables.map((t, i) => (
                    <li key={t.id}>
                      <span>
                        Table {i + 1} · {t.tierName} · {t.guestCount} / {t.capacity} guests
                        {t.overbooked && <span className="seat-badge">Overbooked</span>}
                      </span>
                      <details>
                        <summary>Add a guest</summary>
                        <GuestForm tableId={t.id} label={`Add a guest to ${s.name} table ${i + 1} (${t.tierName})`} />
                      </details>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
        </>
      )}
    </>
  );
}

export default function SponsorsPage() {
  return (
    <>
      <h1>Sponsors</h1>
      <p>Enter pledges taken by phone or in person, and add guests to any sponsored table.</p>
      <Suspense fallback={<p>Checking access…</p>}>
        <Sponsors />
      </Suspense>
    </>
  );
}

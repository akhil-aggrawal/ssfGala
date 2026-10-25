import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getAccess } from "@/lib/auth/guard";
import { loadSponsorTables, registeredText } from "@/lib/sponsor/dashboard";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { GuestRow } from "./guest-row";

export const metadata: Metadata = { title: "Your Tables — SSF Gala" };

async function Tables() {
  const access = await getAccess();
  if (!access) redirect("/signin?next=%2Fsponsor%2Fdashboard");
  const cards = access.eventId
    ? await loadSponsorTables(
        await createSupabaseServerClient(),
        createSupabaseAdminClient(),
        access.user.id,
        access.eventId,
      )
    : [];

  if (cards.length === 0) {
    return (
      <section className="sponsor-dash__empty" aria-labelledby="no-tables">
        <h2 id="no-tables">You have no sponsored tables yet</h2>
        <p>Pledge a table and its guests will show up here.</p>
        <Link className="button button--primary" href="/sponsor">
          Sponsor a table
        </Link>
      </section>
    );
  }

  return (
    <ul className="sponsor-dash__cards" aria-label="Your tables">
      {cards.map((card) => (
        <li key={card.id} className="sponsor-dash__card">
          <article aria-labelledby={`table-${card.id}`}>
            <h2 id={`table-${card.id}`}>
              Table {card.number} · {card.tier}
            </h2>
            <p className="sponsor-dash__count">{registeredText(card)}</p>
            <details>
              <summary>View guests</summary>
              {card.guests.length === 0 ? (
                <p>No guests have registered yet.</p>
              ) : (
                <ol className="sponsor-dash__guests">
                  {card.guests.map((g) => (
                    <GuestRow key={g.id} guest={g} />
                  ))}
                </ol>
              )}
            </details>
          </article>
        </li>
      ))}
    </ul>
  );
}

export default function SponsorDashboardPage() {
  return (
    <main className="sponsor-dash">
      <h1>Your Tables</h1>
      <p className="sponsor-dash__lede">Each table seats 10 guests. Guests register with your table link.</p>
      <Suspense fallback={<p>Loading your tables…</p>}>
        <Tables />
      </Suspense>
    </main>
  );
}

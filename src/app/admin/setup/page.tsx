import type { Metadata } from "next";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth/guard";
import { DEFAULT_TIERS, TIER_NAMES, toLocalInput, type EventStatus } from "@/lib/gala/setup";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { GalaForm, type GalaFormEvent } from "./gala-form";

export const metadata: Metadata = { title: "Gala Setup — SSF Gala admin" };

const NEW_GALA: GalaFormEvent = {
  id: null,
  name: "",
  year: null,
  date_local: "",
  venue: "",
  status: "draft",
  tiers: [...DEFAULT_TIERS],
};

async function loadGalas(): Promise<GalaFormEvent[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("events")
    .select("id, name, year, date_at, venue, status, seating_tiers (name, seat_price_cents, suggested_contribution_cents, sponsorship_amount_cents, table_inventory)")
    .order("year", { ascending: false });
  if (error) throw new Error(`gala setup load failed: ${error.message}`);
  return data.map((e) => ({
    id: e.id,
    name: e.name,
    year: e.year,
    date_local: toLocalInput(e.date_at),
    venue: e.venue ?? "",
    status: e.status as EventStatus,
    tiers: TIER_NAMES.map((name) => {
      const t = e.seating_tiers.find((row) => row.name === name);
      return t
        ? { ...t, name }
        : { name, seat_price_cents: 0, suggested_contribution_cents: 0, sponsorship_amount_cents: null, table_inventory: 0 };
    }),
  }));
}

async function Setup() {
  await requireRole("admin", "/admin/setup");
  const galas = await loadGalas();
  const current = galas.filter((g) => g.status !== "archived");
  const archived = galas.filter((g) => g.status === "archived");
  return (
    <>
      {current.map((g) => (
        <GalaForm key={g.id} event={g} title={`${g.name} (${g.year}) · ${g.status}`} />
      ))}
      <GalaForm event={NEW_GALA} title="New gala" />
      <section aria-labelledby="archived-galas">
        <h2 id="archived-galas">Archived galas</h2>
        {archived.length === 0 && <p>None yet.</p>}
        {archived.map((g) => (
          <GalaForm key={g.id} event={g} title={`${g.name} (${g.year}) · archived`} />
        ))}
      </section>
    </>
  );
}

export default function GalaSetupPage() {
  return (
    <>
      <h1>Gala Setup</h1>
      <p>Only one gala can be draft or open at a time.</p>
      <Suspense fallback={<p>Checking access…</p>}>
        <Setup />
      </Suspense>
    </>
  );
}

// Sponsorship confirmation email (issue #33). Server only.
// Sent once after a pledge is saved, from the public /sponsor flow and the
// admin /admin/sponsors flow alike. A failed send is logged with the
// sponsorship id and never undoes the pledge.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { log } from "@/lib/log";
import { sponsorshipConfirmationEmail, type SponsorshipPledge } from "./templates";
import type { EmailTransport } from "./transport";

export async function sendSponsorshipConfirmation(
  db: SupabaseClient<Database>,
  eventId: string,
  pledge: Omit<SponsorshipPledge, "event">,
  transport: EmailTransport,
): Promise<void> {
  try {
    const { data, error } = await db.from("events").select("name, date_at, venue").eq("id", eventId).maybeSingle();
    if (error) throw new Error(`load event failed: ${error.message}`);
    const mail = sponsorshipConfirmationEmail({
      ...pledge,
      event: { name: data?.name ?? "the SSF Gala", dateAt: data?.date_at ?? null, venue: data?.venue ?? null },
    });
    await transport.send({ to: pledge.sponsorEmail, idempotencyKey: `sponsorship:${pledge.sponsorshipId}`, ...mail });
  } catch (error) {
    log("error", "email: send failed", { sponsorshipId: pledge.sponsorshipId, kind: "sponsorship", error: String(error) });
  }
}

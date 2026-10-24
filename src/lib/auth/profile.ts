import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Create the user's profiles row on first sign-in. A repeat sign-in hits
// the primary key and is ignored, so there is never a second row and an
// existing display name is never overwritten.
export async function ensureProfile(
  admin: SupabaseClient<Database>,
  user: Pick<User, "id" | "email" | "user_metadata">,
): Promise<void> {
  const meta = user.user_metadata ?? {};
  const displayName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    null;
  const { error } = await admin
    .from("profiles")
    .upsert(
      { id: user.id, email: user.email ?? null, display_name: displayName },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`ensureProfile failed: ${error.message}`);
}

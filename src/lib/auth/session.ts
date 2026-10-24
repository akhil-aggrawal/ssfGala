import { connection } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/supabase/env";

export type SessionUser = { id: string; email: string | null };

// The signed-in visitor, verified on the server, or null.
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!supabaseEnv()) return null;
  // The session is per request: opt out of prerendering before auth-js reads the clock.
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const email = data.claims.email;
  return { id: data.claims.sub, email: typeof email === "string" ? email : null };
}

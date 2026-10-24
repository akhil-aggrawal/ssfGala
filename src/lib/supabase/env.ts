// Supabase settings read on the server. `null` means Supabase is not
// configured (e.g. a build with no env), and callers treat the visitor
// as signed out instead of crashing the page.
export function supabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export function requireSupabaseEnv(): { url: string; anonKey: string } {
  const env = supabaseEnv();
  if (!env) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  return env;
}

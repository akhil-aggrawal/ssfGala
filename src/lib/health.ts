type Env = Record<string, string | undefined>;

export type HealthResult = {
  status: 200 | 503;
  body: { status: "ok" | "error"; commit: string; database: "ok" | "error" };
};

// Reads one row id through Supabase's REST API with the service-role key,
// so RLS cannot turn a working connection into a false failure.
export async function checkHealth(env: Env, fetchImpl: typeof fetch = fetch): Promise<HealthResult> {
  const commit = env.RAILWAY_GIT_COMMIT_SHA || "unknown";
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  let database: "ok" | "error" = "error";
  try {
    const res = await fetchImpl(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/events?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) database = "ok";
  } catch {
    database = "error";
  }
  const ok = database === "ok";
  return { status: ok ? 200 : 503, body: { status: ok ? "ok" : "error", commit, database } };
}

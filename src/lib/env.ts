// Variables the server must have to start. Names come from .env.example.
// SENTRY_DSN is optional: without it, nothing is sent to Sentry.
// The Google OAuth pair is read by Supabase, not by this app.
export const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

type Env = Record<string, string | undefined>;

export function missingEnv(env: Env): string[] {
  return REQUIRED_ENV.filter((name) => !env[name]?.trim());
}

// Railway sets RAILWAY_ENVIRONMENT on every deployed environment.
export function isDeployed(env: Env): boolean {
  return Boolean(env.RAILWAY_ENVIRONMENT?.trim());
}

// The test-only sign-in route (E2E_AUTH=1) is a sign-in backdoor on a deployed site.
export function testSigninEnabled(env: Env): boolean {
  return env.E2E_AUTH === "1" && !isDeployed(env);
}

export function assertRequiredEnv(env: Env): void {
  const missing = missingEnv(env);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
  if (env.E2E_AUTH === "1" && isDeployed(env)) {
    throw new Error("E2E_AUTH=1 is not allowed on a deployed environment (RAILWAY_ENVIRONMENT is set)");
  }
}

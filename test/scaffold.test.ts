import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Variable names required by the Architecture Design doc,
// "Deployment and observability" section.
const requiredEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
  "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET",
  "RESEND_API_KEY",
  "NEXT_PUBLIC_APP_URL",
];

function envEntries(): Map<string, string> {
  const entries = new Map<string, string>();
  for (const raw of read(".env.example").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    entries.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return entries;
}

describe(".env.example", () => {
  it("lists every variable named in the architecture doc", () => {
    expect([...envEntries().keys()]).toEqual(
      expect.arrayContaining(requiredEnv),
    );
  });

  it("holds no real values", () => {
    for (const [name, value] of envEntries()) {
      expect(value, name).toBe("");
    }
  });

  it("keeps server secrets out of the browser bundle", () => {
    const secrets = [...envEntries().keys()].filter((name) =>
      /SERVICE_ROLE|SECRET|RESEND/.test(name),
    );
    expect(secrets.length).toBeGreaterThan(0);
    for (const name of secrets) expect(name).not.toMatch(/^NEXT_PUBLIC_/);
  });
});

describe("CI workflow", () => {
  const workflow = read(".github/workflows/verify.yml");

  it("runs on every pull request", () => {
    expect(workflow).toMatch(/^on:\s*\n\s+pull_request:/m);
  });

  it("installs from the lockfile and runs npm run verify", () => {
    expect(workflow).toMatch(/run: npm ci\s*$/m);
    expect(workflow).toMatch(/run: npm run verify\s*$/m);
  });
});

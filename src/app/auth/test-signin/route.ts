import { NextResponse, type NextRequest } from "next/server";
import { ensureProfile } from "@/lib/auth/profile";
import { safeNextPath } from "@/lib/auth/next-path";
import { testSigninEnabled } from "@/lib/env";
import { DEFAULT_TEST_EMAIL } from "@/lib/auth/test-user";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

// Test-only sign-in for browser tests: signs in a seeded user without
// Google. It does not exist (404) unless E2E_AUTH=1 off a deployed
// environment, and only accepts addresses on the reserved .test domain.
export async function GET(request: NextRequest) {
  if (!testSigninEnabled(process.env)) return new NextResponse(null, { status: 404 });

  const url = request.nextUrl;
  const email = url.searchParams.get("email") ?? DEFAULT_TEST_EMAIL;
  if (!/^[a-z0-9._+-]+@[a-z0-9-]+\.test$/i.test(email)) {
    return NextResponse.json({ error: "email must be on the .test domain" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });

  const supabase = await createSupabaseServerClient();
  // A brand-new user's link verifies as "signup", an existing one as "magiclink".
  const { data, error } = await supabase.auth.verifyOtp({
    type: link.properties.verification_type,
    token_hash: link.properties.hashed_token,
  });
  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? "no user" }, { status: 500 });
  }

  await ensureProfile(admin, data.user);
  return NextResponse.redirect(new URL(safeNextPath(url.searchParams.get("next")), url.origin));
}

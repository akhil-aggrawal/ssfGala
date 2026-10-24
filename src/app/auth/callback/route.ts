import { NextResponse, type NextRequest } from "next/server";
import { ensureProfile } from "@/lib/auth/profile";
import { safeNextPath } from "@/lib/auth/next-path";
import { appOrigin } from "@/lib/auth/origin";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

// Google sends the user back here with a PKCE code. Exchange it for a
// session, create the profile on first sign-in, then return to `next`.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = appOrigin(url.origin);
  const next = safeNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const failed = new URL(`/signin?error=callback&next=${encodeURIComponent(next)}`, origin);
  if (!code) return NextResponse.redirect(failed);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(failed);

  await ensureProfile(createSupabaseAdminClient(), data.user);
  return NextResponse.redirect(new URL(next, origin));
}
